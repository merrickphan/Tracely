import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { critiqueIssues } from './critiqueIssues'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type {
  CitationStyle,
  ClaimType,
  CritiqueVerdict,
  ParagraphRole,
  SourceProvider,
  StructureComponents
} from '@shared/types'
import type {
  ScreenWatchClaimCitation,
  ScreenWatchClaimEvidence,
  ScreenWatchClaimSummary,
  ScreenWatchEvidenceArticle,
  ScreenWatchHoverEvent,
  ScreenWatchOverlayUpdateEvent,
  ScreenWatchProblemKind,
  ScreenWatchSourceCandidate,
  ScreenWatchStructure,
  ScreenWatchWidget
} from '@shared/ipc-contract'
import figmaLogo from './assets/figma-logo.png'
import MarkdownText from './components/MarkdownText'
// Shared with the document editor, which draws the same marks over Tracely's
// own writing surface. See components/problemCopy.ts for why the two surfaces
// share the wording and the colours but not the markup.
import {
  DESIGN_AMBER,
  DESIGN_ORANGE,
  DESIGN_RED,
  PROBLEM_COLOR,
  PROBLEM_LABEL,
  bucketFor,
  isReasoningProblem,
  popoverCopyFor
} from './components/problemCopy'
import type { Bucket } from './components/problemCopy'

const FONT_STACK = "'Instrument Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif"

// Widget mark: just the Tracely "T" glyph, no background — `figma-logo.png`
// is transparent everywhere except the mark itself (unlike `logo.png`,
// which is the app-icon version with its own solid orange-square
// background baked in, wrong for sitting inside the widget's own black
// circle). `brightness(0) invert(1)` flattens the mark's orange gradient to
// solid white while leaving the transparent pixels transparent, since the
// black circle behind it is the widget's own background, not the logo's.
function LogoBg({ size }: { size: number }): JSX.Element {
  return (
    <img
      src={figmaLogo}
      alt=""
      draggable={false}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        // The image is a flex item in a fixed-size row. Without this, `width`
        // gets shrunk to fit while `height` does not, which squashes the mark.
        flexShrink: 0,
        userSelect: 'none',
        pointerEvents: 'none',
        filter: 'brightness(0) invert(1)'
      }}
    />
  )
}

// Per-claim-type color used for the type dot — matches the Figma "Overlay
// Mockup" frames' 4-color legend (factual/statistic/reasoning/other), not the
// prior pastel-badge palette. `Bucket` and `bucketFor` are imported from
// problemCopy.ts, which the document editor shares.

// -- Design tokens, taken from Figma ----------------------------------
//
// "Real Tracely UI" (file k7R5x1M9alKktaMLlZFSJn), the Overlay Mockup frames.
// These are read off the design rather than chosen here, because the previous
// values were chosen here — a near-miss palette (#17171b vs #1c1c1c, #f47b20
// vs #ff5900) and pill-shaped buttons where the design has 8px rounded rects,
// which together read as a different product rather than as a small drift.
//
// Anything that looks arbitrary below is arbitrary in Figma too. Change it
// there first.

/** Text, and the primary button's fill. */
const INK = '#1c1c1c'
/** Body copy and secondary labels. */
const MUTED = '#737373'
/** Metadata: venue, year, timing hints — the quietest text on a card. */
const DIM = '#9a9ba1'
/** Tracely orange. Progress, the factual claim bucket, the count badge. */
const ACCENT = '#ff5900'
/** Agreement: match percentages, confirmations. */
const POSITIVE = '#16a34a'
/** Button and divider hairlines. */
const HAIRLINE = '#d9d9d9'
/** Fill behind a selected row. */
const SELECTED_BG = '#f8f8f8'
/** Fill behind a neutral pill (the citation-style chip). */
const CHIP_BG = '#f2f2f2'

// A 2px BLACK border, not a hairline in the ink colour. The overlay floats
// over someone else's application, where a soft 1px edge dissolves into
// whatever is behind it; the design commits to a hard outline for that reason.
const CARD_BORDER = '2px solid #000000'
const PANEL_BORDER = '1px solid #000000'
const PANEL_RADIUS = 24
const PANEL_SHADOW = '0px 8px 12px 0px rgba(0, 0, 0, 0.18)'
const CARD_SHADOW = '0px 8px 24px 0px rgba(0, 0, 0, 0.18)'
const CARD_RADIUS = 16

// 8px rounded rectangles, not pills. The buttons were the most visible drift:
// a 999px radius at 9x18 padding reads as a chat UI, and the design is a
// document tool.
const PRIMARY_BTN_STYLE: CSSProperties = {
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  cursor: 'pointer',
  background: INK
}

const SECONDARY_BTN_STYLE: CSSProperties = {
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 400,
  color: INK,
  background: '#fff',
  cursor: 'pointer'
}

const BUCKET_COLOR: Record<Bucket, string> = {
  factual: ACCENT,
  statistic: '#7c3aed',
  causal: '#2f6fed',
  other: '#d6301a'
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

type Underlines = ScreenWatchOverlayUpdateEvent['underlines']

// How long a still-tracked claim keeps its last known rects after an update
// arrives without them. Comfortably under one POLL_INTERVAL_MS (1200ms), so
// a claim that has genuinely scrolled away still clears on the next tick.
const RECT_GRACE_MS = 900

// How long the cursor must rest on a claim before its evidence search
// starts. Long enough that crossing a paragraph doesn't fire a search per
// claim; short enough that the search is already running by the time
// someone has read the popover's first line.
const HOVER_SEARCH_DWELL_MS = 220

/**
 * Smooths the one-frame gaps in the underline stream.
 *
 * `FindText`/`GetBoundingRectangles` in uia-watch.ps1 intermittently returns
 * nothing for a claim that is still perfectly visible — mid-reflow, mid-
 * scroll, or while the target app is repainting. Rendering that literally
 * makes the underline blink out and back, which reads as the UI being
 * broken rather than as a missed measurement.
 *
 * A claim's previous rects are therefore held for RECT_GRACE_MS, but ONLY
 * while it is still in `trackedIds` (i.e. the service still considers it a
 * live claim). A claim that was dismissed, cited or re-detected away
 * disappears immediately, because for those the empty payload is the truth
 * rather than a measurement gap.
 */
function useStableUnderlines(underlines: Underlines, trackedIds: Set<string>): Underlines {
  const held = useRef<Map<string, { entry: Underlines[number]; since: number }>>(new Map())
  const [stable, setStable] = useState<Underlines>(underlines)
  const sweep = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The previous *payload* (not the merged output). Comparing against the
  // last real measurement is what makes the hold self-limiting: a claim
  // missing from two payloads in a row has nothing left to re-hold from, so
  // it can only ever be held once rather than indefinitely renewed.
  const lastPayload = useRef<Underlines>(underlines)
  // Read inside the sweep timer without making it a dependency — the set is
  // rebuilt every render and would otherwise restart the timer constantly.
  const trackedRef = useRef(trackedIds)
  trackedRef.current = trackedIds

  useEffect(() => {
    const present = new Set(underlines.map((u) => u.id))
    for (const id of present) held.current.delete(id)

    // Anything in the previous payload that this one dropped, while the
    // service still tracks it, is treated as a measurement gap and held.
    // Note this runs directly rather than inside a setState updater: React
    // defers updaters until render, so doing it there left `held` empty at
    // the point `recompute` read it, and nothing was ever actually held.
    const now = Date.now()
    for (const p of lastPayload.current) {
      if (present.has(p.id) || held.current.has(p.id)) continue
      if (trackedRef.current.has(p.id)) held.current.set(p.id, { entry: p, since: now })
    }

    const recompute = (): void => {
      const at = Date.now()
      for (const [id, v] of held.current) {
        if (!trackedRef.current.has(id) || at - v.since >= RECT_GRACE_MS) held.current.delete(id)
      }
      setStable([...underlines, ...[...held.current.values()].map((v) => v.entry)])

      if (sweep.current) clearTimeout(sweep.current)
      // Re-run exactly when the oldest hold expires, so a held underline
      // actually clears instead of lingering until the next payload.
      if (held.current.size > 0) {
        const oldest = Math.min(...[...held.current.values()].map((v) => v.since))
        sweep.current = setTimeout(recompute, Math.max(50, RECT_GRACE_MS - (Date.now() - oldest)))
      }
    }

    recompute()
    lastPayload.current = underlines

    return () => {
      if (sweep.current) clearTimeout(sweep.current)
    }
  }, [underlines])

  return stable
}

/**
 * One flagged span: a highlighter band plus the line beneath it.
 *
 * Movement is a transform rather than left/top so it composites on the GPU
 * — these sit over another app's window and repaint on every poll, so a
 * layout-triggering animation here is felt, not just measured.
 *
 * The transition is suppressed for large jumps. Rects shift by a few pixels
 * constantly (typing, reflow) and gliding those looks intentional; but when
 * the document scrolls, the same rect can move hundreds of pixels, and
 * animating that sends the underline swooping across unrelated text. Small
 * delta => glide, large delta => cut.
 */
function UnderlineMark({
  claimId,
  x,
  y,
  width,
  height,
  color,
  hovered,
  title
}: {
  claimId: string
  x: number
  y: number
  width: number
  height: number
  color: string
  hovered: boolean
  /** Plain-language name of the problem, so the mark is legible on its own. */
  title: string
}): JSX.Element {
  const prev = useRef<{ x: number; y: number } | null>(null)

  const jumped = prev.current === null || Math.abs(x - prev.current.x) > 40 || Math.abs(y - prev.current.y) > 24

  useEffect(() => {
    prev.current = { x, y }
  })

  return (
    <div
      className="tracely-underline"
      // Identifies which claim this mark belongs to and whether it is
      // currently hovered — the overlay has no text content, so without
      // these its DOM is unreadable when inspecting or preview-testing it.
      data-claim-id={claimId}
      data-hovered={hovered ? 'true' : 'false'}
      // Also the DOM handle the preview harness asserts on, so a mark's kind is
      // checkable without reading a colour out of a screenshot.
      data-problem={title}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        // The band covers the text itself; the extra 4px below leaves room
        // for the line to sit clear of descenders (g, y, p).
        height: height + 4,
        transform: `translate3d(${x}px, ${y}px, 0)`,
        transition: jumped
          ? 'none'
          : 'transform 150ms cubic-bezier(0.22, 1, 0.36, 1), width 150ms cubic-bezier(0.22, 1, 0.36, 1)',
        willChange: 'transform',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          position: 'absolute',
          // Extends 2px above the text's own bounding box. A band clipped
          // exactly to the glyph box reads as a background colour change;
          // a little air above it reads as a highlighter stroke.
          inset: '-2px 0 3px 0',
          // Translucent, not opaque: the overlay window sits ON TOP of the
          // watched app, so anything solid here would hide the very text it
          // is meant to be highlighting. This is a highlighter pen, and the
          // words have to stay readable through it.
          //
          // 0.30, not the 0.16 this started at — that composited to about
          // rgb(253,236,222) over white, which is invisible in practice
          // next to black body text. Anything past ~0.35 starts fighting
          // the text for contrast.
          background: withAlpha(color, 0.3),
          borderRadius: 3,
          opacity: hovered ? 1 : 0,
          transform: hovered ? 'scaleY(1)' : 'scaleY(0.72)',
          transformOrigin: 'bottom',
          transition: 'opacity 110ms ease, transform 110ms cubic-bezier(0.22, 1, 0.36, 1)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          // 2px tall with a 1px radius, at full strength — the design's
          // `rounded-[1px]` marks. It was a 2px radius at 0.85 opacity, which
          // on a 2px bar rounds it into a capsule and washes the colour.
          height: hovered ? 3 : 2,
          borderRadius: 1,
          background: color,
          opacity: 1,
          transition: 'height 110ms ease'
        }}
      />
    </div>
  )
}

const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  statistic: 'Statistic',
  causal: 'Causal claim',
  factual: 'Factual claim',
  prediction: 'Prediction',
  opinion: 'Opinion'
}

// >=70/40 thresholds match the main app's score-good/mid/low bands
// (ClaimCard/EvidenceScoreCard) so a score reads the same wherever it shows
// up in Tracely.
function evidenceScoreColor(score: number): string {
  if (score >= 70) return POSITIVE
  if (score >= 40) return '#b3690a'
  return '#d6301a'
}

// A plain filled dot — the Figma mockups mark claim type with a simple
// colored circle next to the label, not a pastel letter badge.
function TypeDot({ claimType, size = 9 }: { claimType: ClaimType; size?: number }): JSX.Element {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: BUCKET_COLOR[bucketFor(claimType)],
        flexShrink: 0,
        display: 'inline-block'
      }}
    />
  )
}

// Sized to comfortably fit the full action card (claim text, evidence row,
// Check Claim/Find Evidence buttons, and — once run — the critique
// result), not just a couple of lines like the original glance-only popup.
// How long a paragraph highlight stays lit after clicking its ¶ chip. Long
// enough to look up from the panel and find the underline, short enough that a
// forgotten highlight clears itself.
/**
 * Same detection main runs, for the brief window where a claim has a hover
 * target but its payload has not arrived yet.
 *
 * Duplicated rather than shared because the real one lives in
 * services/screenWatch/inlineCitation.ts — main-process code the renderer must
 * not import. Kept deliberately to the two shapes that carry the copy
 * difference; main's fuller set decides what is actually flagged.
 */
// DESIGN_ORANGE/AMBER/RED and PROBLEM_COLOR are imported from
// components/problemCopy.ts — the document editor draws the same marks and the
// two surfaces must not diverge on which colour means what.

/**
 * The popover's two text styles, shared by every card in it.
 *
 * Identical across all eight Figma popover frames — 14px SemiBold ink for the
 * title, 13px Regular at 1.4 for the body — so they are defined once rather
 * than repeated at each call site and allowed to drift apart.
 */
const POPOVER_TITLE: CSSProperties = { fontSize: 14, fontWeight: 600, color: INK }
const POPOVER_BODY: CSSProperties = { fontSize: 13, lineHeight: 1.4, color: MUTED }

/**
 * The 16x10 arrow every "Hover Popover" frame draws, pointing at the sentence.
 *
 * The overlay had no tail at all: a card simply appeared near the text with
 * nothing tying it to the words it was about, which on a document with three
 * flagged sentences within a few lines of each other is genuinely ambiguous.
 *
 * The path is Figma's own (node 288:545), stroked 2px black to match the card's
 * outline, and the tail overlaps the card edge by TAIL_OVERLAP so the two
 * strokes meet instead of leaving a hairline of white between them — the same
 * 2px the design uses (tail at y=103 h=10, card top at y=111).
 */
const TAIL_WIDTH = 16
const TAIL_HEIGHT = 10
const TAIL_OVERLAP = 2

function PopoverTail({ left, pointing }: { left: number; pointing: 'up' | 'down' }): JSX.Element {
  return (
    <svg
      width={TAIL_WIDTH}
      height={TAIL_HEIGHT}
      viewBox="0 0 13.8564 7.5"
      fill="none"
      aria-hidden="true"
      style={{
        position: 'relative',
        left,
        flexShrink: 0,
        display: 'block',
        transform: pointing === 'down' ? 'scaleY(-1)' : undefined,
        ...(pointing === 'up' ? { marginBottom: -TAIL_OVERLAP } : { marginTop: -TAIL_OVERLAP })
      }}
    >
      <path d="M11.5708 6.5H2.28562L6.9282 1.47363L11.5708 6.5Z" fill="white" stroke="black" strokeWidth="2" />
    </svg>
  )
}

const HIGHLIGHT_HOLD_MS = 2500

// Two widths, because the design uses two. The inline-detection popovers are
// 320 — a glance over someone's document, sized to be read without moving your
// eyes far. The citation flow is 380, because a list of candidate sources with
// titles, venues and match percentages does not fit in 320. Using one width for
// both made every glance card a third wider than designed.
const POPOVER_WIDTH_GLANCE = 320
const POPOVER_WIDTH_FLOW = 380
// Used only to decide above-vs-below before anything has rendered. It is NOT
// used to position anything — see the note on `popoverPosition`.
const POPOVER_EST_HEIGHT = 320
const POPOVER_GAP = 10
const POPOVER_PADDING = 8

/**
 * Places the popover so it can never be clipped, without measuring it.
 *
 * The previous version clamped `top` against POPOVER_EST_HEIGHT (320) while
 * setting `maxHeight` to nearly the whole viewport, so anything taller than the
 * estimate — a citation flow with a candidate list and a works-cited block
 * comfortably is — rendered past the bottom of the overlay window and was cut
 * off by the OS, with no way to scroll to the rest.
 *
 * Two changes remove the estimate from the maths entirely:
 *
 *   - `maxHeight` is the space actually available on the chosen side, so the
 *     popover scrolls internally instead of overflowing. It already had
 *     `overflow-y: auto`; it was just never given a reason to use it.
 *   - Placing above anchors `bottom` rather than `top`. The box then grows
 *     upward from the anchor on its own, so its real height never has to be
 *     known in advance. Guessing it was the whole problem.
 */
function popoverPosition(
  anchor: { x: number; y: number; width: number; height: number },
  preferredWidth: number
): {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
} {
  const width = Math.min(preferredWidth, Math.max(1, window.innerWidth - POPOVER_PADDING * 2))
  const left = Math.min(
    Math.max(POPOVER_PADDING, anchor.x),
    Math.max(POPOVER_PADDING, window.innerWidth - width - POPOVER_PADDING)
  )

  const spaceBelow = window.innerHeight - (anchor.y + anchor.height) - POPOVER_GAP - POPOVER_PADDING
  const spaceAbove = anchor.y - POPOVER_GAP - POPOVER_PADDING
  const placeAbove = spaceBelow < POPOVER_EST_HEIGHT && spaceAbove > spaceBelow

  if (placeAbove) {
    return {
      left,
      bottom: Math.max(POPOVER_PADDING, window.innerHeight - (anchor.y - POPOVER_GAP)),
      width,
      maxHeight: Math.max(1, spaceAbove)
    }
  }
  return {
    left,
    top: Math.max(POPOVER_PADDING, anchor.y + anchor.height + POPOVER_GAP),
    width,
    maxHeight: Math.max(1, spaceBelow)
  }
}

// Mirrors computeAllPanelSize/GRID_* in screenWatchService.ts — "Show all"
// is a single vertical column (not a grid), so the panel's actual on-screen
// size is computed server-side (so hoverTracking.ts's click-through
// hit-test region matches what's drawn) and has to reproduce the exact same
// size math here or the list wouldn't fit the panel sized for it.
const GRID_CARD_WIDTH = 432
const GRID_CARD_HEIGHT = 62
const GRID_GAP = 10
const GRID_PADDING = 24
const PANEL_PADDING_Y = 22
const PANEL_HEADER_HEIGHT = 30
const PANEL_GAP = 16

// Card/panel visual tokens — near-black outline + soft neutral shadow, no
// glow/colored strip, matching the Figma "Overlay Mockup" frames. This is
// also just the main app's own light-mode border/text tokens
// (rgba(0,0,0,0.18-0.26) / #000000 in styles/index.css) at full opacity, so
// it reads as consistent with the rest of the UI rather than a one-off.
// A plain text link, no border/background — the least visually heavy
// action on a card, used for anything that closes/skips/reverts rather
// than does something.
const TEXT_BTN_STYLE: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  fontSize: 13,
  fontWeight: 500,
  color: MUTED,
  cursor: 'pointer'
}

// The evidence-row content shared by both the widget panel's action card
// and the citation-flow candidate list — a spinner while the background
// search (kicked off the moment the claim was detected, see
// triggerEvidenceSearch in screenWatchService.ts) hasn't resolved yet,
// otherwise a colored score + source count.
function EvidenceRow({ claim, compact }: { claim: ScreenWatchClaimSummary; compact?: boolean }): JSX.Element {
  if (!claim.evidence) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: compact ? 11 : 12, color: DIM }}>
        <span className="tracely-spinner" />
        Searching evidence…
      </div>
    )
  }
  const color = evidenceScoreColor(claim.evidence.score)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: compact ? 11 : 12 }}>
      <span style={{ fontWeight: 700, color }}>{claim.evidence.score}/100</span>
      <span style={{ color: DIM }}>
        · {claim.evidence.count} source{claim.evidence.count === 1 ? '' : 's'}
      </span>
    </div>
  )
}

// A monogram badge per search provider, in place of a real favicon — there
// is no source "site" to fetch a favicon from (these are academic search
// APIs, not the underlying publisher sites), and fetching one from a
// third-party favicon service would mean sending claim-related domains to
// an external host and loosening this window's CSP (img-src is locked to
// 'self'/data: — see overlay.html). Since the provider set is small and
// fixed, a distinct colored monogram per provider is a safe stand-in that
// still gives each source a recognizable identity at a glance.
const PROVIDER_LABEL: Record<SourceProvider, string> = {
  openalex: 'OA',
  crossref: 'CR',
  semanticscholar: 'S2',
  pubmed: 'PM',
  wikipedia: 'W',
  worldbank: 'WB',
  manual: '•'
}

const PROVIDER_COLOR: Record<SourceProvider, string> = {
  openalex: '#1a56db',
  crossref: '#0f766e',
  semanticscholar: '#6d28d9',
  pubmed: '#15803d',
  // Deliberately the same grey as 'manual' rather than a brand colour. An
  // encyclopedia entry is orientation, not evidence, and its badge should not
  // compete for attention with the peer-reviewed sources beside it.
  wikipedia: '#6b7280',
  worldbank: '#0071bc',
  manual: '#6b7280'
}

function ProviderBadge({ provider }: { provider: SourceProvider }): JSX.Element {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        background: PROVIDER_COLOR[provider],
        color: '#fff',
        fontSize: 10,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      {PROVIDER_LABEL[provider]}
    </div>
  )
}

// Real favicon for the source's own site when one was fetched (see
// main/services/search/favicon.ts — a data: URI, so it satisfies this
// window's img-src 'self' data: CSP with no changes needed) — falls back to
// the plain provider monogram while it's still loading or unavailable, so a
// source row is never left with a broken/empty icon.
function SourceIcon({ provider, faviconDataUrl }: { provider: SourceProvider; faviconDataUrl: string | null }): JSX.Element {
  if (!faviconDataUrl) return <ProviderBadge provider={provider} />
  return (
    <div
      style={{
        // Figma draws a solid provider tile with two letters here. Per the
        // design review we keep the real favicon instead — it identifies the
        // actual publication rather than which API returned it — but in the
        // design's 28px / 8px-radius box, so a row of favicons and a row of
        // monogram fallbacks line up to the same grid.
        width: 28,
        height: 28,
        borderRadius: 8,
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
        border: '1px solid #ededed'
      }}
    >
      <img src={faviconDataUrl} alt="" width={18} height={18} style={{ objectFit: 'contain' }} />
    </div>
  )
}

function openUrl(url: string | null): void {
  if (!url) return
  void window.tracely.shell.openExternal({ url })
}

// Same verdict vocabulary/colors as EvidenceScoreCard.tsx in the main app —
// this card is meant to read as the same feature, not a stripped-down
// lookalike, just rendered with inline styles since this window has no
// shared stylesheet to pull CSS classes/variables from.
const VERDICT_LABEL: Record<CritiqueVerdict, string> = {
  'well-supported': 'Well Supported',
  'partially-supported': 'Partially Supported',
  weak: 'Weak',
  unsupported: 'Unsupported',
  contradicted: 'Contradicted — False',
  fabricated: 'Source Not Found — May Be Fabricated',
  overstated: 'Overstated — Narrow the Claim'
}

// Drives the score row's copy: findings listed here read as "N issues found",
// everything else as "Reviewed · <verdict>". `fabricated` and `overstated`
// belong with the findings — "Reviewed · Source Not Found" reads as a clean
// bill of health for the most serious thing this product can say.
const WEAK_VERDICTS: CritiqueVerdict[] = [
  'weak',
  'unsupported',
  'contradicted',
  'fabricated',
  'overstated'
]

// -- The widget panel: Figma "Overlay Mockup - Widget over Document" ---------
//
// What the black launcher circle opens. The hover popover is a glance over
// someone's document and stays the lighter ProblemCard/CitationFlowCard below;
// this is the workspace you deliberately opened, and it follows the design's
// three "Widget over Document" frames rather than the "Argument Score Card"
// frame it used to draw.

/**
 * Widget-surface tokens. The panel runs a slightly different palette from the
 * hover popover in Figma — darker ink, warmer body grey, its own divider — and
 * its buttons are pills where the popover's are 8px rectangles. That is not an
 * inconsistency to reconcile: the popover is a glance over someone's document,
 * the panel is a workspace you have deliberately opened.
 */
const W_INK = '#1a1a1f'
const W_BODY = '#55565c'
const W_DIVIDER = '#e7e7e7'
const W_TRACK = '#f0f0f0'

// The three pill states the "Widget over Document" frames draw: filled for the
// action the panel is offering, outlined for the one it isn't, and a flat grey
// for an action already spent ("✓ Evidence Refreshed").
//
// `fontFamily: 'inherit'` is not decoration. A <button> does not inherit the
// document font, so without it these drew in the UA default while every label
// around them drew in Instrument Sans — the same class of near-miss that had
// the overlay never loading the typeface at all.
const WIDGET_PRIMARY_BTN: CSSProperties = {
  border: 'none',
  borderRadius: 999,
  padding: '12px 18px',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  color: '#fff',
  background: '#111',
  cursor: 'pointer'
}

const WIDGET_SECONDARY_BTN: CSSProperties = {
  border: '1.5px solid #111',
  borderRadius: 999,
  padding: '12px 18px',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  color: W_INK,
  background: '#fff',
  cursor: 'pointer'
}

const WIDGET_SPENT_BTN: CSSProperties = {
  border: 'none',
  borderRadius: 999,
  padding: '12px 18px',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  color: '#8a8b90',
  background: '#f0f0f0',
  cursor: 'default'
}

/** Full-width, hairline-outlined — the design's "Show all (4)" row. */
const WIDGET_SHOW_ALL_BTN: CSSProperties = {
  width: '100%',
  border: '1.5px solid #e2e2e2',
  borderRadius: 999,
  padding: '12px 18px',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  color: W_INK,
  background: '#fff',
  cursor: 'pointer'
}

/**
 * How long "Updated just now" stays true. A chip that says "just now" twenty
 * minutes later is a small lie the panel has no reason to tell.
 */
const FRESH_EVIDENCE_MS = 60_000

/** The critique rows' amber "!" tile, and the "Updated just now" chip. */
const AMBER_BG = '#fef3c7'
const AMBER_FG = '#d97706'
const FRESH_BG = '#dcfce7'

/** A source row at the panel's scale — the popover's ArticleRow is smaller. */
/** Stable enough to diff two searches: title + year, which is what a source
 *  row shows. DOIs are not carried on ScreenWatchEvidenceArticle. */
function articleKey(article: ScreenWatchEvidenceArticle): string {
  return `${article.title}::${article.year ?? ''}`
}

function PanelSourceRow({
  article,
  isNew
}: {
  article: ScreenWatchEvidenceArticle
  isNew: boolean
}): JSX.Element {
  const meta = [article.venue, article.year ? String(article.year) : null].filter(Boolean).join(' · ')
  const content = (
    <>
      <SourceIcon provider={article.provider} faviconDataUrl={article.faviconDataUrl} />
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div
          title={article.title}
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: W_INK,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {article.title}
        </div>
        {meta ? <div style={{ fontSize: 12, color: DIM }}>{meta}</div> : null}
        {/* Only after an explicit refresh, and only on rows the previous
            search did not return — otherwise "New" is decoration. */}
        {isNew ? <div style={{ fontSize: 11, fontWeight: 600, color: POSITIVE }}>New</div> : null}
      </div>
    </>
  )
  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }
  if (!article.url) return <div style={rowStyle}>{content}</div>
  const url = article.url
  return (
    // eslint-disable-next-line jsx-a11y/anchor-is-valid
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault()
        openUrl(url)
      }}
      style={{ ...rowStyle, cursor: 'pointer' }}
    >
      {content}
    </a>
  )
}

/**
 * A proposed replacement — the narrowed sentence, or the corrected reference.
 *
 * Deliberately NOT a CritiqueIssueRow. Those rows say what is wrong; this one
 * carries text the writer is meant to put in their document, and the two should
 * not look alike. The amber "!" tile is dropped, the text sits in a bordered
 * block so it reads as a quotation of something proposed rather than as more
 * commentary, and Copy is the only action.
 *
 * Copy rather than "Apply": the overlay watches an arbitrary window over UIA
 * and has no write access to the document underneath it, so a button that
 * appeared to edit the sentence would be lying about what it can reach. It also
 * keeps the last word with the writer, which is the point — Tracer's prompt
 * refuses to compose sentences for students, and the only reason this is
 * allowed to exist at all is that narrowing a quantifier corrects accuracy
 * rather than writing prose.
 */
function CritiqueFixRow({
  label,
  text,
  monospace
}: {
  label: string
  text: string
  /** Citations only: a reference is read character by character. */
  monospace?: boolean
}): JSX.Element {
  const [copied, setCopied] = useState(false)

  // Cleared on a timer, so the button does not sit on "Copied" forever if the
  // panel stays open — and cleaned up on unmount, because the panel is
  // remounted every time the hovered claim changes.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: W_BODY, letterSpacing: 0.2 }}>{label}</div>
        <button
          className="tracely-btn-secondary"
          onClick={() => {
            // No catch that surfaces anything: a clipboard write can be refused
            // and there is nothing useful to tell the user about it here. The
            // text is selectable, which is the fallback.
            void navigator.clipboard?.writeText(text).then(
              () => setCopied(true),
              () => undefined
            )
          }}
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: 999,
            border: `1px solid ${W_DIVIDER}`,
            background: '#fff',
            color: W_BODY,
            cursor: 'pointer',
            flexShrink: 0
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div
        style={{
          fontSize: monospace ? 12.5 : 13.5,
          fontFamily: monospace ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
          lineHeight: 1.45,
          color: W_INK,
          background: W_TRACK,
          border: `1px solid ${W_DIVIDER}`,
          borderRadius: 8,
          padding: '8px 10px',
          // Selectable, so Copy failing is inconvenient rather than a dead end.
          userSelect: 'text',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {text}
      </div>
    </div>
  )
}

function CritiqueIssueRow({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: AMBER_BG,
          color: AMBER_FG,
          fontSize: 10,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        !
      </div>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {title ? (
          <div
            title={title}
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: W_INK,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {title}
          </div>
        ) : null}
        {detail ? (
          <MarkdownText style={{ fontSize: 12, lineHeight: 1.35, color: DIM }}>{detail}</MarkdownText>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The panel's single-claim card — Figma "Overlay Mockup - Widget over Document"
 * and its two result variants.
 *
 * One component, three states, because the frames differ only in their middle
 * block and which pill is filled:
 *  - base (282:70)         sources, Refresh Evidence filled
 *  - refreshed (291:144)   sources + "Updated just now" + "New", refresh spent
 *  - critique (291:251)    the critique as issue rows, Critique filled
 *
 * What this deliberately no longer shows is the 0–100 evidence score and its
 * four-factor breakdown. That is a different frame — "Argument Score Card" —
 * and this is the one the launcher opens.
 */
function WidgetClaimCard({
  claim,
  body,
  evidenceBusy,
  critiqueBusy,
  freshlyRefreshed,
  newArticleKeys,
  showAllCount,
  onRefreshEvidence,
  onCritique,
  onShowAll
}: {
  claim: ScreenWatchClaimSummary
  /** Which of the two result blocks is showing — set by the last action taken. */
  body: 'sources' | 'critique'
  evidenceBusy: boolean
  critiqueBusy: boolean
  freshlyRefreshed: boolean
  /** Article keys the search returned that the previous one did not. */
  newArticleKeys: Set<string> | null
  showAllCount: number
  onRefreshEvidence: () => void
  onCritique: () => void
  onShowAll: () => void
}): JSX.Element {
  const evidence = claim.evidence
  const issues = claim.critique ? critiqueIssues(claim.critique) : []
  const showCritique = body === 'critique' && issues.length > 0
  const verdictLabel = claim.critiqueVerdict ? VERDICT_LABEL[claim.critiqueVerdict] : 'Critique'
  const weakVerdict = claim.critiqueVerdict !== null && WEAK_VERDICTS.includes(claim.critiqueVerdict)

  const refreshLabel = evidenceBusy
    ? 'Searching…'
    : freshlyRefreshed && !showCritique
      ? '✓ Evidence Refreshed'
      : evidence
        ? 'Refresh Evidence'
        : 'Find Evidence'
  const refreshStyle = showCritique
    ? WIDGET_SECONDARY_BTN
    : freshlyRefreshed && !evidenceBusy
      ? WIDGET_SPENT_BTN
      : WIDGET_PRIMARY_BTN
  const critiqueStyle = showCritique ? WIDGET_PRIMARY_BTN : WIDGET_SECONDARY_BTN

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TypeDot claimType={claim.claimType} />
        <div style={{ fontSize: 15, fontWeight: 700, color: W_INK }}>
          {CLAIM_TYPE_LABEL[claim.claimType]} · {Math.round(claim.confidence * 100)}% confidence
        </div>
      </div>
      <div
        style={{
          fontSize: 14.5,
          lineHeight: 1.4,
          color: W_BODY,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}
      >
        &ldquo;{claim.text}&rdquo;
      </div>

      {/* The design's one-line "score row": what the block below it is a list
          OF, rather than a rating of the claim. */}
      {showCritique ? (
        <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a' }}>
          {weakVerdict
            ? `${issues.length} issue${issues.length === 1 ? '' : 's'} found`
            : `Reviewed · ${verdictLabel}`}
        </div>
      ) : evidence ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#8a8b90' }}>
            {evidence.count} source{evidence.count === 1 ? '' : 's'}
          </span>
          {freshlyRefreshed ? (
            <span
              style={{
                background: FRESH_BG,
                color: POSITIVE,
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 999,
                padding: '3px 10px'
              }}
            >
              Updated just now
            </span>
          ) : null}
        </div>
      ) : (
        <EvidenceRow claim={claim} />
      )}

      {showCritique ? (
        // Deliberately NOT its own scroll region. A critique carrying issue
        // rows plus a revision plus a citation fix is the tallest thing this
        // card renders, and the first instinct is to make this block scroll —
        // but the panel that wraps it already does, for exactly this reason
        // (see the `overflowY` on the 'single' container near the end of this
        // file). Adding one here nests a second scrollbar inside the first.
        // Long source lists have always overflowed the same way; the critique
        // should behave like them.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
          {issues.map((issue, i) => (
            <CritiqueIssueRow
              key={`${issue.title}-${i}`}
              // The verdict stands in for a missing title on the FIRST row
              // only. Prose that never splits into a heading is common, and
              // using the verdict every time printed "Weak" down the whole
              // list as if it were three separate findings.
              title={issue.title || (i === 0 ? verdictLabel : '')}
              detail={issue.detail}
            />
          ))}
          {/* After the issues, never instead of them. The critique explains WHY
              the sentence overreaches; this is the sentence to replace it with,
              and showing the replacement without the reasoning would train the
              writer to accept edits they do not understand. */}
          {claim.suggestedRevision ? (
            <CritiqueFixRow label="Suggested revision" text={claim.suggestedRevision} />
          ) : null}
          {claim.citationFix ? (
            <CritiqueFixRow label="Citation, corrected" text={claim.citationFix} monospace />
          ) : null}
        </div>
      ) : evidence && evidence.articles.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
          {evidence.articles.map((article, i) => (
            <PanelSourceRow
              key={`${article.title}-${i}`}
              article={article}
              isNew={newArticleKeys !== null && !newArticleKeys.has(articleKey(article))}
            />
          ))}
        </div>
      ) : null}

      {/* Pushes the two action rows to the bottom edge of the card. The panel
          is a fixed height (SINGLE_PANEL_HEIGHT, sized for the tallest of the
          three frames), so a claim with fewer sources than the mockup would
          otherwise leave its buttons floating mid-card. */}
      <div style={{ flex: 1, minHeight: 0 }} />

      <div style={{ display: 'flex', gap: 10, width: '100%' }}>
        <button
          className={refreshStyle === WIDGET_PRIMARY_BTN ? 'tracely-btn-primary' : 'tracely-btn-secondary'}
          onClick={onRefreshEvidence}
          disabled={evidenceBusy}
          style={{
            ...refreshStyle,
            flex: '1 0 0',
            minWidth: 0,
            whiteSpace: 'nowrap',
            opacity: evidenceBusy ? 0.6 : 1,
            cursor: evidenceBusy ? 'default' : refreshStyle.cursor
          }}
        >
          {refreshLabel}
        </button>
        <button
          className={critiqueStyle === WIDGET_PRIMARY_BTN ? 'tracely-btn-primary' : 'tracely-btn-secondary'}
          onClick={onCritique}
          disabled={critiqueBusy}
          style={{
            ...critiqueStyle,
            flex: '1 0 0',
            minWidth: 0,
            whiteSpace: 'nowrap',
            opacity: critiqueBusy ? 0.6 : 1,
            cursor: critiqueBusy ? 'default' : 'pointer'
          }}
        >
          {critiqueBusy ? 'Checking…' : claim.critique ? 'Re-check Argument' : 'Critique Argument'}
        </button>
      </div>

      {showAllCount > 1 ? (
        <button className="tracely-btn-secondary" onClick={onShowAll} style={WIDGET_SHOW_ALL_BTN}>
          Show all ({showAllCount})
        </button>
      ) : null}
    </>
  )
}

// Clicking a card switches to the single-claim view focused on it (see
// selectedClaimId in OverlayApp) — that's where Check Claim/Find Evidence
// actions live. Simplified to dot + header + quote (no inline evidence
// preview) to match the "All Claims List" mockup's plain row style.
function ClaimListItem({ claim, onClick }: { claim: ScreenWatchClaimSummary; onClick: () => void }): JSX.Element {
  return (
    <button
      className="tracely-list-row"
      onClick={onClick}
      title="View this claim"
      style={{
        boxSizing: 'border-box',
        width: '100%',
        height: GRID_CARD_HEIGHT,
        border: '1px solid #eaeaea',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: '#fff',
        overflow: 'hidden',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        flexShrink: 0
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <TypeDot claimType={claim.claimType} size={8} />
        {/* One line, reading as a sentence: "Factual claim · 90% confidence".
            It used to be an uppercase micro-label with the percentage pushed to
            the far right, which turned a description of the claim into two
            unrelated pieces of metadata. */}
        <div style={{ fontSize: 13.5, fontWeight: 600, color: W_INK, whiteSpace: 'nowrap' }}>
          {CLAIM_TYPE_LABEL[claim.claimType]} · {Math.round(claim.confidence * 100)}% confidence
        </div>
      </div>
      {/* A single ellipsised line, not a two-line clamp — every row is then the
          same height, which is what lets the panel be sized from a row count. */}
      <div
        style={{
          fontSize: 13,
          color: '#6b6c72',
          width: '100%',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        &ldquo;{claim.text}&rdquo;
      </div>
    </button>
  )
}

// -- Structure: the draft's argument, not its sentences ---------------
//
// The same reading the in-app Structure rail shows, computed over whatever
// document Screen Watch is watching. Everything behind it is local — paragraph
// splitting, the role heuristics, the rubric, the weakness rules — so unlike
// critique it costs nothing to keep current, which is what makes an always-there
// passive score defensible at all.
//
// Deliberately NOT a port of StructurePanel.tsx. That component is 118
// `docedit-*` class names resolved from styles/index.css, which this window does
// not load — the overlay is inline styles plus the one scoped <style> block at
// the bottom of this file. What is shared is the vocabulary, the role labels and
// the rubric, and those are duplicated below rather than imported, because
// importing the component would drag its stylesheet dependency along with it.

const ROLE_LABEL: Record<ParagraphRole, string> = {
  thesis: 'Thesis',
  claim: 'Claim',
  evidence: 'Evidence',
  reasoning: 'Reasoning',
  significance: 'Significance',
  counterargument: 'Counterargument',
  conclusion: 'Conclusion',
  transition: 'Transition',
  unknown: 'Unlabelled'
}

// Ordered as the rubric reads, not by weight — a writer looks for "do I have a
// thesis" before "how are my warrants doing". Maxima match COMPONENT_MAX in
// services/structure/scoreDraft.ts.
const COMPONENT_ROWS: Array<[keyof StructureComponents, string, number]> = [
  ['thesis', 'Thesis', 20],
  ['governingClaims', 'Governing claims', 20],
  ['warrant', 'Reasoning markers', 20],
  ['counterargument', 'Counterargument', 15],
  ['significance', 'Significance', 15],
  ['conclusion', 'Conclusion', 10]
]

/**
 * The always-visible score, shown in the panel header in every view mode.
 *
 * Rendered as a sibling BEFORE the drag region rather than inside it: that div
 * owns onMouseDown for startWidgetDrag, and a real button nested in it has its
 * click swallowed by the drag-threshold path.
 */
function ScoreChip({
  structure,
  active,
  onOpen
}: {
  /**
   * Null when there is no trustworthy reading yet — the chip still renders.
   *
   * It used to be hidden in that case, which read as tidy and was the actual
   * bug: a draft that never produced a reading left the panel with no entry
   * point, so there was nothing to click and no way to find out why. An empty
   * chip that opens an explanation beats a control that isn't there.
   */
  structure: ScreenWatchStructure | null
  active: boolean
  onOpen: () => void
}): JSX.Element {
  const color = structure ? evidenceScoreColor(structure.score) : DIM
  return (
    <button
      onClick={onOpen}
      title={
        structure
          ? `Argument score ${structure.score} of 100` +
            (structure.complete ? '' : ' — provisional, some paragraphs could not be labelled')
          : 'No structural reading of this draft yet — open for why'
      }
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        flexShrink: 0,
        border: `1px solid ${active ? color : '#e4e4e8'}`,
        background: active ? `${color}14` : '#fff',
        borderRadius: 999,
        padding: '3px 9px',
        cursor: 'pointer',
        font: 'inherit'
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1 }}>
        {structure ? structure.score : '—'}
      </span>
      <span style={{ fontSize: 10.5, color: DIM, lineHeight: 1 }}>argument</span>
      {/* A dot rather than the word "provisional" — the header has room for one
          of them, and the tooltip carries the sentence. */}
      {structure && !structure.complete ? (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#b3690a', flexShrink: 0 }} />
      ) : null}
    </button>
  )
}

// -- Argument Score: the Figma "Essay Grade" frames, labelled honestly -------
//
// Layout from "Real Tracely UI" (k7R5x1M9alKktaMLlZFSJn) frames 370:135 (widget),
// 391:342 (analyzing) and 404:129 (full report): ring, stats row, then a card per
// paragraph. The layout is the design's. The words are not, and that is the whole
// point of this block.
//
// Those frames grade an essay — Thesis Clarity, Grammar & Mechanics, Vocabulary &
// Word Choice, a B+ chip, "above average for this assignment type". Tracely
// measures none of that. It scores how an argument is built, on a different
// six-part rubric. Shipping the design's labels over this data would print
// numbers next to words they do not measure, so the labels here are the rubric's
// own (Merrick's call, 2026-08-14: score the argument, rewrite the labels).
//
// Two things from the design are deliberately absent rather than forgotten:
// the letter grade, because there is no grade band and inventing one implies a
// marking scheme; and "above average for this assignment type", because there is
// no cohort to be above the average of.

/**
 * One rubric component. Percent on the right because the design reads in
 * percentages, `x/20` in the tooltip because the rubric is out of its own maxima
 * and the raw number is what `scoreDraft.ts` actually produced.
 */
function ComponentBar({ value, max, label }: { value: number; max: number; label: string }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      title={`${label}: ${Math.round(value)} of ${max}`}
    >
      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(pct)}%
      </span>
      <span
        style={{
          width: '100%',
          flexBasis: '100%',
          height: 4,
          borderRadius: 2,
          background: '#eeeef1',
          overflow: 'hidden'
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${pct}%`,
            height: '100%',
            borderRadius: 2,
            background: evidenceScoreColor(pct)
          }}
        />
      </span>
    </div>
  )
}

/**
 * The design's score ring. Drawn rather than approximated with a rounded box,
 * because the ring is the one piece of this panel a user recognises at a glance.
 *
 * `strokeDasharray` on a circle rotated -90° fills clockwise from twelve o'clock,
 * which is the direction the frames draw.
 */
function ScoreRing({ score }: { score: number }): JSX.Element {
  const color = evidenceScoreColor(score)
  const radius = 29
  const circumference = 2 * Math.PI * radius
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference
  return (
    <svg width={74} height={74} viewBox="0 0 74 74" role="img" aria-label={`Argument score ${score} of 100`}>
      <circle cx="37" cy="37" r={radius} fill="none" stroke="#eeeef1" strokeWidth="6" />
      <circle
        cx="37"
        cy="37"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        transform="rotate(-90 37 37)"
      />
      <text x="37" y="35" textAnchor="middle" dominantBaseline="middle" fontSize="21" fontWeight="700" fill={color}>
        {score}
      </text>
      <text x="37" y="51" textAnchor="middle" fontSize="9" fill={DIM}>
        / 100
      </text>
    </svg>
  )
}

function StatCell({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: INK, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: DIM, letterSpacing: 0.4, marginTop: 2, textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  )
}

/**
 * 238 words per minute — Brysbaert's 2019 meta-analysis of silent reading of
 * English prose. Named rather than inlined so the number is arguable instead of
 * looking like it fell out of the sky.
 */
const READING_WPM = 238

/**
 * Which rubric components belong beside which paragraph role.
 *
 * The design puts one or two metric bars inside each paragraph card, and this is
 * what fills that slot honestly. A component appears beside the role it is a
 * reading of — thesis with the thesis paragraph, counterargument with the
 * counterargument — so the number sits next to the prose it was computed from.
 *
 * IMPORTANT: these are DOCUMENT-level components. `scoreDraft.ts` scores the
 * draft, not each paragraph. Showing one inside a card is context, and nothing in
 * the copy may suggest that paragraph was scored on its own — which is why each
 * component renders exactly once, against the FIRST paragraph carrying its role,
 * rather than repeating down every evidence paragraph as if each had earned its
 * own reading.
 */
const ROLE_COMPONENTS: Partial<Record<ParagraphRole, Array<keyof StructureComponents>>> = {
  thesis: ['thesis'],
  claim: ['governingClaims'],
  evidence: ['governingClaims', 'warrant'],
  reasoning: ['warrant'],
  counterargument: ['counterargument'],
  significance: ['significance'],
  conclusion: ['conclusion', 'significance']
}

const COMPONENT_LABEL = new Map(COMPONENT_ROWS.map(([key, label, max]) => [key, { label, max }]))

/** Strong / Developing / Needs work, on the same 70/40 bands as every other score. */
function verdictFor(pct: number): { text: string; color: string } {
  if (pct >= 70) return { text: 'Strong', color: POSITIVE }
  if (pct >= 40) return { text: 'Developing', color: '#b3690a' }
  return { text: 'Needs work', color: '#c2410c' }
}

function ArgumentScoreView({
  structure,
  liveClaimIds,
  onHighlightParagraph
}: {
  structure: ScreenWatchStructure
  /** Claims still on screen — a weakness pointing at anything else cannot jump. */
  liveClaimIds: Set<string>
  onHighlightParagraph: (index: number, claimId: string | null) => void
}): JSX.Element {
  const { detected, withRelevantSource, withOwnCitation, meanStrength, unchecked } = structure.coverage
  const { words, sentences, uniqueWords } = structure.stats

  // Assigned as the list is built, so a component shown against ¶2 is not shown
  // again against ¶5. What is left over at the end is the genuinely useful
  // signal: a rubric component whose role never appears in the draft at all.
  const claimed = new Set<keyof StructureComponents>()
  const rows = structure.paragraphs.map((paragraph) => {
    const keys = (ROLE_COMPONENTS[paragraph.role] ?? []).filter((key) => !claimed.has(key))
    keys.forEach((key) => claimed.add(key))
    const pcts = keys.map((key) => {
      const meta = COMPONENT_LABEL.get(key)!
      return (structure.components[key] / meta.max) * 100
    })
    return {
      paragraph,
      keys,
      verdict: pcts.length > 0 ? verdictFor(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
      weaknesses: structure.weaknesses.filter((w) => w.paragraphIndex === paragraph.index)
    }
  })
  const missing = COMPONENT_ROWS.filter(([key]) => !claimed.has(key))
  const draftWeaknesses = structure.weaknesses.filter((w) => w.paragraphIndex === null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ScoreRing score={structure.score} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, color: DIM, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Argument score
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginTop: 2 }}>
            How this draft is built
            {/* Not decoration. A draft with unlabelled paragraphs was scored on an
                incomplete reading, and the components it could not assess were
                counted as absent rather than skipped — presenting that as settled
                is the failure this prevents. */}
            {!structure.complete ? (
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#b3690a' }}>Provisional</span>
            ) : null}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, lineHeight: 1.4 }}>
            {/* Three facts, never merged — the same rule as the main app's
                panel. The ratio here used to be withRelevantSource, read out as
                "N of M claims have sources", which says Tracely's search
                results are the only citations that exist and reports "0 of 7"
                over a draft citing something on every line. What the writer
                cited leads, because it is a fact about their document and needs
                no search to know. */}
            {detected === 0 ? (
              'No checkable claims in this draft.'
            ) : (
              <>
                <b>
                  {withOwnCitation} of {detected}
                </b>{' '}
                {detected === 1 ? 'claim carries' : 'claims carry'} your citation
                {/* What retrieval found, said as retrieval and never as "has a
                    source" — and only once something has actually been
                    searched, since an unchecked claim is not an unsupported one
                    and the number must not imply a search has run when it has
                    not. */}
                {detected > unchecked ? (
                  <>
                    {' · '}
                    <span style={{ color: MUTED }}>
                      Tracely backs {withRelevantSource} of {detected - unchecked}
                      {meanStrength !== null ? <> (mean {meanStrength})</> : null}
                    </span>
                  </>
                ) : null}
                {unchecked > 0 ? <span style={{ color: DIM }}> · {unchecked} unchecked</span> : null}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Reading figures, not quality judgements — they describe the draft
          without claiming anything about it, which is why they survived the
          relabel when the design's grade chip did not. */}
      <div style={{ display: 'flex', gap: 10, paddingBottom: 12, borderBottom: '1px solid #ececf0' }}>
        <StatCell value={words.toLocaleString()} label="Words" />
        <StatCell value={`~${Math.max(1, Math.round(words / READING_WPM))} min`} label="Read time" />
        <StatCell value={(words / sentences).toFixed(1)} label="Words / sentence" />
        <StatCell
          value={`${Math.round((uniqueWords / Math.max(1, words)) * 100)}%`}
          label="Vocab diversity"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: 0.4 }}>
          BREAKDOWN BY PARAGRAPH
        </div>
        {rows.map(({ paragraph, keys, verdict, weaknesses }) => (
          <div
            key={paragraph.index}
            data-paragraph={paragraph.index}
            data-role={paragraph.role}
            style={{
              border: '1px solid #ececf0',
              borderRadius: 10,
              padding: '9px 11px',
              display: 'flex',
              flexDirection: 'column',
              gap: 7
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontSize: 10.5, color: DIM, flexShrink: 0 }}>¶{paragraph.index}</span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  fontWeight: 700,
                  color: paragraph.role === 'unknown' ? DIM : INK
                }}
              >
                {ROLE_LABEL[paragraph.role]}
              </span>
              {verdict ? (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10,
                    fontWeight: 600,
                    color: verdict.color,
                    background: `${verdict.color}14`,
                    borderRadius: 20,
                    padding: '2px 8px'
                  }}
                >
                  {verdict.text}
                </span>
              ) : null}
            </div>

            <div
              style={{
                fontSize: 11,
                color: DIM,
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}
            >
              {structure.previews[paragraph.index - 1] ?? ''}
            </div>

            {keys.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                {keys.map((key) => {
                  const meta = COMPONENT_LABEL.get(key)!
                  return (
                    <div key={key} style={{ flex: '1 1 44%', minWidth: 120 }}>
                      <ComponentBar value={structure.components[key]} max={meta.max} label={meta.label} />
                    </div>
                  )
                })}
              </div>
            ) : null}

            {weaknesses.map((weakness, i) => {
              // Only some weaknesses can point at anything on screen — warrant
              // gaps usually fire on paragraphs with no detected claim in them,
              // so a chip that always looked like a button would mostly do
              // nothing.
              const jumpable = (paragraph.claimIds ?? []).some((id) => liveClaimIds.has(id))
              return (
                <div
                  key={`${weakness.kind}-${i}`}
                  style={{
                    display: 'flex',
                    gap: 7,
                    alignItems: 'flex-start',
                    background: '#fff7ed',
                    border: '1px solid #fed7aa',
                    borderRadius: 7,
                    padding: '6px 8px'
                  }}
                >
                  <span style={{ flexShrink: 0, fontSize: 11, color: '#b3690a' }}>!</span>
                  <span style={{ flex: 1, fontSize: 11, lineHeight: 1.45, color: MUTED }}>{weakness.message}</span>
                  {jumpable ? (
                    <button
                      className="tracely-btn-text"
                      onClick={() => onHighlightParagraph(paragraph.index, weakness.claimId)}
                      title="Show this paragraph's claims on screen"
                      style={{ ...TEXT_BTN_STYLE, flexShrink: 0, padding: 0, fontSize: 11 }}
                    >
                      Show
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* The most useful thing on the panel, and it only exists because
          components are assigned to roles above: a component with no paragraph
          to sit beside is one the draft never attempts. */}
      {missing.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: 0.4 }}>
            NOT FOUND IN THIS DRAFT
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.45 }}>
            {missing.map(([, label]) => label).join(' · ')}
          </div>
        </div>
      ) : null}

      {draftWeaknesses.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: 0.4 }}>SUMMARY</div>
          {/* The design writes a paragraph of prose here. These are the rubric's
              own sentences instead: nothing on this path generates text, and a
              summary invented to fill a slot would be the one part of the panel
              that was not a reading of the draft. */}
          {draftWeaknesses.map((weakness, i) => (
            <div key={`${weakness.kind}-${i}`} style={{ fontSize: 11.5, lineHeight: 1.45, color: MUTED }}>
              {weakness.message}
            </div>
          ))}
        </div>
      ) : null}

      {/* Hardcoded rather than driven by a `rolesFrom` field, because this path
          has no model classifier wired to it — the sentence has one value. It
          matters more here than in the app: there is no "re-analyze" button to
          ask for a better reading with. */}
      <div style={{ fontSize: 10.5, color: DIM, lineHeight: 1.4 }}>
        Labelled by local rules, which leave anything they cannot justify unlabelled.
      </div>
    </div>
  )
}

/**
 * What the panel shows when there is no trustworthy structural read.
 *
 * The score chip is now always present, so this state is reachable in a way it
 * never used to be — previously the chip was hidden whenever `structure` was
 * null, which meant a user whose draft never produced a reading had no way in at
 * all and nothing to click. That was the original complaint.
 *
 * It says why rather than spinning. `computeWatchOutline` returns null when
 * `structureFit` judges the text unfit — too short, or no real paragraph
 * boundaries — and that is a fact about the draft the user can act on, not a
 * loading state that will resolve on its own.
 */
function NoReadingView(): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, padding: '26px 16px' }}>
      <ScoreRing score={0} />
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>No reading yet</div>
      <div style={{ fontSize: 11.5, color: MUTED, textAlign: 'center', lineHeight: 1.45, maxWidth: 260 }}>
        The rubric needs a few paragraphs of prose before it has an opinion worth showing. Keep writing and this
        fills in on its own.
      </div>
    </div>
  )
}

// -- Hover popup: ProblemCard -----------------------------------------
//
// The lightweight "Grammarly-style" glance card — a single problem
// statement and one primary action, distinct from the widget panel's
// heavier ClaimActionCard. Which of the three variants shows is derived
// entirely from the claim's own state (critique verdict, evidence
// resolution), not tracked separately.

// A renderer-local `problemKindFor(claim)` used to live here, deciding the
// popover's variant from the claim's verdict and evidence independently of
// main. It has had no call site since main became the single source of truth
// (services/screenWatch/problemKind.ts) and the payload started carrying
// `problemKinds` — and it was actively dangerous to leave lying around: it
// still folded the `contradicted` verdict into 'weak-reasoning', so
// reintroducing one call to it would have quietly restored the bug of telling
// a writer their reasoning is weak when the model said a fact is wrong.
//
// The support bands below are still used, by problemCopyFor.
//
// The underline the user hovered is coloured by bucketFor(claimType) — four
// distinct colours (factual orange, statistic purple, causal blue, other red).
// The popup, however, collapsed every one of them that wasn't a statistic into
// the single title "Missing citation", with a description asserting the claim
// "isn't backed by a source anywhere in your document". So four visibly
// different underlines said the same thing, and they said it even when the
// background evidence search had already come back with well-scoring sources —
// the card had `claim.evidence.count` in hand and used it only to pick the
// button label.
//
// Two independent axes were being flattened into one:
//   - WHAT KIND of assertion this is        -> claimType, which is the colour
//   - HOW IT FARED against the evidence     -> evidence.count / evidence.score
// so the title now names the kind, and the description reports the finding.
// Thresholds are the same 70/40 bands as evidenceScoreColor and the main app's
// ClaimCard, so "weak" means the same number everywhere in the product.

// supportLevelFor, KIND_NOUN and problemCopyFor moved to
// components/problemCopy.ts so the document editor's popovers say exactly
// what these say. The wording above is the reasoning behind them and stays
// here with the card that shows it.

function ProblemCard({
  claim,
  activeKind,
  remaining,
  onSuggestFix,
  onStartCitationFlow,
  onDismiss
}: {
  claim: ScreenWatchClaimSummary
  /** The first problem not yet dismissed — the only one this card shows. */
  activeKind: ScreenWatchProblemKind
  /** How many problems remain on this sentence, including the active one. */
  remaining: number
  onSuggestFix: () => void
  onStartCitationFlow: () => void
  onDismiss: () => void
}): JSX.Element {
  // Read, not re-derived. This card and the underline disagreeing about what
  // is wrong with the same sentence was the whole defect.
  const kind = activeKind

  if (kind === 'searching') {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="tracely-spinner" />
          <div style={POPOVER_TITLE}>Checking this claim</div>
        </div>
        <div style={POPOVER_BODY}>Searching open-access journals and databases for a source that supports it.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="tracely-btn-secondary" onClick={onDismiss} style={SECONDARY_BTN_STYLE}>
            Dismiss
          </button>
        </div>
      </>
    )
  }

  // The dot is the underline's own colour, which is the design's: amber for a
  // citation problem, orange for an unverified figure, red for reasoning.
  const dotColor = PROBLEM_COLOR[kind]
  // `kind` is only 'searching' when evidence is null, and that case returned
  // above — so evidence is non-null here.
  const { title, description, action: primaryLabel } = popoverCopyFor(
    claim,
    claim.evidence as ScreenWatchClaimEvidence,
    kind
  )
  const onPrimary = isReasoningProblem(kind) ? onSuggestFix : onStartCitationFlow

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <div style={POPOVER_TITLE}>{title}</div>
        {/* How many problems this sentence has in total, when it has more than
            one. Only the first is shown; fixing or dismissing it advances to
            the next, so the count is the writer's warning that the card is not
            finished with them yet. The one element here the design does not
            draw — it postdates the frames. */}
        {remaining > 1 ? (
          <span
            title={`${remaining} issues with this sentence — this is the first`}
            style={{
              marginLeft: 'auto',
              flexShrink: 0,
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 999,
              background: CHIP_BG,
              color: MUTED,
              fontSize: 11,
              fontWeight: 600,
              lineHeight: '18px',
              textAlign: 'center'
            }}
          >
            {remaining}
          </span>
        ) : null}
      </div>
      <MarkdownText style={POPOVER_BODY}>{description}</MarkdownText>
      {/* The design's action row is exactly two buttons — fix it, or dismiss
          it — and at 320 wide that is all that fits on one line. */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="tracely-btn-primary" onClick={onPrimary} style={PRIMARY_BTN_STYLE}>
          {primaryLabel}
        </button>
        <button className="tracely-btn-secondary" onClick={onDismiss} style={SECONDARY_BTN_STYLE}>
          Dismiss
        </button>
      </div>
    </>
  )
}

// Skeleton bar widths, taken from the design rather than expressed as
// percentages — the uneven pair is what makes a loading row read as two lines
// of a real citation rather than as a progress widget.
const SKELETON_ROWS: Array<[number, number]> = [
  [214, 122],
  [186, 96]
]

/** The design labels the style with its edition, not just its name. */
const STYLE_LABEL: Record<CitationStyle, string> = {
  APA: 'APA 7',
  MLA: 'MLA 9',
  Chicago: 'Chicago 17'
}

/**
 * Enough of the claim to recognise it, cut on a word boundary.
 *
 * Trailing sentence punctuation always comes off, because every use here nests
 * the result inside quotes in a sentence of our own — leaving it produces
 * `supports "the claim.".`, which is what the first version rendered.
 */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '')
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:]$/, '')}…`
}

// -- Hover popup: CitationFlowCard -------------------------------------
//
// searching -> picking -> inserted, entered from ProblemCard's "Add
// citation"/"Find a source" action. Tracked entirely client-side
// (citationFlowByClaimId in OverlayApp) — the server call itself is a
// single request/response per step, no persistent flow state on the main
// process side beyond the final insert.
//
// Drawn from three Figma frames, one per step: "Find a Source (Searching)"
// (294:343), "Find a Source (Results)" (295:349) and "Add Citation (Inserted)"
// (298:130). The style pills come from "Add Citation (Choose Source)"
// (296:355); the rest of that frame — a library list of sources already in the
// document, behind a text search field — is NOT built, and the reason is
// structural rather than an omission: Screen Watch persists nothing, so there
// is no per-document library to list, and `overlayWindow.ts` sets
// `focusable: false` so this window can never host a real text input.

type CitationFlowState =
  | { step: 'searching' }
  | {
      step: 'picking'
      candidates: ScreenWatchSourceCandidate[]
      selectedRef: string | null
      style: CitationStyle
    }
  | { step: 'inserted'; citation: ScreenWatchClaimCitation; showWorksCited: boolean }
  | { step: 'error'; message: string }

const CITATION_STYLES: CitationStyle[] = ['MLA', 'APA', 'Chicago']

/** 18px, filled ink with a 3px white centre — the design's selected radio. */
function Radio({ selected }: { selected: boolean }): JSX.Element {
  if (!selected) {
    return (
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          border: '1.5px solid #d1d1d1',
          background: '#fff',
          flexShrink: 0
        }}
      />
    )
  }
  return (
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: 999,
        background: INK,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />
    </div>
  )
}

function CandidateRow({
  candidate,
  selected,
  onSelect
}: {
  candidate: ScreenWatchSourceCandidate
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const meta = [candidate.venue, candidate.year ? String(candidate.year) : null].filter(Boolean).join(' · ')
  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 8,
        borderRadius: 10,
        // The unselected row keeps a transparent border of the same width, so
        // selecting one does not shift the row's contents by a pixel.
        border: `1px solid ${selected ? '#e5e5e5' : 'transparent'}`,
        background: selected ? SELECTED_BG : 'transparent',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'inherit'
      }}
    >
      <SourceIcon provider={candidate.provider} faviconDataUrl={candidate.faviconDataUrl} />
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: INK }}>{candidate.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
          {meta ? <span style={{ color: DIM }}>{meta}</span> : null}
          <span style={{ color: POSITIVE, fontWeight: 500 }}>{candidate.matchPercent}% match</span>
        </div>
      </div>
      <Radio selected={selected} />
    </button>
  )
}

function CitationFlowCard({
  state,
  claimText,
  visibleClaimCount,
  onSelectCandidate,
  onSetStyle,
  onSearchAgain,
  onInsert,
  onCancel,
  onDone,
  onToggleWorksCited,
  onUndo,
  inserting,
  undoing
}: {
  state: CitationFlowState
  /** The sentence being cited — the design quotes it back to the reader. */
  claimText: string
  visibleClaimCount: number
  onSelectCandidate: (ref: string) => void
  onSetStyle: (style: CitationStyle) => void
  onSearchAgain: () => void
  onInsert: () => void
  onCancel: () => void
  onDone: () => void
  onToggleWorksCited: () => void
  onUndo: () => void
  inserting: boolean
  undoing: boolean
}): JSX.Element {
  // "Find a Source (Searching)" — 294:343.
  if (state.step === 'searching') {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DESIGN_ORANGE, flexShrink: 0 }} />
          <div style={POPOVER_TITLE}>Searching for a source</div>
        </div>
        <div style={POPOVER_BODY}>
          Scanning open-access journals and databases for a source that supports &ldquo;
          {truncate(claimText, 70)}.&rdquo;
        </div>
        <div className="tracely-progress-track">
          <div className="tracely-progress-fill" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {SKELETON_ROWS.map(([wide, narrow], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="tracely-skeleton" style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="tracely-skeleton" style={{ width: wide, height: 9, borderRadius: 999 }} />
                <div className="tracely-skeleton-faint" style={{ width: narrow, height: 8, borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="tracely-btn-secondary" onClick={onCancel} style={SECONDARY_BTN_STYLE}>
            Cancel
          </button>
          <span style={{ fontSize: 12, color: DIM }}>Usually 3–5 seconds</span>
        </div>
      </>
    )
  }

  if (state.step === 'error') {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DESIGN_RED, flexShrink: 0 }} />
          <div style={POPOVER_TITLE}>Search failed</div>
        </div>
        <div style={POPOVER_BODY}>{state.message}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="tracely-btn-primary" onClick={onSearchAgain} style={PRIMARY_BTN_STYLE}>
            Search again
          </button>
          <button className="tracely-btn-secondary" onClick={onCancel} style={SECONDARY_BTN_STYLE}>
            Cancel
          </button>
        </div>
      </>
    )
  }

  // "Add Citation (Inserted)" — 298:130.
  if (state.step === 'inserted') {
    const remaining = Math.max(0, visibleClaimCount)
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: POSITIVE, flexShrink: 0 }} />
          <div style={POPOVER_TITLE}>Citation added</div>
        </div>
        <div style={POPOVER_BODY}>
          This claim is now backed by a source in your document. {state.citation.inTextCitation} inserted.
        </div>
        {state.showWorksCited ? (
          <div
            style={{
              width: '100%',
              background: SELECTED_BG,
              borderRadius: 10,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div style={{ fontSize: 10.5, fontWeight: 600, color: DIM, letterSpacing: 0.6 }}>
              ADDED TO WORKS CITED
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: MUTED }}>{state.citation.worksCitedEntry}</div>
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, whiteSpace: 'nowrap' }}>
          <span style={{ color: POSITIVE, fontWeight: 500 }}>Claim resolved</span>
          <span style={{ color: DIM }}>
            · {remaining} flag{remaining === 1 ? '' : 's'} left in this document
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="tracely-btn-primary" onClick={onDone} style={PRIMARY_BTN_STYLE}>
            Done
          </button>
          <button className="tracely-btn-secondary" onClick={onToggleWorksCited} style={SECONDARY_BTN_STYLE}>
            {state.showWorksCited ? 'Hide Works Cited' : 'View Works Cited'}
          </button>
          <button
            className="tracely-btn-secondary"
            onClick={onUndo}
            disabled={undoing}
            style={{ ...SECONDARY_BTN_STYLE, opacity: undoing ? 0.6 : 1, cursor: undoing ? 'default' : 'pointer' }}
          >
            {undoing ? 'Undoing…' : 'Undo'}
          </button>
        </div>
      </>
    )
  }

  // "Find a Source (Results)" — 295:349, with the style pills from
  // "Add Citation (Choose Source)" (296:355).
  const { candidates, selectedRef, style } = state
  if (candidates.length === 0) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DESIGN_AMBER, flexShrink: 0 }} />
          <div style={POPOVER_TITLE}>No sources found</div>
        </div>
        <div style={POPOVER_BODY}>
          Nothing in the open-access databases came back for &ldquo;{truncate(claimText, 70)}.&rdquo; That does not
          make the claim wrong — it means there is nothing here to cite for it yet.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="tracely-btn-primary" onClick={onSearchAgain} style={PRIMARY_BTN_STYLE}>
            Search again
          </button>
          <button className="tracely-btn-secondary" onClick={onCancel} style={SECONDARY_BTN_STYLE}>
            Dismiss
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: POSITIVE, flexShrink: 0 }} />
          <div style={POPOVER_TITLE}>
            {candidates.length} source{candidates.length === 1 ? '' : 's'} found
          </div>
        </div>
        <div
          style={{
            flexShrink: 0,
            background: CHIP_BG,
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: 11.5,
            fontWeight: 500,
            color: MUTED
          }}
        >
          {STYLE_LABEL[style]}
        </div>
      </div>
      <div style={POPOVER_BODY}>
        Ranked by how directly each source supports &ldquo;{truncate(claimText, 70)}.&rdquo;
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.sourceRef}
            candidate={candidate}
            selected={candidate.sourceRef === selectedRef}
            onSelect={() => onSelectCandidate(candidate.sourceRef)}
          />
        ))}
      </div>
      {/* The style row from the Choose Source frame. Three pills rather than
          the one cycling button this used to be: the design shows every option
          at once, and a button that had to be clicked twice to discover
          Chicago was hiding two thirds of the control. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: MUTED }}>Style</span>
        {CITATION_STYLES.map((option) => {
          const active = option === style
          return (
            <button
              key={option}
              onClick={() => onSetStyle(option)}
              style={{
                borderRadius: 999,
                padding: '5px 11px',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? '#fff' : MUTED,
                background: active ? INK : '#fff',
                border: active ? 'none' : '1px solid #e0e0e0',
                cursor: 'pointer'
              }}
            >
              {STYLE_LABEL[option]}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="tracely-btn-primary"
          onClick={onInsert}
          disabled={inserting || !selectedRef}
          style={{
            ...PRIMARY_BTN_STYLE,
            opacity: inserting || !selectedRef ? 0.6 : 1,
            cursor: inserting || !selectedRef ? 'default' : 'pointer'
          }}
        >
          {inserting ? 'Inserting…' : 'Insert citation'}
        </button>
        <button className="tracely-btn-secondary" onClick={onCancel} style={SECONDARY_BTN_STYLE}>
          Cancel
        </button>
      </div>
      <button
        className="tracely-btn-secondary"
        onClick={onSearchAgain}
        style={{ ...SECONDARY_BTN_STYLE, width: '100%' }}
      >
        Search again
      </button>
    </>
  )
}

export default function OverlayApp(): JSX.Element {
  const [underlines, setUnderlines] = useState<ScreenWatchOverlayUpdateEvent['underlines']>([])
  const [widget, setWidget] = useState<ScreenWatchWidget | null>(null)
  const [hover, setHover] = useState<ScreenWatchHoverEvent | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  /**
   * Problems the user has waved away, keyed `claimId:kind`.
   *
   * Dismissal used to remove the whole claim, which meant a sentence with two
   * problems lost the second one the moment the first was waved away — and a
   * sentence whose citation gap was fixed kept its reasoning warning hidden
   * for the rest of the session. Per-problem, the card simply advances.
   */
  const [dismissedIssues, setDismissedIssues] = useState<Set<string>>(new Set())
  // Driven locally at full mouse speed during a drag rather than round-
  // tripping every mousemove through main — main only needs to know the
  // final position (see onGripMouseDown). Cleared once the drag ends so the
  // next server-confirmed rect (which will already match) takes back over.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  // True only between passing the drag threshold and mouseup. A ref, not
  // state: the overlay-update listener is registered once and would close over
  // a stale value.
  const dragActive = useRef(false)
  // Which claim the widget's single-claim view is focused on — null means
  // "the top one by confidence." Purely client-side: unlike widgetViewMode,
  // WHICH claim is shown doesn't change the panel's size, so there's no
  // reason for main to need to know it.
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)
  /**
   * Paragraph whose claim underlines are temporarily lit, from clicking a ¶
   * chip on a structural weakness. Cleared on a timer and on any view change:
   * the overlay is click-through everywhere except its own panel, so there is
   * no click-outside to dismiss it with, and a highlight nobody can turn off
   * would sit over the user's document indefinitely.
   */
  const [highlightedParagraph, setHighlightedParagraph] = useState<number | null>(null)
  const [busyEvidenceIds, setBusyEvidenceIds] = useState<Set<string>>(new Set())
  const [busyCritiqueIds, setBusyCritiqueIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)

  // Which of the card's two result blocks to show, per claim: whichever action
  // the user took last, exactly as the design's two result frames read. A claim
  // that already carries a critique opens on it, since that is the thing the
  // sources list cannot tell them.
  const [panelBodyByClaim, setPanelBodyByClaim] = useState<Map<string, 'sources' | 'critique'>>(new Map())
  // Set for FRESH_EVIDENCE_MS after an explicit refresh — the green chip says
  // "just now", so it has to stop being true at some point.
  const [freshEvidenceIds, setFreshEvidenceIds] = useState<Set<string>>(new Set())
  // The article keys a claim had BEFORE its last refresh. Rows outside this
  // set are the ones the new search actually turned up, which is what "New"
  // means; without a baseline no row is marked, rather than all of them.
  const [refreshBaselineByClaim, setRefreshBaselineByClaim] = useState<Map<string, Set<string>>>(new Map())

  function panelBodyFor(claim: ScreenWatchClaimSummary): 'sources' | 'critique' {
    return panelBodyByClaim.get(claim.id) ?? (claim.critique ? 'critique' : 'sources')
  }

  function setPanelBody(claimId: string, body: 'sources' | 'critique'): void {
    setPanelBodyByClaim((prev) => new Map(prev).set(claimId, body))
  }
  // The hover popup's citation flow (Find a source / Add citation), keyed
  // by claim id — absent means "just showing ProblemCard," not started.
  const [citationFlowByClaimId, setCitationFlowByClaimId] = useState<Map<string, CitationFlowState>>(new Map())
  const [citationBusyIds, setCitationBusyIds] = useState<Set<string>>(new Set())
  const [undoBusyIds, setUndoBusyIds] = useState<Set<string>>(new Set())
  const [defaultStyle, setDefaultStyle] = useState<CitationStyle>('APA')

  useEffect(() => {
    window.tracely.settings
      .get()
      .then((s) => setDefaultStyle(s.defaultCitationStyle))
      .catch(() => {})
  }, [])

  useEffect(() => {
    return window.tracely.onScreenWatchOverlayUpdate((event) => {
      setUnderlines(event.underlines)
      setWidget(event.widget)
      // The payload's rect is authoritative, so the drop position held over
      // from a finished drag can go. Skipped while a drag is still in flight:
      // a poll landing mid-drag would otherwise yank the widget back to the
      // pre-drag rect for one frame.
      if (!dragActive.current) setDragPos(null)
    })
  }, [])

  useEffect(() => {
    return window.tracely.onScreenWatchHover((event) => {
      setHover(event)
    })
  }, [])

  function toggleWidgetExpanded(): void {
    if (!widget) return
    void window.tracely.screenWatch.setWidgetExpanded({ expanded: !widget.expanded })
  }

  function showAll(): void {
    void window.tracely.screenWatch.setWidgetExpanded({ expanded: true })
    void window.tracely.screenWatch.setWidgetViewMode({ mode: 'all' })
    // Local feedback ahead of the next hover-tracking event, which won't
    // arrive until the cursor actually moves — without this the hover
    // popover and the widget's new "all" panel could both be on screen at
    // once for a moment.
    setHover(null)
  }

  function showSingle(): void {
    void window.tracely.screenWatch.setWidgetViewMode({ mode: 'single' })
  }

  /**
   * Back from a secondary view. Mirrors openWidgetPanel's rule rather than
   * always landing on 'single', so a document with several unresolved claims
   * returns to the list it came from instead of dead-ending on one card.
   */
  function leavePanelView(): void {
    const unresolved = (widget?.claims ?? []).filter((c) => !isResolved(c.id))
    void window.tracely.screenWatch.setWidgetViewMode({
      mode: unresolved.length > 1 ? 'all' : 'single'
    })
  }

  function showStructure(): void {
    void window.tracely.screenWatch.setWidgetExpanded({ expanded: true })
    void window.tracely.screenWatch.setWidgetViewMode({ mode: 'structure' })
    setHover(null)
  }

  /**
   * Light up the claim underlines belonging to one paragraph, so a weakness in
   * the panel points at something on the actual screen.
   *
   * This is the only on-screen connection available from the expanded panel:
   * while expanded, hoverTracking.ts hit-tests the widget rect alone, so claim
   * hover is off and there is nothing to conflict with. It reuses
   * UnderlineMark's existing `hovered` prop rather than adding a highlight
   * state of its own.
   *
   * setSelectedClaimId directly, NOT selectClaim — that helper also calls
   * showSingle(), which would throw the user out of the view they clicked from.
   * Setting it here just means Back lands on the right claim.
   */
  function highlightParagraph(index: number, claimId: string | null): void {
    setHighlightedParagraph(index)
    if (claimId) setSelectedClaimId(claimId)
  }

  /**
   * Wave away ONE problem. The claim only disappears once nothing is left.
   *
   * `remaining` is passed rather than recomputed so this cannot disagree with
   * what the card was showing when the button was pressed.
   */
  function dismissIssue(claimId: string, kind: ScreenWatchProblemKind, remaining: number): void {
    setDismissedIssues((prev) => new Set(prev).add(`${claimId}:${kind}`))
    if (remaining <= 1) setDismissedIds((prev) => new Set(prev).add(claimId))
  }

  function selectClaim(claimId: string): void {
    setSelectedClaimId(claimId)
    showSingle()
  }

  async function findEvidenceFor(claimId: string): Promise<void> {
    setActionError(null)
    setBusyEvidenceIds((prev) => new Set(prev).add(claimId))
    setPanelBody(claimId, 'sources')
    // Snapshot BEFORE the call, not after it resolves. The new articles arrive
    // on the next SCREENWATCH_OVERLAY_UPDATE push rather than in the response,
    // so a baseline taken afterwards would race the push and mark either
    // everything or nothing as new.
    const before = new Set(
      (widget?.claims.find((c) => c.id === claimId)?.evidence?.articles ?? []).map(articleKey)
    )
    try {
      await window.tracely.screenWatch.refreshEvidence({ claimId })
      setRefreshBaselineByClaim((prev) => new Map(prev).set(claimId, before))
      setFreshEvidenceIds((prev) => new Set(prev).add(claimId))
      window.setTimeout(() => {
        setFreshEvidenceIds((prev) => {
          if (!prev.has(claimId)) return prev
          const next = new Set(prev)
          next.delete(claimId)
          return next
        })
      }, FRESH_EVIDENCE_MS)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyEvidenceIds((prev) => {
        const next = new Set(prev)
        next.delete(claimId)
        return next
      })
    }
  }

  async function critiqueFor(claimId: string): Promise<void> {
    setActionError(null)
    setBusyCritiqueIds((prev) => new Set(prev).add(claimId))
    setPanelBody(claimId, 'critique')
    try {
      await window.tracely.screenWatch.critiqueClaim({ claimId })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyCritiqueIds((prev) => {
        const next = new Set(prev)
        next.delete(claimId)
        return next
      })
    }
  }

  function setFlow(claimId: string, state: CitationFlowState | null): void {
    setCitationFlowByClaimId((prev) => {
      const next = new Map(prev)
      if (state === null) next.delete(claimId)
      else next.set(claimId, state)
      return next
    })
  }

  // Both "Find a source" (no evidence yet) and "Add citation" (evidence
  // already on hand) run the same focused search server-side — the overlay
  // window can never take OS keyboard focus (overlayWindow.ts sets
  // focusable: false, deliberately, so it never steals focus from the app
  // being watched), so there's no way to host a real free-text search box
  // here; "search again" always re-runs with the claim's own query rather
  // than a typed override.
  async function startCitationFlow(claimId: string): Promise<void> {
    setFlow(claimId, { step: 'searching' })
    try {
      const { candidates } = await window.tracely.screenWatch.findSource({ claimId })
      // The user may have cancelled (flow entry removed) while this was in
      // flight — a stale result landing after that shouldn't reopen it.
      setCitationFlowByClaimId((prev) => {
        if (!prev.has(claimId)) return prev
        const next = new Map(prev)
        next.set(claimId, {
          step: 'picking',
          candidates,
          selectedRef: candidates[0]?.sourceRef ?? null,
          style: defaultStyle
        })
        return next
      })
    } catch (err) {
      setCitationFlowByClaimId((prev) => {
        if (!prev.has(claimId)) return prev
        const next = new Map(prev)
        next.set(claimId, { step: 'error', message: err instanceof Error ? err.message : String(err) })
        return next
      })
    }
  }

  function selectCandidate(claimId: string, ref: string): void {
    const flow = citationFlowByClaimId.get(claimId)
    if (flow?.step === 'picking') setFlow(claimId, { ...flow, selectedRef: ref })
  }

  function setCandidateStyle(claimId: string, style: CitationStyle): void {
    const flow = citationFlowByClaimId.get(claimId)
    if (flow?.step === 'picking') setFlow(claimId, { ...flow, style })
  }

  async function insertCitation(claimId: string): Promise<void> {
    const flow = citationFlowByClaimId.get(claimId)
    if (flow?.step !== 'picking' || !flow.selectedRef) return
    setCitationBusyIds((prev) => new Set(prev).add(claimId))
    try {
      const { citation } = await window.tracely.screenWatch.insertCitation({
        claimId,
        sourceRef: flow.selectedRef,
        style: flow.style
      })
      setFlow(claimId, { step: 'inserted', citation, showWorksCited: false })
    } catch (err) {
      setFlow(claimId, { step: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setCitationBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(claimId)
        return next
      })
    }
  }

  function toggleWorksCited(claimId: string): void {
    const flow = citationFlowByClaimId.get(claimId)
    if (flow?.step === 'inserted') setFlow(claimId, { ...flow, showWorksCited: !flow.showWorksCited })
  }

  async function undoCitation(claimId: string): Promise<void> {
    setUndoBusyIds((prev) => new Set(prev).add(claimId))
    try {
      await window.tracely.screenWatch.undoCitation({ claimId })
      // The claim reappears in the flagged set once the next overlay-update
      // payload lands (citation cleared server-side) — closing the flow
      // here rather than trying to restore the prior candidate list, which
      // may be stale by now.
      setFlow(claimId, null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setUndoBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(claimId)
        return next
      })
    }
  }

  // Shared drag handler for both the collapsed circle and the expanded
  // panel's grip. The circle also needs to stay clickable (to open the
  // panel) without a drag — distinguished by a small movement threshold:
  // real dragging isn't reported to main (and doesn't move anything) until
  // the cursor has actually moved past it, and a mouseup before that
  // threshold is treated as a plain click instead.
  const DRAG_THRESHOLD = 4
  function startWidgetDrag(e: ReactMouseEvent, size: { width: number; height: number }, onClick?: () => void): void {
    if (!widget) return
    e.preventDefault()
    const startMouse = { x: e.clientX, y: e.clientY }
    const startRect = { x: widget.rect.x, y: widget.rect.y }
    let dragging = false

    function clamp(pos: { x: number; y: number }): { x: number; y: number } {
      return {
        x: Math.min(Math.max(0, pos.x), window.innerWidth - size.width),
        y: Math.min(Math.max(0, pos.y), window.innerHeight - size.height)
      }
    }
    function delta(ev: MouseEvent): { x: number; y: number } {
      return { x: startRect.x + (ev.clientX - startMouse.x), y: startRect.y + (ev.clientY - startMouse.y) }
    }
    function onMove(ev: MouseEvent): void {
      if (!dragging) {
        const dx = ev.clientX - startMouse.x
        const dy = ev.clientY - startMouse.y
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        dragging = true
        dragActive.current = true
        void window.tracely.screenWatch.widgetDragStart()
      }
      setDragPos(clamp(delta(ev)))
    }
    function onUp(ev: MouseEvent): void {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (dragging) {
        // Hold the drop position rather than clearing it. `setDragPos(null)`
        // was synchronous while the IPC that moves `widget.rect` was not, so
        // the very next render fell back to the PRE-drag rect and the widget
        // visibly snapped back to where the drag started before jumping to
        // where it was dropped, one payload later.
        //
        // The overlay-update handler clears it once main's rect has caught up.
        const dropped = clamp(delta(ev))
        setDragPos(dropped)
        dragActive.current = false
        void window.tracely.screenWatch.widgetDragEnd(dropped)
      } else {
        onClick?.()
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Claims a citation has already been inserted for are treated as
  // resolved — dropped from underlines/hover the same way dismissedIds
  // drops a manually-dismissed one, so "fixed" claims stop flagging.
  const citedIds = new Set((widget?.claims ?? []).filter((c) => c.citation).map((c) => c.id))
  // Everything the service still considers a live claim. Used by
  // useStableUnderlines to tell "this measurement glitched" (hold the last
  // rects) apart from "this claim is gone" (drop it now).
  const trackedIds = new Set((widget?.claims ?? []).map((c) => c.id))
  // Claims in the paragraph currently lit from the Structure view. Empty in
  // every other state, so it costs nothing when the feature is unused.
  const highlightedClaimIds = new Set(
    (highlightedParagraph === null
      ? []
      : widget?.structure?.paragraphs.find((p) => p.index === highlightedParagraph)?.claimIds) ?? []
  )
  const stableUnderlines = useStableUnderlines(underlines, trackedIds)
  const isResolved = (id: string): boolean => dismissedIds.has(id) || citedIds.has(id)

  /** The problems still live on a claim, worst first. */
  const openKinds = (claimId: string, kinds: ScreenWatchProblemKind[]): ScreenWatchProblemKind[] =>
    kinds.filter((k) => !dismissedIssues.has(`${claimId}:${k}`))

  /**
   * What to show for a claim. Falls back to the worst dismissed kind rather
   * than to a default, so a mark whose problems are all dismissed keeps its own
   * colour for the moment before it disappears instead of flashing grey.
   */
  const visibleKindFor = (
    claimId: string,
    kinds: ScreenWatchProblemKind[]
  ): ScreenWatchProblemKind => openKinds(claimId, kinds)[0] ?? kinds[0] ?? 'searching'

  /**
   * Opens the widget's claims panel, in whichever mode is useful for what is
   * actually flagged. A single claim goes straight to its actions rather than
   * to a one-item list you then have to click into.
   */
  function openWidgetPanel(): void {
    const unresolved = (widget?.claims ?? []).filter((c) => !isResolved(c.id)).length
    void window.tracely.screenWatch.setWidgetExpanded({ expanded: true })
    void window.tracely.screenWatch.setWidgetViewMode({ mode: unresolved > 1 ? 'all' : 'single' })
    // Local feedback ahead of the next hover-tracking event, which won't
    // arrive until the cursor moves — otherwise the hover popover and the
    // panel can both be on screen for a moment.
    setHover(null)
  }

  const widgetHovered = hover?.kind === 'widget'
  const claimHovered = hover?.kind === 'claim' && !isResolved(hover.claimId) ? hover : null
  // The hover event itself only carries the bare minimum needed to draw the
  // underline (id/type/text/anchor) — full detail (confidence, evidence
  // once it's resolved) lives in widget.claims, looked up by id. A fallback
  // covers the brief window where a claim was just detected and its hover
  // target exists before the next overlay-update payload has arrived.
  const claimHoveredSummary: ScreenWatchClaimSummary | null = claimHovered
    ? (widget?.claims.find((c) => c.id === claimHovered.claimId) ?? {
        id: claimHovered.claimId,
        text: claimHovered.text,
        claimType: claimHovered.claimType,
        confidence: 0,
        // Deliberately false, and unread: `problemKinds` is ['searching'] in
        // this placeholder, and no copy branch consults this field in that
        // state. It used to call a two-pattern COPY of main's citation
        // detector, which is the same duplicated-judgement mistake that had
        // the underline and the card disagreeing — and the copy had already
        // drifted, missing four of main's six patterns.
        hasInlineCitation: false,
        // Nothing is known about a claim whose payload has not arrived yet, and
        // 'searching' is the honest name for that.
        problemKinds: ['searching' as const],
        evidence: null,
        critique: null,
        critiqueVerdict: null,
        suggestedRevision: null,
        citationFix: null,
        citation: null
      })
    : null
  // Start the evidence search when the cursor settles on a claim, rather
  // than waiting for a click on "Find Evidence".
  //
  // Only the top MAX_AUTO_EVIDENCE_CLAIMS claims are pre-fetched after
  // detection (a full set costs four provider searches each, which is what
  // makes Semantic Scholar answer 429). Everything below that used to sit
  // at "no evidence yet" until the user clicked, and only then began a cold
  // four-provider search — so the wait for articles started when the user
  // asked for them instead of when they showed interest.
  //
  // The dwell delay is what keeps this honest about API cost: sweeping the
  // cursor across a paragraph must not fire a search per claim it crosses.
  // Attempts are recorded whether or not they succeed, so a failing claim
  // re-searches only via the explicit button.
  const autoSearchedIds = useRef<Set<string>>(new Set())
  const hoveredClaimId = claimHovered?.claimId ?? null
  const needsEvidence = claimHoveredSummary?.evidence == null
  useEffect(() => {
    if (!hoveredClaimId || !needsEvidence) return
    if (autoSearchedIds.current.has(hoveredClaimId)) return
    const id = window.setTimeout(() => {
      autoSearchedIds.current.add(hoveredClaimId)
      void findEvidenceFor(hoveredClaimId)
    }, HOVER_SEARCH_DWELL_MS)
    return () => window.clearTimeout(id)
    // findEvidenceFor is stable enough for this purpose — it only closes
    // over setState functions, which React guarantees are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredClaimId, needsEvidence])

  // Highlights expire. The overlay is click-through everywhere except its own
  // panel, so there is no click-outside to dismiss one with; left alone it
  // would sit over the user's document until the claim set changed.
  const panelViewMode = widget?.viewMode ?? null
  useEffect(() => {
    if (highlightedParagraph === null) return
    const id = window.setTimeout(() => setHighlightedParagraph(null), HIGHLIGHT_HOLD_MS)
    return () => window.clearTimeout(id)
  }, [highlightedParagraph])

  // Leaving the Structure view abandons the thing the highlight referred to.
  useEffect(() => {
    if (panelViewMode !== 'structure') setHighlightedParagraph(null)
  }, [panelViewMode])

  const hoveredOpenKinds = claimHoveredSummary
    ? openKinds(claimHoveredSummary.id, claimHoveredSummary.problemKinds)
    : []
  const hoveredActiveKind: ScreenWatchProblemKind =
    hoveredOpenKinds[0] ?? claimHoveredSummary?.problemKinds[0] ?? 'searching'
  const hoveredRemaining = hoveredOpenKinds.length

  const hoveredFlowStep = claimHovered
    ? (citationFlowByClaimId.get(claimHovered.claimId)?.step ?? null)
    : null
  // 320 for a glance, 380 once the card is showing a list. Measured off the
  // frames rather than "the flow is wider": "Find a Source (Searching)" is 320
  // like the inline-detection cards, because it shows two skeleton rows and a
  // sentence; only "(Results)", "Add Citation (Choose Source)" and "(Inserted)"
  // widen to 380, where real titles and a works-cited entry have to fit.
  const hoveredPopoverWidth =
    hoveredFlowStep === null || hoveredFlowStep === 'searching' ? POPOVER_WIDTH_GLANCE : POPOVER_WIDTH_FLOW
  const claimHoveredPos = claimHovered
    ? popoverPosition(claimHovered.anchor, hoveredPopoverWidth)
    : null
  const popoverRef = useRef<HTMLDivElement>(null)
  const lastReportedPopoverKey = useRef<string | null>(null)

  // Reports the popover's REAL rendered rect (measured from the DOM, not
  // POPOVER_EST_HEIGHT's guess — that constant only exists to decide
  // above-vs-below placement before anything has rendered) to main so
  // hoverTracking.ts can hit-test against it directly. Runs after every
  // render (widget updates, and every citation-flow step change, re-render
  // this whole component too, since flow state can resize the popover),
  // but only actually sends when the reported rect would change.
  useLayoutEffect(() => {
    if (claimHovered && claimHoveredPos && popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect()
      const key = `${claimHovered.claimId}:${rect.left}:${rect.top}:${rect.width}:${rect.height}`
      if (lastReportedPopoverKey.current === key) return
      lastReportedPopoverKey.current = key
      void window.tracely.screenWatch.setActivePopoverRect({
        claimId: claimHovered.claimId,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
      })
    } else if (!claimHovered && lastReportedPopoverKey.current !== null) {
      lastReportedPopoverKey.current = null
      void window.tracely.screenWatch.setActivePopoverRect({ claimId: null, rect: null })
    }
  })

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        fontFamily: FONT_STACK,
        // Native hit-testing is toggled by hoverTracking.ts. Keep the DOM's
        // transparent remainder inert as a second boundary; visible controls
        // below opt themselves back in.
        pointerEvents: 'none'
      }}
    >
      {stableUnderlines
        .filter((u) => !isResolved(u.id))
        .flatMap((u) => {
          // Either the cursor is over it, or the Structure view lit its
          // paragraph. Same visual treatment on purpose — from the reader's
          // side both mean "this is the one being talked about".
          const isHovered = claimHovered?.claimId === u.id || highlightedClaimIds.has(u.id)
          // The point of the whole change: the mark is coloured by what is
          // WRONG, not by what kind of sentence it is. Every factual claim in a
          // document used to be the same orange whatever state it was in.
          // Worst first, so the mark shows the most serious of the sentence's
          // problems — the same one the card opens on.
          const color = PROBLEM_COLOR[visibleKindFor(u.id, u.problemKinds)]
          return u.rects.map((r, i) => (
            <UnderlineMark
              key={`${u.id}-${i}`}
              // Rounded to whole pixels (the underlying rect arrives
              // scale-converted from physical UIA coordinates, so it's
              // rarely already an integer) — a fractional position blurs a
              // 2px line across two rows of pixels instead of one crisp one.
              x={Math.round(r.x)}
              y={Math.round(r.y)}
              width={Math.round(r.width)}
              height={Math.round(r.height)}
              claimId={u.id}
              color={color}
              title={PROBLEM_LABEL[visibleKindFor(u.id, u.problemKinds)]}
              hovered={isHovered}
            />
          ))
        })}

      {widget && !widget.expanded
        ? (() => {
            const circlePos = dragPos ?? widget.rect
            const hasInfo = widget.totalInfoCount > 0
            // A solid black circle with the plain Tracely mark, plus a
            // small solid-orange count badge overlapping its top-right
            // edge once there's something to show — matches the Figma
            // "Collapsed Launcher" mockup (not a colored ring around the
            // whole circle).
            return (
              <button
                // Opens the claims panel. Pointing this at `tracer.open`
                // instead (39d238b) left the panel with no entry point at all:
                // the only other way in required `claim.critiqueVerdict`, which
                // only `critiqueClaim` sets, which is only reachable from the
                // "Check Claim" button *inside* the panel. Circular — so the
                // panel, ClaimActionCard, ClaimListItem, "Show all", the
                // per-claim Find Evidence and Check Claim actions and the
                // panel's own close button were all unreachable code.
                //
                // Tracer is still one click away, from inside the panel, where
                // "Ask Tracer" already appears in three places.
                onMouseDown={(e) => startWidgetDrag(e, { width: 56, height: 56 }, () => openWidgetPanel())}
                title="Flagged claims — click to open, drag to move"
                style={{
                  position: 'absolute',
                  left: circlePos.x,
                  top: circlePos.y,
                  width: 56,
                  height: 56,
                  border: 'none',
                  borderRadius: '50%',
                  padding: 0,
                  cursor: 'pointer',
                  background: INK,
                  boxShadow: widgetHovered ? '0 6px 18px rgba(0, 0, 0, 0.25)' : '0 2px 10px rgba(0, 0, 0, 0.18)',
                  transition: 'box-shadow 0.12s ease, transform 0.12s ease',
                  transform: widgetHovered ? 'scale(1.06)' : 'scale(1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'auto'
                }}
              >
                {/*
                  46, not 30. The asset is 899×635 with ~45% of its width as
                  transparent padding, and `objectFit: contain` in a square box
                  is width-constrained — so `size={30}` drew a mark about
                  13.5px wide inside a 56px circle, roughly 24% of the
                  diameter against a 38-45% norm for a launcher glyph. 46
                  puts it near 21px (~37%) without touching the circle, so
                  WIDGET_SIZE in screenWatchService.ts and hoverTracking.ts's
                  hit-test region stay valid.
                */}
                <LogoBg size={46} />
                {hasInfo ? (
                  // 31px on a 56px launcher, sitting 8.5px above its top edge
                  // and 3.5px past its right — the design's Badge/Badge Count
                  // (267:121, 267:122) measured off the frame, not eyeballed.
                  // It was a 22px puck at -4/-4 with 11.5px text, which read as
                  // a notification dot rather than the count it is.
                  <span
                    style={{
                      position: 'absolute',
                      top: -8.5,
                      right: -3.5,
                      minWidth: 31,
                      height: 31,
                      padding: '0 8px',
                      borderRadius: 999,
                      background: DESIGN_ORANGE,
                      color: '#fff',
                      fontSize: 16,
                      fontWeight: 600,
                      border: '2px solid #fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {widget.totalInfoCount}
                  </span>
                ) : null}
              </button>
            )
          })()
        : null}

      {widget && widget.expanded
        ? (() => {
            const panelPos = dragPos ?? widget.rect
            const visibleClaims = widget.claims.filter((c) => !isResolved(c.id))
            // Claims still on screen. A weakness whose paragraph holds only
            // dismissed or already-cited claims has nothing left to point at,
            // and its ¶ chip renders as plain text rather than a dead button.
            const liveClaimIds = new Set(visibleClaims.map((c) => c.id))
            const topClaim = visibleClaims.find((c) => c.id === selectedClaimId) ?? visibleClaims[0] ?? null
            return (
              <div
                style={{
                  position: 'absolute',
                  left: panelPos.x,
                  top: panelPos.y,
                  width: widget.rect.width,
                  height: widget.rect.height,
                  background: '#fff',
                  // The panel's own chrome, which is not the popover's: 1px
                  // rather than 2px, radius 24 rather than 16, and a tighter
                  // shadow. It is a window you opened, not a note pinned over
                  // your document, and the design distinguishes the two.
                  border: PANEL_BORDER,
                  borderRadius: PANEL_RADIUS,
                  boxShadow: PANEL_SHADOW,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  // The design is ONE padded box, not a header bar above a
                  // padded body: the title sits in the same gutter as the
                  // content and the rule between them is inset by that gutter
                  // rather than running edge to edge.
                  padding: `${PANEL_PADDING_Y}px ${GRID_PADDING}px`,
                  gap: PANEL_GAP,
                  pointerEvents: 'auto'
                }}
              >
                <div
                  style={{
                    boxSizing: 'border-box',
                    height: PANEL_HEADER_HEIGHT,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexShrink: 0
                  }}
                >
                  {widget.viewMode !== 'single' ? (
                    <button
                      className="tracely-btn-text"
                      onClick={leavePanelView}
                      style={{ ...TEXT_BTN_STYLE, flexShrink: 0 }}
                    >
                      ← Back
                    </button>
                  ) : null}
                  {/* Sibling of the drag region, never a child of it — that div
                      owns onMouseDown for startWidgetDrag and would swallow
                      this click through the drag-threshold path. */}
                  <ScoreChip
                    structure={widget.structure}
                    active={widget.viewMode === 'structure'}
                    onOpen={showStructure}
                  />
                  <div
                    onMouseDown={(e) =>
                      startWidgetDrag(e, { width: widget.rect.width, height: widget.rect.height })
                    }
                    title="Drag to move"
                    style={{
                      alignSelf: 'stretch',
                      minWidth: 0,
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      paddingLeft: widget.viewMode === 'all' ? 2 : 4,
                      cursor: 'grab'
                    }}
                  >
                    {/* The same title in every mode, which is what the design
                        does: the base frame, the two result frames and the
                        "Show All Result" frame all say "4 claims flagged". It
                        used to read "Argument check" in single mode and render
                        nothing at all in the others. Counted from the visible
                        claims rather than widget.claimCount so it agrees with
                        the "Show all (N)" pill directly below it. */}
                    <div
                      style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        // 19px semibold, the design's panel title size. The
                        // header is the only place the panel names itself.
                        fontSize: 19,
                        fontWeight: 600,
                        color: W_INK
                      }}
                    >
                      {visibleClaims.length} claim{visibleClaims.length === 1 ? '' : 's'} flagged
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: ACCENT,
                        background: 'rgba(255, 89, 0, 0.1)',
                        borderRadius: 999,
                        padding: '2px 8px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0
                      }}
                    >
                      {widget.totalInfoCount} found
                    </div>
                  </div>
                  <button
                    onClick={toggleWidgetExpanded}
                    title="Close"
                    aria-label="Close"
                    style={{
                      // 30px on #f2f2f2, per the design — the old 22px puck at
                      // 6% black read as a disabled control rather than a
                      // button.
                      width: 30,
                      height: 30,
                      boxSizing: 'border-box',
                      border: 'none',
                      background: CHIP_BG,
                      borderRadius: '50%',
                      color: W_INK,
                      fontSize: 17,
                      fontWeight: 500,
                      lineHeight: '30px',
                      padding: 0,
                      cursor: 'pointer',
                      flexShrink: 0
                    }}
                  >
                    ×
                  </button>
                </div>

                <div style={{ height: 1, background: W_DIVIDER, flexShrink: 0 }} />

                <div
                  style={{
                    boxSizing: 'border-box',
                    flex: 1,
                    minHeight: 0,
                    overflowX: 'hidden',
                    // 'structure' scrolls for the same reason 'single' does:
                    // its content length is not what the panel was sized from
                    // (paragraph count is unbounded and the height caps out).
                    overflowY: widget.viewMode === 'all' ? 'hidden' : 'auto'
                  }}
                >
                  {/* Checked before the empty state: a draft can have a
                      structural reading and no flagged claims at all (that is
                      what a well-sourced draft looks like), and opening the
                      score chip only to be told "no claims flagged" would be
                      answering a question nobody asked. */}
                  {widget.viewMode === 'structure' ? (
                    // No `&& widget.structure` guard any more. Falling through to
                    // the claims list when there was no reading is how opening the
                    // score chip could land you somewhere unrelated to what you
                    // clicked; the panel now answers the question you asked, even
                    // when the answer is "there isn't a reading yet".
                    widget.structure ? (
                      <ArgumentScoreView
                        structure={widget.structure}
                        liveClaimIds={liveClaimIds}
                        onHighlightParagraph={highlightParagraph}
                      />
                    ) : (
                      <NoReadingView />
                    )
                  ) : visibleClaims.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 24 }}>
                      <div style={{ fontSize: 12.5, color: DIM, textAlign: 'center' }}>No claims flagged yet.</div>
                    </div>
                  ) : widget.viewMode === 'single' && topClaim ? (
                    // The design's card IS the panel body: the same 16px stack
                    // the panel itself uses, so the card contributes rows to it
                    // rather than nesting a second box inside it.
                    <div style={{ display: 'flex', flexDirection: 'column', gap: PANEL_GAP, minHeight: '100%' }}>
                      <WidgetClaimCard
                        claim={topClaim}
                        body={panelBodyFor(topClaim)}
                        evidenceBusy={busyEvidenceIds.has(topClaim.id)}
                        critiqueBusy={busyCritiqueIds.has(topClaim.id)}
                        freshlyRefreshed={freshEvidenceIds.has(topClaim.id)}
                        newArticleKeys={refreshBaselineByClaim.get(topClaim.id) ?? null}
                        showAllCount={visibleClaims.length}
                        onRefreshEvidence={() => void findEvidenceFor(topClaim.id)}
                        onCritique={() => void critiqueFor(topClaim.id)}
                        onShowAll={showAll}
                      />
                      {actionError ? <div style={{ fontSize: 11.5, color: '#d6301a' }}>{actionError}</div> : null}
                    </div>
                  ) : (
                    // A single vertical column, not a grid — sized per-claim-
                    // count server-side (computeAllPanelSize); overflowY is a
                    // safety fallback only for the rare case that caps out.
                    <div style={{ display: 'flex', flexDirection: 'column', gap: GRID_GAP, height: '100%', overflowY: 'auto' }}>
                      {visibleClaims.map((c) => (
                        <ClaimListItem key={c.id} claim={c} onClick={() => selectClaim(c.id)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })()
        : null}

      {claimHovered && claimHoveredSummary
        ? (() => {
            const pos = popoverPosition(claimHovered.anchor, hoveredPopoverWidth)
            const flow = citationFlowByClaimId.get(claimHoveredSummary.id) ?? null
            const visibleCount = (widget?.claims ?? []).filter((c) => !isResolved(c.id) && c.id !== claimHoveredSummary.id).length
            const pointing = pos.top !== undefined ? 'up' : 'down'
            // Over the middle of the hovered rect, then clamped inside the
            // card's rounded corners. In the design the tail sits under the
            // flagged words, not centred on the card — two of the three inline
            // frames have it centred only because the sentence happens to be.
            const anchorCentre = claimHovered.anchor.x + claimHovered.anchor.width / 2
            const tailLeft = Math.max(
              CARD_RADIUS - TAIL_WIDTH / 2,
              Math.min(anchorCentre - pos.left - TAIL_WIDTH / 2, pos.width - CARD_RADIUS - TAIL_WIDTH / 2)
            )
            return (
              <div
                ref={popoverRef}
                className="tracely-popover"
                style={{
                  position: 'absolute',
                  left: pos.left,
                  // One or the other, never both — placing above anchors the
                  // bottom edge so the card grows upward from the underline.
                  ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
                  width: pos.width,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  pointerEvents: 'auto'
                }}
              >
                {pointing === 'up' ? <PopoverTail left={tailLeft} pointing="up" /> : null}
                <div
                  style={{
                    width: '100%',
                    // The tail is drawn outside this box, so its own height
                    // comes out of the room the card has to grow into.
                    maxHeight: Math.max(1, pos.maxHeight - TAIL_HEIGHT),
                    background: '#fff',
                    border: CARD_BORDER,
                    borderRadius: CARD_RADIUS,
                    boxShadow: CARD_SHADOW,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    // 12, not 10 — the design's card rhythm. Small, but every
                    // stacked block in the card inherits it.
                    gap: 12,
                    color: INK,
                    overflowX: 'hidden',
                    overflowY: 'auto'
                  }}
                >
                {flow ? (
                  <CitationFlowCard
                    state={flow}
                    claimText={claimHoveredSummary.text}
                    visibleClaimCount={visibleCount}
                    onSelectCandidate={(ref) => selectCandidate(claimHoveredSummary.id, ref)}
                    onSetStyle={(style) => setCandidateStyle(claimHoveredSummary.id, style)}
                    onSearchAgain={() => void startCitationFlow(claimHoveredSummary.id)}
                    onInsert={() => void insertCitation(claimHoveredSummary.id)}
                    onCancel={() => setFlow(claimHoveredSummary.id, null)}
                    onDone={() => setFlow(claimHoveredSummary.id, null)}
                    onToggleWorksCited={() => toggleWorksCited(claimHoveredSummary.id)}
                    onUndo={() => void undoCitation(claimHoveredSummary.id)}
                    inserting={citationBusyIds.has(claimHoveredSummary.id)}
                    undoing={undoBusyIds.has(claimHoveredSummary.id)}
                  />
                ) : (
                  <ProblemCard
                    claim={claimHoveredSummary}
                    onSuggestFix={() => {
                      selectClaim(claimHoveredSummary.id)
                      setHover(null)
                      void window.tracely.screenWatch.setWidgetExpanded({ expanded: true })
                    }}
                    onStartCitationFlow={() => void startCitationFlow(claimHoveredSummary.id)}
                    activeKind={hoveredActiveKind}
                    remaining={hoveredRemaining}
                    onDismiss={() =>
                      dismissIssue(claimHoveredSummary.id, hoveredActiveKind, hoveredRemaining)
                    }
                  />
                )}
                </div>
                {pointing === 'down' ? <PopoverTail left={tailLeft} pointing="down" /> : null}
              </div>
            )
          })()
        : null}

      {/* This window has no shared stylesheet (see overlay.html — kept
          minimal on purpose for a transparent always-on-top window), so
          hover/press states and the entrance animation live in a small
          scoped style block instead of index.css. */}
      <style>{`
        /* Every panel/card size in this file is computed to line up exactly
           with sizes computed server-side (computeAllPanelSize etc.), which
           assume border-box — content-box (the CSS default) silently adds
           padding/border on top of an explicit width/height and was the
           actual cause of content clipping against the panel edge. */
        *, *::before, *::after {
          box-sizing: border-box;
        }
        @keyframes tracely-popover-in {
          from { opacity: 0; transform: translateY(4px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .tracely-popover {
          animation: tracely-popover-in 0.14s ease-out;
        }
        @keyframes tracely-underline-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        /* No fill-mode on purpose. This window is never focused and always
           sits above another app, which is exactly the situation Chromium
           throttles animation/rAF callbacks in — if this never runs, the
           mark must still be visible. Base opacity is 1 and the animation
           only softens the entrance, so the degraded case is "appears
           instantly" rather than "never appears". */
        .tracely-underline {
          animation: tracely-underline-in 0.16s ease;
        }
        .tracely-btn-primary {
          transition: background 0.12s ease, transform 0.08s ease;
        }
        .tracely-btn-primary:hover:not(:disabled) {
          background: #2c2c33;
        }
        .tracely-btn-primary:active:not(:disabled) {
          transform: scale(0.97);
        }
        .tracely-btn-secondary {
          transition: background 0.12s ease;
        }
        .tracely-btn-secondary:hover:not(:disabled) {
          background: rgba(0, 0, 0, 0.05);
        }
        .tracely-btn-secondary:active:not(:disabled) {
          background: rgba(0, 0, 0, 0.09);
        }
        .tracely-btn-primary:disabled,
        .tracely-btn-secondary:disabled {
          cursor: default;
        }
        .tracely-btn-text {
          transition: color 0.12s ease;
        }
        .tracely-btn-text:hover {
          color: ${INK};
        }
        .tracely-list-row {
          transition: border-color 0.12s ease, box-shadow 0.12s ease;
        }
        .tracely-list-row:hover {
          border-color: #c9c9d0;
          box-shadow: 0 2px 10px rgba(15, 15, 20, 0.06);
        }
        .tracely-list-row:active {
          transform: scale(0.99);
        }
        @keyframes tracely-spin {
          to { transform: rotate(360deg); }
        }
        .tracely-spinner {
          display: inline-block;
          width: 10px;
          height: 10px;
          border: 1.5px solid rgba(0, 0, 0, 0.12);
          border-top-color: ${ACCENT};
          border-radius: 50%;
          animation: tracely-spin 0.7s linear infinite;
        }
        .tracely-progress-track {
          height: 6px;
          border-radius: 999px;
          background: #ededed;
          overflow: hidden;
          width: 100%;
        }
        .tracely-progress-fill {
          height: 100%;
          width: 40%;
          border-radius: 999px;
          background: ${ACCENT};
          animation: tracely-progress 1.1s ease-in-out infinite;
        }
        @keyframes tracely-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        @keyframes tracely-skeleton-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        /* Two greys, not one at two opacities: the design's second bar is a
           genuinely lighter fill, which is what makes a skeleton row read as a
           title over a subtitle rather than as one block. */
        .tracely-skeleton {
          background: #ebebeb;
          animation: tracely-skeleton-pulse 1.1s ease-in-out infinite;
        }
        .tracely-skeleton-faint {
          background: #f4f4f4;
          animation: tracely-skeleton-pulse 1.1s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
