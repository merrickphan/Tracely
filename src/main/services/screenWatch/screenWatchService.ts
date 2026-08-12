import { randomUUID } from 'crypto'
import { BrowserWindow, screen } from 'electron'
import { IPC_EVENTS } from '@shared/ipc-channels'
import type {
  ScreenWatchClaimCitation,
  ScreenWatchClaimEvidence,
  ScreenWatchClaimSummary,
  ScreenWatchOverlayUpdateEvent,
  ScreenWatchSourceCandidate,
  ScreenWatchStatus,
  TracerContext
} from '@shared/ipc-contract'
import type { CitationStyle, Claim, CritiqueVerdict, EvidenceItem, Source } from '@shared/types'
import { computeClaimSpans } from '@shared/claimSpans'
import { detectClaims } from '../ai/claimDetection'
import { isAuthError } from '../ai/client'
import { generateCritique } from '../ai/critique'
import { formatCitation } from '../citations'
import { formatInTextCitation } from '../citations/inText'
import { findCitationInsertPoint } from '../citations/insertPoint'
import { findEvidenceCached } from '../search/cachedEvidence'
import { getFaviconDataUrl } from '../search/favicon'
import { computeTextRelevance } from '../search/scoring'
import type { NormalizedSourceResult } from '../search/types'
import { getSetting, setSetting } from '../storage/settingsRepo'
import { focusedShieldableWindow } from '../../windows/overlayShield'
import {
  getOverlayWindow,
  hideOverlay,
  positionOverlayWindow,
  presentOverlay,
  sendToOverlay
} from '../../windows/overlayWindow'
import { getMainWindow } from '../../windows/mainWindow'
import { getTracerWindow, isTracerWindowOpen } from '../../windows/tracerWindow'
import { clipUnderline, resolveClip } from './clipRects'
import { logScreenWatch, resetScreenWatchLog } from './debugLog'
import { clearHoverState, setDragActive, startHoverTracking, stopHoverTracking } from './hoverTracking'
import {
  insertCitationText,
  takeUiaSnapshot,
  undoLastInsert,
  type ClaimSpanRequest,
  type ScreenRect
} from './uiaSnapshot'

const POLL_INTERVAL_MS = 1200
// How long the text has to stop changing before it's analyzed. This was
// 1200ms, which is not "the user finished a thought" — it's the pause
// between words. Someone drafting an essay clears a 1.2s bar dozens of
// times per paragraph, and because the cache is keyed on the whole
// document, every one of those was a guaranteed miss (the text differs by
// whatever was just typed) and so a full relay call re-analyzing the entire
// document. 4s is still responsive for someone who has genuinely stopped
// to think, and removes most of that.
const STABLE_MS = 4000
// Floor on time between two analyses regardless of stability. STABLE_MS
// alone doesn't bound anything: alternating type-pause-type-pause can clear
// it indefinitely. This is the actual ceiling on Screen Watch's spend —
// at most one detection per 20s per user while actively writing.
const MIN_ANALYSIS_INTERVAL_MS = 20_000
// Re-analyzing after a handful of characters changed re-reads the whole
// document to discover the same claims plus a partial sentence. Requiring a
// sentence-sized delta means a detection is triggered by new content, not
// by a typo fix. (Deletions count: Math.abs.)
const MIN_TEXT_DELTA_CHARS = 80
// How many of a detection's claims get their evidence fetched automatically
// (see triggerEvidenceSearch). The rest search when the user opens them.
const MAX_AUTO_EVIDENCE_CLAIMS = 3
const MIN_TEXT_LENGTH = 20
// User-configurable now (Settings > General > sensitivity) rather than a
// value we keep re-tuning in code — Screen Watch underlines passively,
// without the user asking about any one sentence, so a borderline call
// here is far more annoying (flagging ordinary descriptive sentences) than
// it would be in Analyze, where the user asked for a full pass and can
// just ignore a weak one. Default (0.55) sits below the relay prompt's own
// confidence calibration for unambiguous claims (0.8+) since the two
// compound — a high threshold on top of deliberately deflated scores for
// borderline claims suppressed real claims entirely in testing.
function getMinClaimConfidence(): number {
  const raw = Number(getSetting('claimSensitivity'))
  return Number.isFinite(raw) ? raw : 0.55
}

let enabled = false
let timer: ReturnType<typeof setTimeout> | null = null
let ticking = false
let detecting = false

let pendingText = ''
let pendingSince = 0
let lastAnalyzedText = ''
let lastAnalysisAt = 0

// Cheap stand-in for an edit distance: the length change, plus whether one
// text is still a prefix of the other. Rewriting a sentence in place keeps
// the length nearly identical, so length alone would miss it — but such an
// edit also breaks the common prefix, which this catches. Good enough to
// separate "typed a new sentence" from "fixed a typo", which is all the
// gate below needs to decide.
function hasMeaningfulDelta(next: string, previous: string): boolean {
  if (!previous) return true
  if (Math.abs(next.length - previous.length) >= MIN_TEXT_DELTA_CHARS) return true
  const shared = next.length < previous.length ? next.length : previous.length
  let i = 0
  while (i < shared && next[i] === previous[i]) i++
  // Everything after the first difference is rewritten text on both sides.
  return previous.length - i + (next.length - i) >= MIN_TEXT_DELTA_CHARS
}
let currentClaims: Claim[] = []
// Background evidence search result per currently-flagged claim — kicked
// off right after detection (see triggerEvidenceSearch) rather than waiting
// for the user to ask, so the widget/popup can show a real "X sources
// found" number instead of only the claim-detection confidence. Full
// results are kept here (not just the lean score/count sent to the
// renderer, see leanEvidence) so critiqueClaim below has real titles/
// abstracts to work with without a second search round-trip. Kept separate
// from `currentClaims` (rather than mutating strengthScore on the Claim
// objects directly) since results arrive asynchronously, one claim at a
// time, well after currentClaims was already set.
let evidenceResultByClaimId = new Map<string, { evidence: NormalizedSourceResult[]; score: number }>()
// Critique is never run automatically here (unlike evidence search) — it's
// the paid relay, so it only runs when the user explicitly clicks "Critique
// Argument" in the overlay (see critiqueClaim).
let critiqueByClaimId = new Map<string, { critique: string; verdict: CritiqueVerdict }>()
// Results of the focused "Find a source" search (findSourceForClaim) — kept
// separate from evidenceResultByClaimId (the broader background auto-search)
// since it's a distinct, user-triggered search that can use a different
// query than the claim's own searchQuery (the picker's "search again" box).
let findSourceResultByClaimId = new Map<string, NormalizedSourceResult[]>()
// Set once insertCitationForClaim has actually typed a citation into the
// watched document for a claim — insertOffset is kept only so a future
// insert on the same claim (unlikely, since cited claims are hidden from
// the flagged set) wouldn't need to re-derive it; nothing reads it back out
// today beyond the map value itself.
let citationByClaimId = new Map<string, { inTextCitation: string; worksCitedEntry: string; insertOffset: number }>()
let currentSpans: ClaimSpanRequest[] = []
let retryAfter = 0
let lastError: string | null = null
// Tracked separately from lastError because it is the one failure the user can
// fix, and because it must survive being shown: a signed-out app previously
// looked identical to a slow one.
let authRequired = false
const RETRY_COOLDOWN_MS = 5000
let lastSkipReason: string | null = null

// Consecutive `ok:false` snapshots. A closing or repainting window produces
// these routinely, so one is not evidence of anything.
let snapshotFailures = 0
// Hiding is free and one good tick undoes it — but doing it at the first
// failure would reintroduce the blink useStableUnderlines exists to suppress.
const HIDE_AFTER_FAILURES = 2
// Resetting costs STABLE_MS + MIN_ANALYSIS_INTERVAL_MS (24s), a relay call and
// three four-provider searches, so it waits for more evidence than hiding does.
const RESET_AFTER_FAILURES = 3

// Identifies which *document* is being watched, so claims from one do not
// linger over another. Not the text itself — see isDifferentDocument.
let lastDocumentKey: string | null = null

export interface HoverTarget {
  claimId: string
  kind: 'claim' | 'widget'
  text: string
  claimType: Claim['claimType']
  // Absolute logical (DIP) screen coordinates — same space as
  // screen.getCursorScreenPoint() — for hit-testing in hoverTracking.ts.
  rectsAbsolute: ScreenRect[]
  // Window-local coordinates — same space sent in
  // SCREENWATCH_OVERLAY_UPDATE — for positioning the tooltip in the overlay
  // renderer without any unit conversion there.
  rectsWindowLocal: ScreenRect[]
  // Only the collapsed launcher's badge/shadow extends beyond its base rect.
  // The expanded panel uses zero so transparent pixels around it never gain
  // native mouse capture.
  capturePadding?: number
}

let hoverTargets: HoverTarget[] = []

export function getHoverTargets(): HoverTarget[] {
  return hoverTargets
}

let widgetExpanded = false
// Cached so toggling expanded/collapsed can redraw immediately instead of
// waiting up to POLL_INTERVAL_MS for the next scheduled snapshot.
let lastUpdateInputs: {
  windowRect: ScreenRect
  // Carried so redrawOverlay() reproduces the same clip the tick that computed
  // it used. Without it a redraw would clip against the window alone and the
  // underlines would visibly shift onto the app's toolbar.
  controlRect: ScreenRect | null
  claimRects: { id: string; rects: ScreenRect[] }[]
  claims: Claim[]
  fullText: string
} | null = null

// Window-local top-left corner the user last dragged the widget/panel to —
// overrides the fixed corner anchor while set. Cleared whenever the widget
// collapses or a new control/app comes into focus, so the next expand
// starts fresh at the anchor rather than wherever it happened to be left.
let widgetManualPos: { x: number; y: number } | null = null

// 'single' shows just one claim at a time (the highest-confidence one);
// 'all' shows every currently-flagged claim in a grid sized to fit with no
// scrolling — the panel's actual pixel size (see updateOverlayAndWidget)
// depends on this, so it has to be known server-side rather than left as a
// renderer-only toggle the way the hover popover's own single/all switch is.
export type WidgetViewMode = 'single' | 'all'
let widgetViewMode: WidgetViewMode = 'single'

export function setWidgetExpanded(expanded: boolean): void {
  widgetExpanded = expanded
  if (!expanded) {
    widgetManualPos = null
    widgetViewMode = 'single'
  }
  redrawOverlay()
}

export function setWidgetViewMode(mode: WidgetViewMode): void {
  widgetViewMode = mode
  redrawOverlay()
}

export function setWidgetDragStart(): void {
  setDragActive(true)
}

export function setWidgetDragEnd(local: { x: number; y: number }): void {
  widgetManualPos = local
  setDragActive(false)
  redrawOverlay()
}

// The overlay's own logical top-left (the focused app window's origin, not
// the display's) the last time it was drawn — needed to convert the
// renderer-reported popover rect (window-local) into absolute screen
// coordinates for hoverTracking.ts, the same way widget drag positions are
// converted.
let lastOverlayOrigin: { x: number; y: number } | null = null
let activePopoverClaimId: string | null = null
let activePopoverRectAbsolute: ScreenRect | null = null

export function setActivePopoverRect(claimId: string | null, rectLocal: ScreenRect | null): void {
  activePopoverClaimId = claimId
  activePopoverRectAbsolute =
    rectLocal && lastOverlayOrigin
      ? {
          x: rectLocal.x + lastOverlayOrigin.x,
          y: rectLocal.y + lastOverlayOrigin.y,
          width: rectLocal.width,
          height: rectLocal.height
        }
      : null
}

export function getActivePopoverRect(): { claimId: string | null; rectAbsolute: ScreenRect | null } {
  return { claimId: activePopoverClaimId, rectAbsolute: activePopoverRectAbsolute }
}

function synthesizeClaim(detected: {
  text: string
  claimType: Claim['claimType']
  confidence: number
  searchQuery: string
}): Claim {
  return {
    id: randomUUID(),
    analysisId: '',
    text: detected.text,
    claimType: detected.claimType,
    confidence: detected.confidence,
    searchQuery: detected.searchQuery,
    strengthScore: null,
    scoreBreakdown: null,
    critique: null,
    critiqueVerdict: null,
    createdAt: new Date().toISOString()
  }
}

let lastStatus: ScreenWatchStatus = {
  enabled: false,
  active: false,
  processName: null,
  supportsUnderlines: false,
  claimCount: 0,
  lastError: null,
  authRequired,
  blockedApp: null
}

function getAllowedApps(): string[] {
  return getSetting('screenWatchAllowedApps')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Opt-in allowlist — Screen Watch reads nothing anywhere until the user
// explicitly picks which apps it's allowed to work in (Settings >
// Preferences), rather than working everywhere by default with an opt-out
// blocklist. Nothing is enabled out of the box.
function isProcessAllowed(processName: string): boolean {
  const allowed = getAllowedApps()
  return allowed.some((name) => name.toLowerCase() === processName.toLowerCase())
}

function emitStatus(status: ScreenWatchStatus): void {
  lastStatus = status
  const win = getMainWindow()
  win?.webContents.send(IPC_EVENTS.SCREENWATCH_STATUS_CHANGED, status)
}

export function getScreenWatchStatus(): ScreenWatchStatus {
  return lastStatus
}

/**
 * Bumped by every reset, and captured before any asynchronous work that will
 * write back into the tracking state.
 *
 * `detecting` stops a second detection starting while one is in flight, but it
 * does nothing about a RESET arriving in the middle — focus moving to another
 * app, a document switch, repeated snapshot failures. The relay call then
 * resolves into a world it no longer describes and repopulates currentClaims,
 * currentSpans and the evidence searches for a document that is no longer on
 * screen. Comparing generations is how a late result learns it is stale.
 */
let trackingGeneration = 0

function resetTrackingState(): void {
  trackingGeneration++
  pendingText = ''
  pendingSince = 0
  lastAnalyzedText = ''
  currentClaims = []
  evidenceResultByClaimId = new Map()
  critiqueByClaimId = new Map()
  findSourceResultByClaimId = new Map()
  citationByClaimId = new Map()
  faviconByUrl = new Map()
  faviconFetchInFlight = new Set()
  currentSpans = []
  hoverTargets = []
  widgetExpanded = false
  widgetViewMode = 'single'
  widgetManualPos = null
  lastUpdateInputs = null
  activePopoverClaimId = null
  activePopoverRectAbsolute = null
  lastSentPayloadKey = null
  lastDocumentKey = null
}

const EMPTY_OVERLAY_PAYLOAD: ScreenWatchOverlayUpdateEvent = { underlines: [], widget: null }

/**
 * Clears what the overlay is showing, then hides it.
 *
 * `hideOverlay()` alone was not enough and this is the main reason underlines
 * lingered: it hides the native window, but the React tree inside keeps its
 * `underlines` and `widget` state forever, so the previous document's marks
 * were repainted the moment the window was shown again — against whatever
 * window it had since been moved to.
 *
 * Three details are load-bearing:
 *
 *   - `widget: null`, not merely `underlines: []`. `useStableUnderlines` keys
 *     its 900ms grace hold off `widget.claims`, so an empty-underlines payload
 *     that kept the widget would HOLD every rect for another 900ms rather than
 *     clearing them.
 *   - It writes `lastSentPayloadKey`. Without that, a later payload that
 *     happened to match the pre-clear one would be swallowed by the dedupe in
 *     `updateOverlayAndWidget` and the overlay would stay blank permanently.
 *   - It clears hover too. `OverlayApp` synthesizes a popover from the hover
 *     event when `widget.claims` has no match, so an empty payload on its own
 *     leaves the card floating over a cleared overlay.
 */
function clearOverlay(): void {
  const key = JSON.stringify(EMPTY_OVERLAY_PAYLOAD)
  if (lastSentPayloadKey !== key) {
    lastSentPayloadKey = key
    sendToOverlay(IPC_EVENTS.SCREENWATCH_OVERLAY_UPDATE, EMPTY_OVERLAY_PAYLOAD)
  }
  hoverTargets = []
  clearHoverState()
  hideOverlay()
}

// How much of the shorter document's vocabulary must appear in the other for
// them to be treated as the same document, and how many distinct words are
// needed before the comparison is trusted at all. Below that floor a heading
// and a first sentence could differ entirely while both being the same file
// mid-load, so it declines to judge instead.
const SAME_DOCUMENT_CONTAINMENT = 0.35
const MIN_TOKENS_TO_JUDGE = 12

/**
 * Distinct words of five characters or more.
 *
 * The length filter is a cheap stopword filter. Nearly every English function
 * word — "the", "and", "that", "with", "this", "from", "have", "been" — is four
 * characters or fewer, and leaving them in makes any two English documents look
 * alike, which is the opposite of what this measure is for.
 */
function contentTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 5) out.add(word)
  }
  return out
}

/**
 * Fraction of the shorter text's vocabulary that also occurs in the longer one.
 *
 * Containment rather than Jaccard on purpose: typing, appending a paragraph and
 * deleting one all change the size of one side without changing how much of the
 * smaller side the larger one contains, so every editing operation scores near
 * 1. Two genuinely different documents score low no matter how their lengths
 * compare — which is exactly the case the previous length-delta test could not
 * see.
 */
function contentContainment(a: string, b: string): number {
  const setA = contentTokens(a)
  const setB = contentTokens(b)
  const smaller = setA.size <= setB.size ? setA : setB
  const larger = smaller === setA ? setB : setA
  // Too little to judge — report "same", since a false negative is the cheap
  // direction (see below).
  if (smaller.size < MIN_TOKENS_TO_JUDGE) return 1
  let shared = 0
  for (const word of smaller) if (larger.has(word)) shared++
  return shared / smaller.size
}

/**
 * Whether the watched *document* changed, or null if it looks like the same one.
 *
 * NOT "the text changed". The text-changed branch below is the typing path — it
 * is true on essentially every poll while someone writes, and claims are
 * designed to survive that and be re-located each tick. Clearing there would
 * wipe every underline on every keystroke.
 *
 * Two signals, both deliberately conservative. A false negative costs nothing:
 * the normal STABLE_MS/MIN_ANALYSIS_INTERVAL_MS path corrects it within ~24s.
 * A false positive collapses an open panel, kills an in-flight citation flow
 * (the renderer keys it by claim id, and re-detection mints new UUIDs) and
 * re-fires three four-provider searches.
 */
function documentChangeReason(processName: string, text: string): string | null {
  // The common real trigger, and free: Word -> Chrome with both allowlisted
  // previously kept Word's claims alive over the browser.
  if (lastDocumentKey !== null && lastDocumentKey !== processName) {
    return `process ${lastDocumentKey} -> ${processName}`
  }
  if (!pendingText) return null

  // Backstop for switching documents inside one app — Word to Word, or tab to
  // tab in one browser, where the process name is identical and cannot help.
  //
  // This used to require a shared prefix under 20% AND a length change of 200+
  // characters. The second condition is what made it miss: two documents of
  // similar length are the ordinary case, not the exotic one — two drafts of
  // the same essay, two tabs of the same site, page 2 and page 3 of anything —
  // and switching between them cleared neither test. The old claims and the
  // widget stayed live for the ~24s the slow path takes, and because
  // underlines are re-located each tick by FindText, any phrase the two
  // documents happened to share got underlined in the new one on the strength
  // of the old one's analysis.
  //
  // Vocabulary containment replaces both conditions and is independent of
  // length, so same-length switches are caught while in-place rewriting (which
  // keeps almost all of its vocabulary) is not.
  const shorter = Math.min(text.length, pendingText.length)
  if (shorter < 40) return null
  const containment = contentContainment(text, pendingText)
  if (containment >= SAME_DOCUMENT_CONTAINMENT) return null
  return `content diverged (${Math.round(containment * 100)}% shared vocabulary, ${pendingText.length} -> ${text.length} chars)`
}

async function tick(): Promise<void> {
  if (!enabled || ticking) return
  ticking = true
  try {
    const snapshot = await takeUiaSnapshot(currentSpans)

    if (!snapshot.ok) {
      lastError = snapshot.error

      // Freeze for the same reason a `skip: "self"` freezes, and check it
      // BEFORE counting. A backgrounded watched app is *more* likely to blow
      // uiaSnapshot's 4s budget while Tracer holds focus, so without this the
      // failure path becomes a second door into exactly the wipe the "self"
      // guard exists to prevent — and it opens in the situation that provokes
      // it most.
      if (isTracerWindowOpen()) {
        logScreenWatch(`snapshot failed while Tracer is open (frozen): ${snapshot.error}`)
        return
      }

      // This branch used to return without hiding or resetting anything, with
      // no counter — and a closing window is exactly what produces it, since
      // FocusedElement keeps handing back a dying element until focus settles.
      // So the previous document's underlines stayed on screen unbounded while
      // the status UI simultaneously reported "not active".
      //
      // Asymmetric on purpose. Hiding is free and one tick undoes it. Resetting
      // costs STABLE_MS + MIN_ANALYSIS_INTERVAL_MS (24s), a relay call and
      // three four-provider searches, so it waits for more evidence. And
      // hiding at the first failure would reintroduce the blink that
      // useStableUnderlines exists to suppress.
      snapshotFailures++
      logScreenWatch(`snapshot failed (${snapshotFailures} in a row): ${snapshot.error}`)
      if (snapshotFailures >= HIDE_AFTER_FAILURES) clearOverlay()
      // `===` not `>=`: fire the expensive half exactly once.
      if (snapshotFailures === RESET_AFTER_FAILURES) resetTrackingState()

      emitStatus({
        enabled,
        active: false,
        processName: null,
        supportsUnderlines: false,
        claimCount: 0,
        lastError,
        authRequired,
        blockedApp: null
      })
      return
    }
    // Any ok:true snapshot counts as a recovery, including a skip — a skip is
    // a successful read of a target we don't want, not a failed read.
    snapshotFailures = 0

    if (snapshot.skip) {
      // Talking to Tracer means Tracely itself is the foreground app, which
      // UIA reports as `skip: "self"`. Treating that like any other skip
      // would wipe the very claims the user opened Tracer to ask about and
      // hide the underlines out from under them mid-question. So while the
      // Tracer window is up, a "self" skip freezes Screen Watch instead:
      // keep the claims, keep the overlay drawn where it was, and pick the
      // document back up on the next tick after Tracer is closed. Every
      // other skip reason (and "self" with Tracer closed) still resets.
      if (snapshot.reason === 'self' && isTracerWindowOpen()) {
        return
      }

      // Logged only on change, not every tick — "not-editable-control-type"
      // in particular would otherwise spam the log constantly while just
      // browsing a normal webpage.
      if (snapshot.reason !== lastSkipReason) {
        lastSkipReason = snapshot.reason
        logScreenWatch(
          `skipping (${snapshot.reason}) on ${'processName' in snapshot ? (snapshot.processName ?? 'unknown') : 'unknown'}`
        )
      }
      clearOverlay()
      resetTrackingState()
      emitStatus({
        enabled,
        active: false,
        processName: 'processName' in snapshot ? (snapshot.processName ?? null) : null,
        supportsUnderlines: false,
        claimCount: 0,
        lastError,
        authRequired,
        blockedApp: null
      })
      return
    }
    lastSkipReason = null

    if (!isProcessAllowed(snapshot.processName)) {
      // Not an error — the user just hasn't allowed this app. Bail out
      // before any text ever reaches detectClaims: this is the actual
      // token-usage and privacy boundary, not just a UI filter.
      clearOverlay()
      resetTrackingState()
      logScreenWatch(`focused app ${snapshot.processName} is not on the allowed list, skipping`)
      emitStatus({
        enabled,
        active: false,
        processName: null,
        supportsUnderlines: false,
        claimCount: 0,
        lastError,
        authRequired,
        blockedApp: snapshot.processName
      })
      return
    }

    // Claims from one document must not stay live over another. Placed after
    // the allowlist gate and before the pendingText bookkeeping below, which
    // also makes it automatically Tracer-safe: the `skip: "self"` freeze
    // returns long before this, so none of it runs while Tracer has focus.
    const documentChange = documentChangeReason(snapshot.processName, snapshot.text)
    if (documentChange) {
      logScreenWatch(
        `different document (${documentChange}) — dropping ${currentClaims.length} claim(s)`
      )
      clearOverlay()
      resetTrackingState()
    }
    lastDocumentKey = snapshot.processName

    if (snapshot.text !== pendingText) {
      pendingText = snapshot.text
      pendingSince = Date.now()
      logScreenWatch(
        `text changed on ${snapshot.processName} (len ${pendingText.length}, supportsTextPattern=${snapshot.supportsTextPattern})`
      )
    } else if (
      pendingText.trim().length >= MIN_TEXT_LENGTH &&
      pendingText !== lastAnalyzedText &&
      hasMeaningfulDelta(pendingText, lastAnalyzedText) &&
      Date.now() - pendingSince >= STABLE_MS &&
      Date.now() - lastAnalysisAt >= MIN_ANALYSIS_INTERVAL_MS &&
      Date.now() >= retryAfter &&
      !detecting
    ) {
      detecting = true
      lastAnalysisAt = Date.now()
      const textAtRequestTime = pendingText
      const generationAtRequestTime = trackingGeneration
      logScreenWatch(`text stable, triggering detectClaims (len ${textAtRequestTime.length})`)
      detectClaims(textAtRequestTime)
        .then((detected) => {
          if (trackingGeneration !== generationAtRequestTime) {
            logScreenWatch(
              `discarding detectClaims result: tracking reset while it was in flight ` +
                `(gen ${generationAtRequestTime} -> ${trackingGeneration})`
            )
            return
          }
          // Only mark this text "done" on success — a failure must stay
          // retryable rather than being silently marked as already-tried.
          lastAnalyzedText = textAtRequestTime
          const confident = detected.filter((c) => c.confidence >= getMinClaimConfidence())
          currentClaims = confident.map(synthesizeClaim)
          lastError = null
          authRequired = false
          logScreenWatch(
            `detected ${detected.length} claim(s), ${confident.length} above confidence threshold: ` +
              `${currentClaims.map((c) => JSON.stringify(c.text)).join(', ')}`
          )
          // Compute spans against the text we just analyzed *now*, rather
          // than leaving currentSpans at whatever they were before this
          // detection (usually empty). Without this, the immediate redraw
          // below asks the OS for bounding rects using stale/empty offsets,
          // draws nothing, and only catches up a full poll cycle later.
          const freshSpans = computeClaimSpans(textAtRequestTime, currentClaims)
          currentSpans = freshSpans.map((s) => ({ id: s.claim.id, start: s.start, length: s.end - s.start }))
          // Fresh claim set → any evidence/critique/citation from the
          // previous one no longer applies to anything currently shown.
          evidenceResultByClaimId = new Map()
          critiqueByClaimId = new Map()
          findSourceResultByClaimId = new Map()
          citationByClaimId = new Map()
          triggerEvidenceSearch(currentClaims)
          // Don't wait for the next scheduled poll tick to show results —
          // that adds up to POLL_INTERVAL_MS of dead time on top of the
          // relay round-trip for no reason.
          void tick()
        })
        .catch((err) => {
          // A failure from a discarded generation must not put a cooldown on
          // the document now being watched, nor report its error as current.
          if (trackingGeneration !== generationAtRequestTime) return
          retryAfter = Date.now() + RETRY_COOLDOWN_MS
          lastError = err instanceof Error ? err.message : String(err)
          // A 401 is not a transient fault to retry past — it will keep failing
          // until the user signs in, and it is the failure they can actually
          // do something about. Flagged so the UI can say so rather than
          // silently underlining nothing, which is indistinguishable from the
          // app being slow.
          authRequired = isAuthError(err)
          logScreenWatch(`detectClaims failed${authRequired ? ' (auth)' : ''}: ${lastError}`)
        })
        .finally(() => {
          detecting = false
        })
    }

    // Locate claims within THIS tick's text ourselves — via the same fuzzy
    // matching the Live tab uses — rather than asking UIA's FindText to
    // search for the AI's claim text, which is frequently not an exact
    // substring (see the note atop resources/uia-watch.ps1). The resulting
    // offsets are sent up on the *next* tick's snapshot request.
    const claimSpans = computeClaimSpans(snapshot.text, currentClaims)
    currentSpans = claimSpans.map((s) => ({ id: s.claim.id, start: s.start, length: s.end - s.start }))

    if (currentClaims.length > 0) {
      logScreenWatch(
        `provider layout check: wholeDocRects=${snapshot.wholeDocRectCount ?? '?'} ` +
          `visibleRanges=${snapshot.visibleRangeCount ?? '?'} visibleRangeRects=${snapshot.visibleRangeRectCount ?? '?'}`
      )
      logScreenWatch(
        `located ${claimSpans.length}/${currentClaims.length} claim(s) in text this tick; ` +
          `claimRects from snapshot: ${snapshot.claimRects
            .map(
              (r) =>
                `${r.id.slice(0, 8)}=${r.rects.length}/${r.rawRectCount ?? '?'}rect(s) ` +
                `rangeText=${JSON.stringify(r.rangeTextPreview ?? null)} ` +
                `moveError=${r.moveError ?? 'none'} scrollError=${r.scrollError ?? 'none'} rectError=${r.rectError ?? 'none'}`
            )
            .join(' | ')}`
      )
    }

    updateOverlayAndWidget(
      snapshot.windowRect,
      snapshot.controlRect ?? null,
      snapshot.claimRects,
      currentClaims,
      snapshot.text
    )

    emitStatus({
      enabled,
      active: true,
      processName: snapshot.processName,
      supportsUnderlines: snapshot.supportsTextPattern,
      claimCount: currentClaims.length,
      lastError,
      authRequired,
      blockedApp: null
    })
  } finally {
    ticking = false
    if (enabled) timer = setTimeout(tick, POLL_INTERVAL_MS)
  }
}

// Matches the Figma "Collapsed Launcher" mockup's 56px circle.
const WIDGET_SIZE = 56
// Fixed distance from the focused window's bottom-right corner — matches
// where the Figma mockups place it, and (deliberately) has nothing to do
// with where the focused control or text cursor currently is.
const EDGE_MARGIN = 24
// Single-claim panel — big enough for the full action card (claim text,
// evidence row, Check Claim/Find Evidence buttons, and the critique
// result once run), with scrolling only when the watched window forces the
// panel below its ideal size. Must match OverlayApp.tsx's
// POPOVER_WIDTH/EST_HEIGHT-equivalent sizing intent for the same content.
const SINGLE_PANEL_WIDTH = 400
const SINGLE_PANEL_HEIGHT = 400
// "Show all" — a single vertical column (not a grid) so each row has room
// to show real article titles, not just a count. Sized per-claim-count
// below (computeAllPanelSize) so a normal number of claims fits with no
// scrolling; height is capped (MAX_LIST_PANEL_HEIGHT) for the rare case of
// many claims at once, since letting the panel grow past the screen would
// just reintroduce clipping — the renderer scrolls internally only past
// that cap. Mirrored client-side in OverlayApp.tsx (GRID_*) — keep in sync.
const GRID_CARD_WIDTH = 364
const GRID_CARD_HEIGHT = 108
const GRID_GAP = 10
const GRID_HEADER_HEIGHT = 44
const GRID_PADDING = 18
const MAX_LIST_PANEL_HEIGHT = 560

function computeAllPanelSize(claimCount: number): { width: number; height: number } {
  const count = Math.max(1, claimCount)
  const naturalHeight = GRID_PADDING * 2 + GRID_HEADER_HEIGHT + count * GRID_CARD_HEIGHT + (count - 1) * GRID_GAP
  return {
    width: GRID_PADDING * 2 + GRID_CARD_WIDTH,
    height: Math.min(naturalHeight, MAX_LIST_PANEL_HEIGHT)
  }
}

let lastSentPayloadKey: string | null = null

function redrawOverlay(): void {
  if (!lastUpdateInputs) return
  updateOverlayAndWidget(
    lastUpdateInputs.windowRect,
    lastUpdateInputs.controlRect,
    lastUpdateInputs.claimRects,
    lastUpdateInputs.claims,
    lastUpdateInputs.fullText
  )
}

// Top 3 by rank, not the full result set — enough for the overlay to show
// real article titles instead of just a count, without ballooning the
// payload that gets re-sent on every overlay-update.
const MAX_ARTICLES_IN_OVERLAY = 3

// Favicon lookups are async (a real network call, see search/favicon.ts)
// but leanEvidence itself has to stay synchronous — it's read on every
// redrawOverlay(), which nothing downstream awaits. So this is a
// fire-and-forget-then-redraw cache: the first time a URL is seen its
// favicon returns null immediately (fetch kicked off in the background),
// and once that resolves a fresh redraw picks up the real image. Reset
// per-session like every other per-run map (favicons are cheap enough to
// just refetch next run rather than persist across restarts).
let faviconByUrl = new Map<string, string | null>()
let faviconFetchInFlight = new Set<string>()

function ensureFaviconsFor(urls: (string | null)[]): void {
  for (const url of urls) {
    if (!url || faviconByUrl.has(url) || faviconFetchInFlight.has(url)) continue
    faviconFetchInFlight.add(url)
    getFaviconDataUrl(url)
      .then((dataUrl) => {
        faviconByUrl.set(url, dataUrl)
        redrawOverlay()
      })
      .finally(() => {
        faviconFetchInFlight.delete(url)
      })
  }
}

function leanEvidence(claimId: string): ScreenWatchClaimEvidence | null {
  const result = evidenceResultByClaimId.get(claimId)
  if (!result) return null
  ensureFaviconsFor(result.evidence.slice(0, MAX_ARTICLES_IN_OVERLAY).map((item) => item.url))
  return {
    score: result.score,
    count: result.evidence.length,
    articles: result.evidence.slice(0, MAX_ARTICLES_IN_OVERLAY).map((item) => ({
      title: item.title,
      venue: item.venue,
      year: item.year,
      faviconDataUrl: item.url ? (faviconByUrl.get(item.url) ?? null) : null,
      provider: item.provider,
      url: item.url
    }))
  }
}

// Stable id for a search result within one claim's result set — same
// derivation synthesizeEvidenceItem always used, now also doubling as the
// "sourceRef" the citation flow's IPC responses hand back to the renderer
// and expect returned on insertCitationForClaim, since these results are
// never persisted through sourcesRepo (no real database id exists to use).
function sourceRefFor(item: NormalizedSourceResult, rank: number): string {
  return item.doi ?? item.providerId ?? `${item.provider}:${rank}`
}

// generateCritique and formatCitation/formatInTextCitation only ever read
// plain fields off a Source (title/abstract/authors/year/venue) — building
// one here (rather than persisting these ephemeral, never-saved search
// results through sourcesRepo just to get a real id) is safe precisely
// because nothing downstream needs a real database-backed id for a claim's
// evidence to be critiqued or cited correctly.
function synthesizeSourceFromResult(item: NormalizedSourceResult, rank: number): Source {
  return {
    id: sourceRefFor(item, rank),
    doi: item.doi,
    title: item.title,
    authors: item.authors,
    year: item.year,
    venue: item.venue,
    venueType: item.venueType,
    url: item.url,
    pdfUrl: item.pdfUrl,
    abstract: item.abstract,
    provider: item.provider,
    providerId: item.providerId,
    citationCount: item.citationCount,
    oaStatus: item.oaStatus,
    createdAt: new Date().toISOString()
  }
}

function synthesizeEvidenceItem(item: NormalizedSourceResult, rank: number): EvidenceItem {
  const source = synthesizeSourceFromResult(item, rank)
  // Stance is null rather than carried across: this synthesises an
  // EvidenceItem from a raw provider result that was never scored against a
  // specific claim, so there is no verdict to report and asserting one would
  // be inventing it.
  return {
    source,
    relevanceScore: 1 - rank / Math.max(1, item.relevanceRank + 1),
    rank,
    stance: null,
    stanceConfidence: null
  }
}

// Looks a citation-flow sourceRef back up across both places a result could
// have come from: the focused "Find a source" search, or the background
// auto-search's broader result set (when the user clicked "Add citation"
// straight from evidence that was already on hand).
function resolveSourceRef(claimId: string, sourceRef: string): NormalizedSourceResult | null {
  const pools = [findSourceResultByClaimId.get(claimId) ?? [], evidenceResultByClaimId.get(claimId)?.evidence ?? []]
  for (const pool of pools) {
    const idx = pool.findIndex((item, i) => sourceRefFor(item, i) === sourceRef)
    if (idx !== -1) return pool[idx]
  }
  return null
}

// Fired once per fresh claim set, right after detection — free public APIs
// (OpenAlex/Crossref/Semantic Scholar/PubMed, already rate-limited per
// provider in rateLimiter.ts), not the paid relay, so running this
// automatically for passive background reading doesn't add API cost the way
// auto-running claim detection/critique would. Each claim's result lands in
// evidenceResultByClaimId independently and triggers its own redraw as soon
// as it's ready, rather than waiting for every claim's search to finish.
function triggerEvidenceSearch(claims: Claim[]): void {
  // Every claim here costs four provider searches, so a full set of 8 fired
  // 32 HTTP requests per detection, unprompted, for claims the user may
  // never look at. That is the main reason Semantic Scholar answers 429 —
  // its unauthenticated tier is a shared global pool. Claims arrive sorted
  // by confidence, so the top few are the ones most likely to be opened;
  // the rest search on demand via refreshEvidenceForClaim when the user
  // actually hovers one.
  for (const claim of claims.slice(0, MAX_AUTO_EVIDENCE_CLAIMS)) {
    findEvidenceCached(claim.searchQuery, claim.text)
      .then((result) => {
        // The claim set may have moved on (text changed again, focus moved
        // to a different app) by the time this resolves — a result for a
        // claim that's no longer current would only show stale data.
        if (!currentClaims.some((c) => c.id === claim.id)) return
        evidenceResultByClaimId.set(claim.id, { evidence: result.evidence, score: result.score })
        redrawOverlay()
      })
      .catch((err) => {
        logScreenWatch(`background evidence search failed for claim ${claim.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`)
      })
  }
}

// User-initiated re-run of evidence search for one claim (the overlay's
// "Find Evidence"/"Refresh Evidence" button) — same search as
// triggerEvidenceSearch, just for a single claim on demand instead of the
// whole set automatically.
export async function refreshEvidenceForClaim(claimId: string): Promise<ScreenWatchClaimEvidence | null> {
  const claim = currentClaims.find((c) => c.id === claimId)
  if (!claim) return null
  const result = await findEvidenceCached(claim.searchQuery, claim.text)
  if (!currentClaims.some((c) => c.id === claimId)) return null
  evidenceResultByClaimId.set(claimId, { evidence: result.evidence, score: result.score })
  redrawOverlay()
  return leanEvidence(claimId)
}

// User-initiated only (the overlay's "Check Claim" button) — unlike
// evidence search this hits the paid relay, so it never runs automatically
// for passive background reading.
export async function critiqueClaim(claimId: string): Promise<{ critique: string; verdict: CritiqueVerdict }> {
  const claim = currentClaims.find((c) => c.id === claimId)
  if (!claim) throw new Error('This claim is no longer being tracked (the watched text likely changed).')
  const evidence = evidenceResultByClaimId.get(claimId)
  const evidenceItems = evidence ? evidence.evidence.map((item, i) => synthesizeEvidenceItem(item, i)) : []
  const claimWithScore: Claim = { ...claim, strengthScore: evidence?.score ?? null }
  const result = await generateCritique(claimWithScore, evidenceItems)
  if (currentClaims.some((c) => c.id === claimId)) {
    critiqueByClaimId.set(claimId, result)
    redrawOverlay()
  }
  return result
}

// Ranked candidates for one claim, capped so the picker stays scannable —
// this is deliberately smaller/more curated than Refresh Evidence's list.
const MAX_FIND_SOURCE_CANDIDATES = 5
// Mirrors PER_PROVIDER_LIMIT in search/scoring.ts — that constant isn't
// exported (it's an internal tuning knob for the whole-claim strength
// score), so it's duplicated here for the same per-item rank-relevance
// blend, applied to a single claim's candidate list rather than the whole
// evidence set.
const RANK_RELEVANCE_LIMIT = 6

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// The focused, single-claim search behind the overlay's "Find a source"
// action — same cached evidence lookup Refresh Evidence already uses, but with a
// per-item match % (the same text-relevance/rank blend computeStrengthScore
// uses internally for the whole claim, just surfaced per candidate here)
// so the user can pick one specific source to cite instead of browsing a
// plain list. `query` overrides the claim's own searchQuery for the
// picker's "search again" box.
export async function findSourceForClaim(claimId: string, query?: string): Promise<ScreenWatchSourceCandidate[]> {
  const claim = currentClaims.find((c) => c.id === claimId)
  if (!claim) return []
  const result = await findEvidenceCached(query ?? claim.searchQuery, claim.text)
  if (!currentClaims.some((c) => c.id === claimId)) return []
  findSourceResultByClaimId.set(claimId, result.evidence)

  const ranked = result.evidence
    .map((item, i) => {
      // The aggregator's own figure, not a re-derivation. It recomputed word
      // overlap here, which now disagrees with how the results were actually
      // ranked: findEvidence scores candidates by embedding similarity when
      // the model is available, so recomputing coverage would show the user a
      // match % for a metric that had no part in choosing or ordering these.
      const textRelevance = item.textRelevance
      const rankRelevance = clamp01(1 - item.relevanceRank / RANK_RELEVANCE_LIMIT)
      const matchPercent = Math.round(100 * clamp01(0.75 * textRelevance + 0.25 * rankRelevance))
      return { item, sourceRef: sourceRefFor(item, i), matchPercent }
    })
    .sort((a, b) => b.matchPercent - a.matchPercent)
    .slice(0, MAX_FIND_SOURCE_CANDIDATES)

  // Unlike leanEvidence's fire-and-forget favicon lookups (fine there since
  // widget.claims re-pushes on every redraw), this response is a one-shot
  // IPC reply the renderer stores directly — there's no later redraw that
  // would pick up a favicon that resolved after the fact. So this awaits
  // the (small, capped, timeout-bounded) fetch for just the final top-N
  // candidates before returning, rather than returning null placeholders.
  const candidates: ScreenWatchSourceCandidate[] = await Promise.all(
    ranked.map(async ({ item, sourceRef, matchPercent }) => ({
      sourceRef,
      title: item.title,
      venue: item.venue,
      year: item.year,
      provider: item.provider,
      url: item.url,
      matchPercent,
      faviconDataUrl: await getFaviconDataUrl(item.url)
    }))
  )
  return candidates
}

// The overlay's "Insert citation" action — formats both citation forms from
// the chosen candidate (never touching sourcesRepo/citationsRepo, same
// ephemeral rule as the rest of Screen Watch) and types the in-text form
// into the watched external document right after the claim's current text,
// via the new UIA write-back in uiaSnapshot.ts.
export async function insertCitationForClaim(
  claimId: string,
  sourceRef: string,
  style: CitationStyle
): Promise<ScreenWatchClaimCitation> {
  const claim = currentClaims.find((c) => c.id === claimId)
  if (!claim) throw new Error('This claim is no longer being tracked (the watched text likely changed).')

  const item = resolveSourceRef(claimId, sourceRef)
  if (!item) throw new Error('That source is no longer available — try searching again.')

  const source = synthesizeSourceFromResult(item, 0)
  const worksCitedEntry = formatCitation(source, style)
  const inTextCitation = formatInTextCitation(source, style)

  const span = currentSpans.find((s) => s.id === claimId)
  if (!span) throw new Error('Could not locate this claim in the document anymore — try again.')

  const fullText = lastUpdateInputs?.fullText ?? ''
  // Fail closed. uia-watch.ps1 skips the staleness check entirely when the
  // expected snippet is empty, so an empty fullText here meant inserting blind
  // at a possibly-stale offset rather than refusing.
  if (!fullText) throw new Error('Could not locate this claim in the document anymore — try again.')

  // Not `span.start + span.length`: that lands after the sentence's full stop,
  // which is what produced "…low weight. (Smith, 2020)".
  const { offset: insertOffset, prefix } = findCitationInsertPoint(fullText, span.start + span.length)
  // Must come from the ADJUSTED offset — comparing live text at the new offset
  // against a snippet taken from the old one makes uia-watch.ps1's staleness
  // check abort every insert with "the document changed since this claim was
  // located".
  const expectedSnippet = fullText.slice(insertOffset, insertOffset + 30)

  const result = await insertCitationText(insertOffset, `${prefix}${inTextCitation}`, expectedSnippet)
  if (!result.ok) throw new Error(result.error)

  const citation: ScreenWatchClaimCitation = { inTextCitation, worksCitedEntry }
  citationByClaimId.set(claimId, { ...citation, insertOffset })
  redrawOverlay()
  return citation
}

// "Undo" on the citation-added confirmation — a plain Ctrl+Z to whatever
// app is still focused. Reliable because insertCitationForClaim always
// performs exactly one paste, which is one undo step in effectively every
// real text editor/browser; Tracely doesn't need to track its own undo
// stack for this. Leaves the claim flagged again (removed from
// citationByClaimId) so the user can retry or pick a different source.
export async function undoCitationForClaim(claimId: string): Promise<void> {
  if (!citationByClaimId.has(claimId)) return
  const result = await undoLastInsert()
  if (!result.ok) throw new Error(result.error)
  citationByClaimId.delete(claimId)
  redrawOverlay()
}

function updateOverlayAndWidget(
  windowRect: ScreenRect,
  controlRect: ScreenRect | null,
  claimRects: { id: string; rects: ScreenRect[] }[],
  claims: Claim[],
  fullText: string
): void {
  // A snapshot may finish after the user has opened Tracely. Do not let that
  // stale external-window result re-show the screen-saver-level overlay over
  // main or the floating claim checker between their immediate focus handlers
  // and the next UIA poll.
  //
  // Tracer is shieldable too (see overlayShield.ts) but is deliberately NOT
  // hidden for here: talking to Tracer must hold the claims and underlines in
  // place — that is the whole point of the "self" skip in tick() — and hiding
  // the overlay would wipe exactly what the user opened Tracer to ask about.
  // Tracer is protected positionally instead, in hoverTracking, so the
  // overlay can stay visible without ever capturing a click meant for it.
  //
  // `focusedShieldableWindow()` rather than checking getMainWindow()/
  // getFloatingWindow() directly — that is the one-rule shield this branch
  // merged with, and duplicating its focus test here is exactly what it was
  // written to stop. `clearOverlay()` rather than `hideOverlay()`, because
  // hiding alone is what left stale underlines to be re-shown on the next
  // present; clearing the state with it is this branch's whole point.
  const focused = focusedShieldableWindow()
  if (focused === 'main' || focused === 'floating') {
    clearOverlay()
    return
  }

  // A genuine change of target — a different app, or a resized window. NOT a
  // pure translation: dragging the watched window leaves every window-local
  // rect identical, so clearing there would blink the underlines on every move.
  const targetChanged =
    lastUpdateInputs !== null &&
    (lastUpdateInputs.windowRect.width !== windowRect.width ||
      lastUpdateInputs.windowRect.height !== windowRect.height)

  lastUpdateInputs = { windowRect, controlRect, claimRects, claims, fullText }

  // Clear BEFORE the window is moved or resized under the old content.
  if (targetChanged) clearOverlay()

  // Clip in physical pixels, on the single source both the drawn rects and the
  // hover hit-test region are derived from, so the two cannot disagree — an
  // unclipped rect hanging off the window edge used to be invisible and still
  // open a popover. controlRect is preferred because the window includes the
  // app's own toolbars, and text scrolled under a sticky header still reports a
  // valid rect that was then drawn on top of the header.
  const clip = resolveClip([controlRect, windowRect])
  const underlines = (Array.isArray(claimRects) ? claimRects : [])
    .map((r) => ({
      ...r,
      rects: !Array.isArray(r.rects)
        ? []
        : clip
          ? r.rects.map((rect) => clipUnderline(rect, clip)).filter((x): x is ScreenRect => x !== null)
          : r.rects
    }))
    .filter((r) => r.rects.length > 0)

  if (underlines.length === 0 && claims.length > 0) {
    logScreenWatch(`${claims.length} claim(s) tracked but none located on screen (off-screen or no match)`)
  }

  const center = {
    x: windowRect.x + windowRect.width / 2,
    y: windowRect.y + windowRect.height / 2
  }
  const display = screen.getDisplayNearestPoint(center)

  // UI Automation returns physical screen pixels; Electron window bounds are
  // logical (DPI-scaled) pixels. On anything other than 100% display scaling
  // (125%/150% are the common Windows defaults on modern laptops) these are
  // different units — divide by scaleFactor or every rect lands in the wrong
  // place. This assumes the display's physical top-left aligns with its
  // logical (0,0), which holds for the primary display; a true secondary-
  // display-with-different-scale fix would need each display's physical
  // origin, which Electron doesn't expose — still a known gap for that
  // specific case.
  const scale = display.scaleFactor || 1
  const windowLogical = {
    x: windowRect.x / scale,
    y: windowRect.y / scale,
    width: windowRect.width / scale,
    height: windowRect.height / scale
  }
  lastOverlayOrigin = { x: windowLogical.x, y: windowLogical.y }

  // The overlay is sized to the focused app's own window, not the whole
  // display — the OS clips anything drawn outside a window's own bounds for
  // free, which is what keeps underlines/the widget confined to whichever
  // app is actually focused instead of "leaking" across the rest of the
  // screen. The widget badge (see hoverTracking.ts / OverlayApp.tsx) shows
  // whenever a supported text field is focused — like Grammarly's icon —
  // independent of whether any claims were found yet, so the overlay stays
  // shown for that even with zero underlines.
  // Positioned only. Showing happens at the very end, after the payload
  // describing this window has actually been sent — moving and showing in one
  // call painted the previous document's rects against the new window's origin
  // for one IPC hop.
  const win = positionOverlayWindow({
    x: Math.round(windowLogical.x),
    y: Math.round(windowLogical.y),
    width: Math.max(1, Math.round(windowLogical.width)),
    height: Math.max(1, Math.round(windowLogical.height))
  })

  const toLocal = (r: ScreenRect): ScreenRect => ({
    x: r.x / scale - windowLogical.x,
    y: r.y / scale - windowLogical.y,
    width: r.width / scale,
    height: r.height / scale
  })
  const toAbsolute = (r: ScreenRect): ScreenRect => ({
    x: r.x / scale,
    y: r.y / scale,
    width: r.width / scale,
    height: r.height / scale
  })

  const localized = underlines.map((u) => ({
    id: u.id,
    rects: u.rects.map(toLocal),
    claimType: claims.find((c) => c.id === u.id)?.claimType ?? 'factual'
  }))

  // Anchored to a fixed corner of the focused app's window, not the focused
  // control — a control-relative anchor moved every time the user typed (the
  // control's rect can shift as text reflows), which is exactly the "don't
  // follow where I'm typing" behavior this replaced. Local space is already
  // window-local logical pixels (the overlay window IS the app window), so
  // no physical/scale conversion is needed here at all, unlike the underline
  // rects above.
  const winBounds = win.getBounds()
  const widgetLocalAnchored: ScreenRect = {
    x: Math.max(0, winBounds.width - WIDGET_SIZE - EDGE_MARGIN),
    y: Math.max(0, winBounds.height - WIDGET_SIZE - EDGE_MARGIN),
    width: WIDGET_SIZE,
    height: WIDGET_SIZE
  }
  const desiredPanelSize =
    widgetViewMode === 'all'
      ? computeAllPanelSize(claims.length)
      : { width: SINGLE_PANEL_WIDTH, height: SINGLE_PANEL_HEIGHT }
  // Some watched windows are narrower/shorter than the ideal 400px card. The
  // overlay itself is clipped to that window, so an unclamped panel makes its
  // right/bottom actions unreachable. Keep a small inset and let the renderer
  // scroll the content when the full card does not fit.
  const panelInset = Math.min(8, Math.floor(Math.min(winBounds.width, winBounds.height) / 4))
  const panelSize = {
    width: Math.min(desiredPanelSize.width, Math.max(1, winBounds.width - panelInset * 2)),
    height: Math.min(desiredPanelSize.height, Math.max(1, winBounds.height - panelInset * 2))
  }
  const panelLocalAnchored: ScreenRect = {
    x: Math.max(panelInset, winBounds.width - panelSize.width - EDGE_MARGIN),
    y: Math.max(panelInset, winBounds.height - panelSize.height - EDGE_MARGIN),
    width: panelSize.width,
    height: panelSize.height
  }

  const anchoredLocal = widgetExpanded ? panelLocalAnchored : widgetLocalAnchored
  // A user-dragged position overrides the anchor until the widget collapses
  // or a new control/app comes into focus (see widgetManualPos above).
  const activeLocal: ScreenRect = widgetManualPos
    ? {
        x: Math.min(Math.max(0, widgetManualPos.x), Math.max(0, winBounds.width - anchoredLocal.width)),
        y: Math.min(Math.max(0, widgetManualPos.y), Math.max(0, winBounds.height - anchoredLocal.height)),
        width: anchoredLocal.width,
        height: anchoredLocal.height
      }
    : anchoredLocal
  // Must add the overlay's own origin (the focused app window's logical
  // top-left, windowLogical), not display.bounds — the overlay is sized to
  // that window, not the whole display, since the window-scoping change.
  // Adding the display's origin here left the widget's hit-test rect offset
  // from where it's actually drawn whenever the app window didn't start at
  // the display's own top-left corner, so hoverTracking.ts never detected
  // the cursor over it and clicks always passed through.
  const activeAbsolute: ScreenRect = {
    x: activeLocal.x + windowLogical.x,
    y: activeLocal.y + windowLogical.y,
    width: activeLocal.width,
    height: activeLocal.height
  }

  if (underlines.length > 0) {
    logScreenWatch(
      `showing ${underlines.length} underline(s) on display ${display.id} (bounds ${JSON.stringify(display.bounds)}, scaleFactor=${display.scaleFactor}), overlay window bounds=${JSON.stringify(win.getBounds())}, visible=${win.isVisible()}, rects=${JSON.stringify(localized)}`
    )
  }

  const claimSummaries: ScreenWatchClaimSummary[] = [...claims]
    .sort((a, b) => b.confidence - a.confidence)
    .map((c) => {
      const critique = critiqueByClaimId.get(c.id)
      const citation = citationByClaimId.get(c.id)
      return {
        id: c.id,
        text: c.text,
        claimType: c.claimType,
        confidence: c.confidence,
        evidence: leanEvidence(c.id),
        critique: critique?.critique ?? null,
        critiqueVerdict: critique?.verdict ?? null,
        citation: citation ? { inTextCitation: citation.inTextCitation, worksCitedEntry: citation.worksCitedEntry } : null
      }
    })
  // The actual number of sources found across every currently-flagged claim
  // — previously this also added +1 per claim (counting the claim itself as
  // a piece of "info"), which inflated the badge well past the number of
  // real sources anyone could actually see or click on.
  const totalInfoCount = claimSummaries.reduce((sum, c) => sum + (c.evidence?.count ?? 0), 0)

  const payload: {
    underlines: typeof localized
    widget: {
      rect: ScreenRect
      expanded: boolean
      viewMode: WidgetViewMode
      claimCount: number
      claims: ScreenWatchClaimSummary[]
      totalInfoCount: number
    }
  } = {
    underlines: localized,
    widget: {
      rect: activeLocal,
      expanded: widgetExpanded,
      viewMode: widgetViewMode,
      claimCount: claims.length,
      claims: claimSummaries,
      totalInfoCount
    }
  }

  // Native hit-testing uses absolute coordinates and must be refreshed even
  // when the renderer payload is unchanged. Moving the watched window changes
  // these coordinates without changing any window-local rect in `payload`; an
  // early dedupe return here previously left the visible panel at its new
  // position while clicks were still tested against its old position.
  const claimTargets = underlines
    .map((u, idx) => {
      const claim = claims.find((c) => c.id === u.id)
      if (!claim) return null
      const target: HoverTarget = {
        claimId: u.id,
        kind: 'claim',
        text: claim.text,
        claimType: claim.claimType,
        rectsAbsolute: u.rects.map(toAbsolute),
        rectsWindowLocal: localized[idx].rects
      }
      return target
    })
    .filter((t): t is HoverTarget => t !== null)

  const widgetTarget: HoverTarget = {
    claimId: '__widget__',
    kind: 'widget',
    text: fullText,
    claimType: 'factual',
    rectsAbsolute: [activeAbsolute],
    rectsWindowLocal: [activeLocal],
    capturePadding: widgetExpanded ? 0 : 5
  }

  // The widget is painted above underlines, so it must win overlapping native
  // hit tests. Once expanded, do not let a hidden underline behind the panel
  // open a competing popover over its controls.
  hoverTargets = widgetExpanded ? [widgetTarget] : [widgetTarget, ...claimTargets]

  // Re-sending an unchanged payload every poll tick (every 1.2s, even when
  // nothing on screen actually changed) forces the renderer to re-render
  // the whole overlay tree for no reason — on a transparent always-on-top
  // window that's a plausible source of visible flicker. Skip the send
  // (and the resulting re-render) when nothing observable changed.
  const payloadKey = JSON.stringify(payload)
  if (payloadKey !== lastSentPayloadKey) {
    lastSentPayloadKey = payloadKey
    sendToOverlay(IPC_EVENTS.SCREENWATCH_OVERLAY_UPDATE, payload)
    emitTracerContext()
  }

  // Outside the dedupe, and last. This used to be an early `return`, with the
  // show happening near the top of the function — so simply moving the show
  // after the send would have stopped the overlay ever appearing whenever the
  // payload was unchanged, which is the steady state for the badge-only case
  // (a focused text field with no claims found). Showing after the send is the
  // whole point: the window is never presented describing the previous
  // document.
  void win
  presentOverlay()
}

/**
 * What Tracer is allowed to see: the text of the watched document and the
 * claims currently flagged in it. Read live from the same in-memory state
 * the overlay draws from — deliberately NOT from the database, since Screen
 * Watch persists none of this (see the note on synthesizeClaim).
 *
 * Returns empty context rather than throwing when Screen Watch is off or no
 * allowed app is focused: Tracer is still useful as a plain tutor with no
 * document in hand, it just can't refer to anything specific.
 */
export function getTracerContext(): TracerContext {
  const claims = lastUpdateInputs?.claims ?? currentClaims
  return {
    processName: lastStatus.active ? lastStatus.processName : null,
    documentText: lastUpdateInputs?.fullText ?? '',
    claims: claims.map((c) => ({
      id: c.id,
      text: c.text,
      claimType: c.claimType,
      evidenceScore: evidenceResultByClaimId.get(c.id)?.score ?? null
    }))
  }
}

// Pushed to the Tracer window whenever the watched document or its claims
// change, so an open conversation's "what I can see" header stays live
// instead of being a snapshot from whenever the window happened to open.
function emitTracerContext(): void {
  const win = getTracerWindow()
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.webContents.send(IPC_EVENTS.TRACER_CONTEXT_CHANGED, getTracerContext())
}

export function isScreenWatchEnabled(): boolean {
  return enabled
}

export function startScreenWatch(): void {
  if (enabled) return
  enabled = true
  setSetting('screenWatchEnabled', 'true')
  resetTrackingState()
  resetScreenWatchLog()
  lastError = null
  lastStatus = { ...lastStatus, enabled: true, lastError: null }
  startHoverTracking()
  void tick()
}

export function stopScreenWatch(): void {
  enabled = false
  setSetting('screenWatchEnabled', 'false')
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  stopHoverTracking()
  resetTrackingState()
  hideOverlay()
  emitStatus({
    enabled: false,
    active: false,
    processName: null,
    supportsUnderlines: false,
    claimCount: 0,
    lastError: null,
    authRequired,
    blockedApp: null
  })
}

export function initScreenWatch(): void {
  if (getSetting('screenWatchEnabled') === 'true') {
    startScreenWatch()
  }
}

export function shutdownScreenWatch(): void {
  enabled = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  stopHoverTracking()
  const win = getOverlayWindow()
  win?.destroy()
}
