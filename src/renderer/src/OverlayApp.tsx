import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  ScreenWatchSourceCandidate,
  ScreenWatchStructure,
  ScreenWatchWidget
} from '@shared/ipc-contract'
import figmaLogo from './assets/figma-logo.png'
import MarkdownText from './components/MarkdownText'

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

// Per-claim-type color used for the underline and the type dot — matches
// the Figma "Overlay Mockup" frames' 4-color legend (factual/statistic/
// reasoning/other), not the prior pastel-badge palette.
type Bucket = 'statistic' | 'factual' | 'causal' | 'other'

function bucketFor(claimType: ClaimType): Bucket {
  if (claimType === 'statistic') return 'statistic'
  if (claimType === 'factual') return 'factual'
  if (claimType === 'causal') return 'causal'
  return 'other'
}

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
  hovered
}: {
  claimId: string
  x: number
  y: number
  width: number
  height: number
  color: string
  hovered: boolean
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
          height: hovered ? 3 : 2,
          borderRadius: 2,
          background: color,
          opacity: hovered ? 1 : 0.85,
          transition: 'opacity 110ms ease, height 110ms ease'
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
function hasInlineCitationText(sentence: string): boolean {
  return (
    /\([A-Z][^)]{0,80}?(?:1[6-9]|20)\d{2}[a-z]?\s*\)/.test(sentence) ||
    /\[\s*\d{1,3}(?:\s*[–—,-]\s*\d{1,3})*\s*\]/.test(sentence)
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

function ArticleRow({ article }: { article: ScreenWatchEvidenceArticle }): JSX.Element {
  const meta = [article.venue, article.year ? String(article.year) : null].filter(Boolean).join(' · ')
  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }
  const content = (
    <>
      <SourceIcon provider={article.provider} faviconDataUrl={article.faviconDataUrl} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: INK,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {article.title}
        </div>
        {meta ? <div style={{ fontSize: 10.5, color: DIM }}>{meta}</div> : null}
      </div>
    </>
  )
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

// Up to 3 real article titles (see MAX_ARTICLES_IN_OVERLAY in
// screenWatchService.ts) — previously this card only ever showed a bare
// "N sources" count with nothing to actually look at.
function ArticleList({ claim, limit }: { claim: ScreenWatchClaimSummary; limit?: number }): JSX.Element | null {
  if (!claim.evidence || claim.evidence.articles.length === 0) return null
  const articles = limit ? claim.evidence.articles.slice(0, limit) : claim.evidence.articles
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {articles.map((article, i) => (
        <ArticleRow key={`${article.title}-${i}`} article={article} />
      ))}
    </div>
  )
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
  contradicted: 'Contradicted — False'
}

const WEAK_VERDICTS: CritiqueVerdict[] = ['weak', 'unsupported', 'contradicted']

function verdictColor(verdict: CritiqueVerdict): string {
  if (verdict === 'well-supported') return POSITIVE
  if (verdict === 'partially-supported' || verdict === 'weak') return '#b3690a'
  return '#d6301a'
}

function verdictWash(verdict: CritiqueVerdict): string {
  if (verdict === 'well-supported') return 'rgba(31, 157, 99, 0.12)'
  if (verdict === 'partially-supported' || verdict === 'weak') return 'rgba(179, 105, 10, 0.12)'
  return 'rgba(214, 48, 26, 0.12)'
}

// The full card used by the widget panel — claim text, live evidence with
// real article titles, and the Check Claim / Find Evidence actions.
// `context` controls how much this card assumes: 'panel' (the widget you
// deliberately opened) is the only place this renders now — the hover
// popup uses the lighter ProblemCard/CitationFlowCard below instead of this
// heavier card, matching the Figma "Inline Detection (Grammarly-style)"
// mockups' lightweight glance-only popup.
// -- The widget's single-claim card: Figma "Argument check" -----------
//
// The design's own breakdown is Support / Relevance / Quality / Recency, which
// are exactly the factors computeStrength weighs in search/scoring.ts. That is
// the point of publishing them: a student handed 34/100 can see which factor
// cost them the marks and argue with it, which is only possible because the
// score is a formula rather than a model's opinion.

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

const WIDGET_PRIMARY_BTN: CSSProperties = {
  border: 'none',
  borderRadius: 999,
  padding: '12px 18px',
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
  fontSize: 14,
  fontWeight: 500,
  color: W_INK,
  background: '#fff',
  cursor: 'pointer'
}

/** The design's bands, on the same 70/40 thresholds used everywhere else. */
function strengthBand(score: number): { label: string; fg: string; bg: string } {
  if (score >= 70) return { label: 'Strong', fg: '#16a34a', bg: '#dcfce7' }
  if (score >= 40) return { label: 'Moderate', fg: '#b3690a', bg: '#fef3c7' }
  return { label: 'Weak', fg: '#dc2626', bg: '#fee2e2' }
}

function SectionLabel({ children }: { children: string }): JSX.Element {
  return <div style={{ fontSize: 11, fontWeight: 600, color: DIM, letterSpacing: 0.6 }}>{children}</div>
}

function Divider(): JSX.Element {
  return <div style={{ height: 1, width: '100%', background: W_DIVIDER, flexShrink: 0 }} />
}

/** One factor of the score, as a labelled 5px bar. */
function MetricCell({ label, value }: { label: string; value: number }): JSX.Element {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div style={{ flex: '1 0 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, whiteSpace: 'nowrap' }}>
        <span style={{ color: W_BODY, fontWeight: 500 }}>{label}</span>
        <span style={{ color: W_INK, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: W_TRACK, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: W_INK }} />
      </div>
    </div>
  )
}

function ClaimActionCard({
  claim,
  evidenceBusy,
  critiqueBusy,
  onFindEvidence,
  onCritique
}: {
  claim: ScreenWatchClaimSummary
  evidenceBusy: boolean
  critiqueBusy: boolean
  onFindEvidence: () => void
  onCritique: () => void
}): JSX.Element {
  const findLabel = evidenceBusy ? 'Searching…' : claim.evidence ? 'Refresh Evidence' : 'Find Evidence'
  const critiqueLabel = critiqueBusy ? 'Checking…' : claim.critique ? 'Re-check Argument' : 'Check Argument'
  const evidence = claim.evidence
  const band = evidence ? strengthBand(evidence.score) : null

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

      <Divider />

      {evidence && band ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                <SectionLabel>ARGUMENT STRENGTH</SectionLabel>
                <span
                  style={{
                    background: band.bg,
                    color: band.fg,
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 999,
                    padding: '4px 10px'
                  }}
                >
                  {band.label}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <span style={{ fontSize: 26, fontWeight: 600, color: W_INK }}>{evidence.score}</span>
                <span style={{ fontSize: 14, color: DIM }}>/100</span>
              </div>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: W_TRACK, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${evidence.score}%`, borderRadius: 999, background: band.fg }} />
            </div>
          </div>

          <SectionLabel>BREAKDOWN</SectionLabel>
          {/*
            Two rows of two, in the design's order — except that `support` is
            deliberately not among them. It is weighted 0 whenever the stance
            model has not decided, which ml/index.ts establishes is every
            packaged build, so its bar would sit at zero on every claim in the
            app and read as a failing grade rather than as an absent input.
            `sourceCount` takes the fourth slot: it is a real factor of the
            score, and unlike support it actually varies.
          */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
            <div style={{ display: 'flex', gap: 24, width: '100%' }}>
              <MetricCell label="Relevance" value={evidence.breakdown.relevance} />
              <MetricCell label="Sources" value={evidence.breakdown.sourceCount} />
            </div>
            <div style={{ display: 'flex', gap: 24, width: '100%' }}>
              <MetricCell label="Quality" value={evidence.breakdown.quality} />
              <MetricCell label="Recency" value={evidence.breakdown.recency} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#8a8b90', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: '#8a8b90' }}>
              {evidence.count} source{evidence.count === 1 ? '' : 's'} found for this claim
            </span>
          </div>
        </>
      ) : (
        <EvidenceRow claim={claim} />
      )}

      {claim.critique && claim.critiqueVerdict ? (
        <>
          <Divider />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: verdictColor(claim.critiqueVerdict),
                  flexShrink: 0
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: W_INK }}>Critique</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: verdictColor(claim.critiqueVerdict) }}>
                {VERDICT_LABEL[claim.critiqueVerdict]}
              </span>
            </div>
            <MarkdownText style={{ fontSize: 13.5, lineHeight: 1.4, color: W_BODY }}>{claim.critique}</MarkdownText>
          </div>
        </>
      ) : null}

      <div style={{ display: 'flex', gap: 10, width: '100%' }}>
        <button
          className="tracely-btn-primary"
          onClick={onFindEvidence}
          disabled={evidenceBusy}
          style={{
            ...WIDGET_PRIMARY_BTN,
            flex: '1 0 0',
            minWidth: 0,
            whiteSpace: 'nowrap',
            opacity: evidenceBusy ? 0.6 : 1,
            cursor: evidenceBusy ? 'default' : 'pointer'
          }}
        >
          {findLabel}
        </button>
        <button
          className="tracely-btn-secondary"
          onClick={onCritique}
          disabled={critiqueBusy}
          style={{
            ...WIDGET_SECONDARY_BTN,
            flex: '1 0 0',
            minWidth: 0,
            whiteSpace: 'nowrap',
            opacity: critiqueBusy ? 0.6 : 1,
            cursor: critiqueBusy ? 'default' : 'pointer'
          }}
        >
          {critiqueLabel}
        </button>
      </div>
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
  structure: ScreenWatchStructure
  active: boolean
  onOpen: () => void
}): JSX.Element {
  const color = evidenceScoreColor(structure.score)
  return (
    <button
      onClick={onOpen}
      title={
        `Structure score ${structure.score} of 100` +
        (structure.complete ? '' : ' — provisional, some paragraphs could not be labelled')
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
      <span style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1 }}>{structure.score}</span>
      <span style={{ fontSize: 10.5, color: DIM, lineHeight: 1 }}>structure</span>
      {/* A dot rather than the word "provisional" — the header has room for one
          of them, and the tooltip carries the sentence. */}
      {!structure.complete ? (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#b3690a', flexShrink: 0 }} />
      ) : null}
    </button>
  )
}

function ComponentBar({ value, max, label }: { value: number; max: number; label: string }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 22 }}>
      <span style={{ width: 110, flexShrink: 0, fontSize: 11.5, color: MUTED }}>{label}</span>
      <span style={{ flex: 1, height: 5, borderRadius: 3, background: '#f0f0f3', overflow: 'hidden' }}>
        <span
          style={{
            display: 'block',
            width: `${pct}%`,
            height: '100%',
            borderRadius: 3,
            background: evidenceScoreColor(pct)
          }}
        />
      </span>
      <span style={{ width: 40, flexShrink: 0, textAlign: 'right', fontSize: 11, color: DIM }}>
        {Math.round(value)}/{max}
      </span>
    </div>
  )
}

function StructureView({
  structure,
  liveClaimIds,
  onHighlightParagraph
}: {
  structure: ScreenWatchStructure
  /** Claims still on screen — a weakness pointing at anything else cannot jump. */
  liveClaimIds: Set<string>
  onHighlightParagraph: (index: number, claimId: string | null) => void
}): JSX.Element {
  const color = evidenceScoreColor(structure.score)
  const { detected, withRelevantSource, meanStrength, unchecked } = structure.coverage

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 54,
            flexShrink: 0,
            borderRadius: 12,
            border: `1px solid ${color}33`,
            background: `${color}0f`,
            padding: '7px 0',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: 21, fontWeight: 700, color, lineHeight: 1.1 }}>{structure.score}</div>
          <div style={{ fontSize: 9.5, color: DIM }}>/ 100</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>
            Structure score
            {/* Not decoration. A draft with unlabelled paragraphs was scored on
                an incomplete reading, and the components it could not assess
                were counted as absent rather than skipped — presenting that as
                settled is the failure this prevents. */}
            {!structure.complete ? (
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#b3690a' }}>
                Provisional
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, lineHeight: 1.4 }}>
            {detected === 0 ? (
              'No checkable claims in this draft.'
            ) : (
              <>
                <b>
                  {withRelevantSource} of {detected}
                </b>{' '}
                {detected === 1 ? 'claim has' : 'claims have'} sources
                {meanStrength !== null ? <> · mean {meanStrength}</> : null}
                {/* Stated apart from the ratio: an unchecked claim is not an
                    unsupported one, and the number must not imply a search has
                    run when it has not. */}
                {unchecked > 0 ? <span style={{ color: DIM }}> · {unchecked} unchecked</span> : null}
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {COMPONENT_ROWS.map(([key, label, max]) => (
          <ComponentBar key={key} value={structure.components[key]} max={max} label={label} />
        ))}
      </div>

      {structure.weaknesses.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: 0.3 }}>
            WHAT TO FIX ({structure.weaknesses.length})
          </div>
          {structure.weaknesses.map((weakness, i) => {
            // Only some weaknesses can point at anything on screen. The
            // whole-draft ones (no thesis, no counterargument, no significance)
            // carry paragraphIndex null by construction, and warrant gaps
            // usually fire on paragraphs with no detected claim in them — so a
            // chip that always looked like a button would mostly do nothing.
            const paragraph =
              weakness.paragraphIndex === null
                ? null
                : structure.paragraphs.find((p) => p.index === weakness.paragraphIndex) ?? null
            const jumpable = (paragraph?.claimIds ?? []).some((id) => liveClaimIds.has(id))
            return (
              <div
                key={`${weakness.kind}-${weakness.paragraphIndex ?? 'draft'}-${i}`}
                style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}
              >
                {jumpable && paragraph ? (
                  <button
                    className="tracely-btn-text"
                    onClick={() => onHighlightParagraph(paragraph.index, weakness.claimId)}
                    title="Show this paragraph's claims on screen"
                    style={{ ...TEXT_BTN_STYLE, flexShrink: 0, padding: 0, fontSize: 11 }}
                  >
                    ¶{paragraph.index}
                  </button>
                ) : (
                  <span style={{ flexShrink: 0, fontSize: 11, color: DIM }}>
                    {weakness.paragraphIndex === null ? 'Draft' : `¶${weakness.paragraphIndex}`}
                  </span>
                )}
                <span style={{ fontSize: 11.5, lineHeight: 1.45, color: MUTED }}>
                  {weakness.message}{' '}
                  {/* The one action available on every weakness, including the
                      whole-draft ones. The prompt is written in the student's
                      voice (see weaknesses.ts) so Tracer answers the question
                      rather than reading it as an instruction to fix the text. */}
                  <button
                    className="tracely-btn-text"
                    onClick={() =>
                      void window.tracely.tracer.open({
                        claimId: weakness.claimId ?? undefined,
                        prompt: weakness.tracerPrompt
                      })
                    }
                    style={{ ...TEXT_BTN_STYLE, padding: 0, fontSize: 11.5 }}
                  >
                    Ask Tracer
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: 0.3 }}>PARAGRAPHS</div>
        {structure.paragraphs.map((paragraph) => (
          <div
            key={paragraph.index}
            style={{ display: 'flex', alignItems: 'baseline', gap: 7, height: 30 }}
            data-paragraph={paragraph.index}
            data-role={paragraph.role}
          >
            <span style={{ width: 14, flexShrink: 0, fontSize: 10.5, color: DIM }}>
              {paragraph.index}
            </span>
            <span
              style={{
                width: 92,
                flexShrink: 0,
                fontSize: 11,
                fontWeight: 600,
                color: paragraph.role === 'unknown' ? DIM : INK
              }}
            >
              {ROLE_LABEL[paragraph.role]}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11,
                color: DIM,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {structure.previews[paragraph.index - 1] ?? ''}
            </span>
          </div>
        ))}
      </div>

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

// -- Hover popup: ProblemCard -----------------------------------------
//
// The lightweight "Grammarly-style" glance card — a single problem
// statement and one primary action, distinct from the widget panel's
// heavier ClaimActionCard. Which of the three variants shows is derived
// entirely from the claim's own state (critique verdict, evidence
// resolution), not tracked separately.

type ProblemKind = 'weak-reasoning' | 'searching' | 'statistic' | 'citation'

function problemKindFor(claim: ScreenWatchClaimSummary): ProblemKind {
  if (claim.critiqueVerdict && WEAK_VERDICTS.includes(claim.critiqueVerdict)) return 'weak-reasoning'
  if (!claim.evidence) return 'searching'
  return claim.claimType === 'statistic' ? 'statistic' : 'citation'
}

// Why this exists, and why it isn't just `problemKindFor`:
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

type SupportLevel = 'none' | 'weak' | 'mixed' | 'strong'

function supportLevelFor(evidence: ScreenWatchClaimEvidence): SupportLevel {
  if (evidence.count === 0) return 'none'
  if (evidence.score >= 70) return 'strong'
  if (evidence.score >= 40) return 'mixed'
  return 'weak'
}

const KIND_NOUN: Record<Bucket, string> = {
  statistic: 'figure',
  factual: 'claim',
  causal: 'cause-and-effect claim',
  other: 'statement'
}

/**
 * Title, description AND the primary button's label for a claim whose evidence
 * search has resolved.
 *
 * The action belongs here, with the diagnosis, because it kept drifting from
 * it. The label used to be computed separately as `evidence.count > 0 ? 'Add
 * citation' : 'Find a source'` — binary on whether anything came back at all —
 * so a card correctly titled "Evidence is weak … they are related rather than
 * confirming" still offered "Add citation" underneath, telling the student to
 * cite the very sources it had just told them not to lean on. That is the same
 * flattening of two axes this function was written to fix for the title; the
 * button was left behind. One return value now, so they cannot disagree again.
 */
function problemCopyFor(claim: ScreenWatchClaimSummary, evidence: ScreenWatchClaimEvidence): {
  title: string
  description: string
  action: string
} {
  const bucket = bucketFor(claim.claimType)
  const level = supportLevelFor(evidence)
  const noun = KIND_NOUN[bucket]
  const n = evidence.count
  const sources = `${n} source${n === 1 ? '' : 's'}`

  if (level === 'none') {
    // "Unverified statistic" is the design's wording, and it is the better one:
    // "figure" reads as a chart as easily as a number.
    if (claim.hasInlineCitation) {
      return {
        title: bucket === 'statistic' ? 'Unverified statistic' : 'Source not found',
        description: `You have cited this ${noun}, but a search of the academic databases found nothing carrying it. That can mean the source is not indexed — or that it does not say this.`,
        action: 'Find a source'
      }
    }
    return {
      title: bucket === 'statistic' ? 'Unverified statistic' : 'No supporting sources',
      description:
        bucket === 'statistic'
          ? 'A search of the academic databases turned up nothing carrying this statistic. Check the number against its original source before citing it.'
          : `A search of the academic databases turned up nothing supporting this ${noun}. It may still be true — but you have nothing to cite for it yet.`,
      action: 'Find a source'
    }
  }

  if (level === 'weak') {
    return {
      title: bucket === 'causal' ? 'Cause and effect not established' : 'Evidence is weak',
      description:
        bucket === 'causal'
          ? `${sources} touch on this, but score ${evidence.score}/100 for supporting a causal link specifically. Correlation in the literature is not the same as the cause you have asserted here.`
          : `${sources} came back, but they score ${evidence.score}/100 for actually supporting this ${noun} — they are related rather than confirming. Read them before leaning on them.`,
      // Not "Add citation". The card just said these do not confirm the claim;
      // the honest next step is to look at them, which is what the picker shows.
      action: 'Review the sources'
    }
  }

  if (level === 'mixed') {
    return {
      title: 'Partially supported',
      description: `${sources} score ${evidence.score}/100 for this ${noun} — enough to cite, but they qualify it rather than confirm it outright. Consider softening how strongly it is stated.`,
      action: 'Add citation'
    }
  }

  // strong — the claim holds up. What is left depends entirely on whether the
  // writer has already attributed it, and telling someone who cited properly
  // that they are "Missing citation" is the single least credible thing this
  // card can do. A claim that is BOTH cited and strong is not shown at all
  // (see `settled` in screenWatchService), so this branch is the case where a
  // cited claim is still worth a look.
  if (claim.hasInlineCitation) {
    return {
      title: 'Cited — worth checking',
      description: `${sources} agree with this ${noun} (${evidence.score}/100). Tracely cannot read the source you cited, so check it says what you have attributed to it.`,
      action: 'Compare sources'
    }
  }
  return {
    title: 'Missing citation',
    description: `${sources} support this ${noun} (${evidence.score}/100). It reads as unattributed, though — add a citation so the reader can follow it.`,
    action: 'Add citation'
  }
}

function ProblemCard({
  claim,
  onSuggestFix,
  onStartCitationFlow,
  onAskTracer,
  onDismiss
}: {
  claim: ScreenWatchClaimSummary
  onSuggestFix: () => void
  onStartCitationFlow: () => void
  onAskTracer: () => void
  onDismiss: () => void
}): JSX.Element {
  const kind = problemKindFor(claim)

  if (kind === 'searching') {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: MUTED }}>
          <span className="tracely-spinner" />
          Checking for supporting evidence…
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button className="tracely-btn-text" onClick={onDismiss} style={TEXT_BTN_STYLE}>
            Dismiss
          </button>
        </div>
      </>
    )
  }

  // The dot now carries the claim's own bucket colour, so it matches the
  // underline that was hovered to open this card. It was hardcoded to
  // factual-orange for everything except weak reasoning, which meant hovering
  // a purple or blue underline produced an orange dot.
  const dot: Bucket = bucketFor(claim.claimType)
  const copy =
    kind === 'weak-reasoning'
      ? {
          title: 'Weak reasoning',
          description:
            claim.critique ??
            "This conclusion doesn't clearly follow from the evidence cited. Consider strengthening the argument.",
          action: 'Suggest fix'
        }
      : // `kind` is only 'searching' when evidence is null, and that case
        // returned above — so evidence is non-null here.
        problemCopyFor(claim, claim.evidence as ScreenWatchClaimEvidence)
  const { title, description, action: primaryLabel } = copy
  const onPrimary = kind === 'weak-reasoning' ? onSuggestFix : onStartCitationFlow

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: BUCKET_COLOR[dot], flexShrink: 0 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{title}</div>
      </div>
      <MarkdownText style={{ fontSize: 13, lineHeight: 1.4, color: MUTED }}>{description}</MarkdownText>
      {/*
        The design's action row is exactly two buttons — fix it, or dismiss it —
        and at 320 wide that is all that fits on one line. Ask Tracer is not in
        the mockups because it postdates them, and it is the one action here
        that teaches rather than fixes, so it sits below as a text link instead
        of competing with them. Opening Tracer takes OS focus away from the
        watched app, which is why screenWatchService holds its claim state
        while that window is up.
      */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="tracely-btn-primary" onClick={onPrimary} style={PRIMARY_BTN_STYLE}>
          {primaryLabel}
        </button>
        <button className="tracely-btn-secondary" onClick={onDismiss} style={SECONDARY_BTN_STYLE}>
          Dismiss
        </button>
      </div>
      <button
        className="tracely-btn-text"
        onClick={onAskTracer}
        style={{ ...TEXT_BTN_STYLE, alignSelf: 'flex-start', fontSize: 12.5 }}
      >
        Ask Tracer why
      </button>
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

function nextStyle(style: CitationStyle): CitationStyle {
  return CITATION_STYLES[(CITATION_STYLES.indexOf(style) + 1) % CITATION_STYLES.length]
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
  if (state.step === 'searching') {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT, flexShrink: 0 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>Searching for a source</div>
        </div>
        {/* The design quotes the claim back, and it is worth the width: this
            card can be opened from any of several underlines, and naming the
            one being searched for is the difference between "it is working"
            and "it is working on the right sentence". */}
        <div style={{ fontSize: 13, lineHeight: 1.4, color: MUTED }}>
          Scanning open-access journals and databases
          {claimText ? <> for a source that supports &ldquo;{truncate(claimText, 90)}&rdquo;</> : null}.
        </div>
        {/* Figma draws the bar at a fixed 61%, which is a snapshot of a moment.
            A real search has no progress to report, so this stays indeterminate
            — a bar that appears to measure something it cannot would be worse
            than an honest one that only says "still going". Track geometry and
            colour are the design's. */}
        <div className="tracely-progress-track">
          <div className="tracely-progress-fill" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {SKELETON_ROWS.map(([wide, narrow], i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="tracely-skeleton" style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="tracely-skeleton" style={{ height: 9, width: wide, borderRadius: 999 }} />
                <div className="tracely-skeleton-faint" style={{ height: 8, width: narrow, borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="tracely-btn-secondary" onClick={onCancel} style={SECONDARY_BTN_STYLE}>
            Cancel
          </button>
          <div style={{ fontSize: 12, color: DIM }}>Usually 3–5 seconds</div>
        </div>
      </>
    )
  }

  if (state.step === 'error') {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#d6301a', flexShrink: 0 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Couldn&apos;t do that</div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: MUTED }}>{state.message}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button className="tracely-btn-secondary" onClick={onSearchAgain} style={SECONDARY_BTN_STYLE}>
            Try again
          </button>
          <button className="tracely-btn-text" onClick={onCancel} style={TEXT_BTN_STYLE}>
            Cancel
          </button>
        </div>
      </>
    )
  }

  if (state.step === 'inserted') {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: POSITIVE, flexShrink: 0 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Citation added</div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: MUTED }}>
          This claim is now backed by a source in your document. {state.citation.inTextCitation} in-text citation inserted.
        </div>
        {state.showWorksCited ? (
          <div style={{ border: '1px solid #eeeef1', borderRadius: 10, padding: '8px 10px', background: '#fafafa' }}>
            {/*
              "Added to Works Cited" was not true. Only the in-text form is
              written into the document; nothing appends to a works-cited list,
              and citationByClaimId is per-session and never persisted — a
              student reads that phrase as "the list at the end of my essay".
              This labels the string below it, which is what it actually is.
            */}
            <div style={{ fontSize: 10.5, fontWeight: 700, color: DIM, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
              Works Cited entry — copy into your reference list
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: '#3a3a3a' }}>{state.citation.worksCitedEntry}</div>
          </div>
        ) : null}
        <div style={{ fontSize: 12, color: POSITIVE, fontWeight: 600 }}>
          Claim resolved · {visibleClaimCount} flag{visibleClaimCount === 1 ? '' : 's'} left in this document
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button className="tracely-btn-primary" onClick={onDone} style={PRIMARY_BTN_STYLE}>
            Done
          </button>
          <button className="tracely-btn-secondary" onClick={onToggleWorksCited} style={SECONDARY_BTN_STYLE}>
            {state.showWorksCited ? 'Hide full citation' : 'View full citation'}
          </button>
          <button
            className="tracely-btn-secondary"
            onClick={onUndo}
            disabled={undoing}
            style={{ ...SECONDARY_BTN_STYLE, opacity: undoing ? 0.6 : 1 }}
          >
            {undoing ? 'Undoing…' : 'Undo'}
          </button>
        </div>
      </>
    )
  }

  // picking
  const selected = state.candidates.find((c) => c.sourceRef === state.selectedRef) ?? null
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: POSITIVE, flexShrink: 0 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>
            {state.candidates.length} source{state.candidates.length === 1 ? '' : 's'} found
          </div>
        </div>
        {/* Figma shows the citation style as a single read-only chip. It is a
            control here because the style has to be choosable somewhere and
            this window cannot open a menu — it is unfocusable, so there is no
            popup to host one. Clicking cycles; the tooltip says so. */}
        <button
          onClick={() => onSetStyle(nextStyle(state.style))}
          title={`Citation style: ${state.style}. Click to switch.`}
          style={{
            background: CHIP_BG,
            border: 'none',
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: 11.5,
            fontWeight: 500,
            color: MUTED,
            cursor: 'pointer',
            font: 'inherit',
            fontFamily: 'inherit'
          }}
        >
          {STYLE_LABEL[state.style]}
        </button>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.4, color: MUTED }}>
        {state.candidates.length === 0
          ? 'No sources found for this claim yet.'
          : claimText
            ? `Ranked by how directly each source supports “${truncate(claimText, 90)}”.`
            : 'Ranked by how directly each source supports this claim.'}
      </div>

      {state.candidates.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', maxHeight: 168, overflowY: 'auto' }}>
          {state.candidates.map((c) => {
            const isSelected = c.sourceRef === state.selectedRef
            return (
              <label
                key={c.sourceRef}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 8,
                  borderRadius: 10,
                  width: '100%',
                  boxSizing: 'border-box',
                  // Selected rows gain a fill and a hairline; the rest keep a
                  // transparent border so selecting one does not shift the
                  // others by a pixel.
                  background: isSelected ? SELECTED_BG : 'transparent',
                  border: `1px solid ${isSelected ? '#e5e5e5' : 'transparent'}`,
                  cursor: 'pointer'
                }}
              >
                <SourceIcon provider={c.provider} faviconDataUrl={c.faviconDataUrl} />
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: INK,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {c.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
                    <span style={{ color: DIM, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[c.venue, c.year ? String(c.year) : null].filter(Boolean).join(' · ')}
                    </span>
                    <span style={{ color: POSITIVE, fontWeight: 500, flexShrink: 0 }}>{c.matchPercent}% match</span>
                  </div>
                </div>
                {/* A drawn radio rather than <input type="radio">: the native
                    control renders at the OS accent colour and its own size,
                    which is the one part of this card that would look like
                    Windows instead of like Tracely. */}
                <input
                  type="radio"
                  checked={isSelected}
                  onChange={() => onSelectCandidate(c.sourceRef)}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                />
                <span
                  aria-hidden
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    flexShrink: 0,
                    boxSizing: 'border-box',
                    background: '#fff',
                    border: isSelected ? `5px solid ${INK}` : '1.5px solid #d1d1d1'
                  }}
                />
              </label>
            )
          })}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="tracely-btn-primary"
          onClick={onInsert}
          disabled={!state.selectedRef || inserting}
          style={{ ...PRIMARY_BTN_STYLE, opacity: !state.selectedRef || inserting ? 0.6 : 1 }}
        >
          {inserting ? 'Inserting…' : 'Insert citation'}
        </button>
        {selected?.url ? (
          <button className="tracely-btn-secondary" onClick={() => openUrl(selected.url)} style={SECONDARY_BTN_STYLE}>
            Preview
          </button>
        ) : null}
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

  function dismiss(claimId: string): void {
    setDismissedIds((prev) => new Set(prev).add(claimId))
  }

  function selectClaim(claimId: string): void {
    setSelectedClaimId(claimId)
    showSingle()
  }

  async function findEvidenceFor(claimId: string): Promise<void> {
    setActionError(null)
    setBusyEvidenceIds((prev) => new Set(prev).add(claimId))
    try {
      await window.tracely.screenWatch.refreshEvidence({ claimId })
      // The result lands via the next SCREENWATCH_OVERLAY_UPDATE push
      // (screenWatchService.ts redraws right after updating its state) —
      // nothing to store from the response itself.
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
        // The hover event carries the sentence, so this can be answered here
        // rather than guessed — and guessing false would flash "Missing
        // citation" on a cited claim for the tick before the payload lands.
        hasInlineCitation: hasInlineCitationText(claimHovered.text),
        evidence: null,
        critique: null,
        critiqueVerdict: null,
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

  const hoveredFlowStep = claimHovered
    ? (citationFlowByClaimId.get(claimHovered.claimId)?.step ?? null)
    : null
  const hoveredPopoverWidth = hoveredFlowStep ? POPOVER_WIDTH_FLOW : POPOVER_WIDTH_GLANCE
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
          const color = BUCKET_COLOR[bucketFor(u.claimType)]
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
                  <span
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      minWidth: 22,
                      height: 22,
                      padding: '0 5px',
                      borderRadius: 999,
                      background: ACCENT,
                      color: '#fff',
                      fontSize: 11.5,
                      fontWeight: 700,
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
                  {widget.structure ? (
                    <ScoreChip
                      structure={widget.structure}
                      active={widget.viewMode === 'structure'}
                      onOpen={showStructure}
                    />
                  ) : null}
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
                    {widget.viewMode === 'single' ? (
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
                        {widget.viewMode === 'single'
                          ? 'Argument check'
                          : `${widget.claimCount} claim${widget.claimCount === 1 ? '' : 's'} flagged`}
                      </div>
                    ) : null}
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
                  {widget.viewMode === 'structure' && widget.structure ? (
                    <StructureView
                      structure={widget.structure}
                      liveClaimIds={liveClaimIds}
                      onHighlightParagraph={highlightParagraph}
                    />
                  ) : visibleClaims.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 24 }}>
                      <div style={{ fontSize: 12.5, color: DIM, textAlign: 'center' }}>No claims flagged yet.</div>
                      {/* Tracer is useful with nothing flagged — it's a
                          tutor, not a claim inspector, so it stays
                          reachable even on an empty panel. */}
                      <button
                        className="tracely-btn-secondary"
                        onClick={() => void window.tracely.tracer.open({})}
                        style={SECONDARY_BTN_STYLE}
                      >
                        Ask Tracer
                      </button>
                    </div>
                  ) : widget.viewMode === 'single' && topClaim ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100%' }}>
                      <ClaimActionCard
                        claim={topClaim}
                        evidenceBusy={busyEvidenceIds.has(topClaim.id)}
                        critiqueBusy={busyCritiqueIds.has(topClaim.id)}
                        onFindEvidence={() => void findEvidenceFor(topClaim.id)}
                        onCritique={() => void critiqueFor(topClaim.id)}
                      />
                      {actionError ? <div style={{ fontSize: 11.5, color: '#d6301a' }}>{actionError}</div> : null}
                      <div style={{ flex: 1 }} />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <button
                          className="tracely-btn-secondary"
                          onClick={() => void window.tracely.tracer.open({ claimId: topClaim.id })}
                          style={{ ...SECONDARY_BTN_STYLE, flex: '1 1 130px' }}
                        >
                          Ask Tracer
                        </button>
                        {visibleClaims.length > 1 ? (
                          <button
                            className="tracely-btn-secondary"
                            onClick={showAll}
                            style={{ ...SECONDARY_BTN_STYLE, flex: '1 1 130px' }}
                          >
                            Show all ({visibleClaims.length})
                          </button>
                        ) : null}
                      </div>
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
                  maxHeight: pos.maxHeight,
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
                  overflowY: 'auto',
                  pointerEvents: 'auto'
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
                    onAskTracer={() => void window.tracely.tracer.open({ claimId: claimHoveredSummary.id })}
                    onDismiss={() => dismiss(claimHoveredSummary.id)}
                  />
                )}
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
