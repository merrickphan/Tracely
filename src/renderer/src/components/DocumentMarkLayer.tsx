import { useLayoutEffect, useRef, useState } from 'react'
import { placePopover } from '@shared/popoverPlacement'
import type { CitationStyle } from '@shared/types'
import type { DocumentMark, MarkRect } from './documentMarks'
import MarkdownText from './MarkdownText'
import { PROBLEM_COLOR, PROBLEM_LABEL, isReasoningProblem, popoverCopyFor } from './problemCopy'
// The flow's wording is shared with the Screen Watch overlay, which draws the
// same four frames over other applications — see citationFlowCopy.ts.
import {
  CITATION_STYLE_LABEL,
  emptyResultsBody,
  flagsLeft,
  insertedBody,
  resultsBody,
  resultsTitle,
  searchingBody
} from './citationFlowCopy'

/**
 * The underlines drawn over the document editor, and the popover that opens on
 * hover.
 *
 * Matches the Figma "Overlay Mockup — Inline Detection" frames: a 2px mark
 * under the sentence in the colour of what is wrong with it, and on hover a
 * bordered white card with a matching dot, one sentence of diagnosis, and a
 * primary action beside Dismiss.
 *
 * Nothing in here is focusable or clickable except the popover itself. The
 * layer sits over a contentEditable the user is typing in, so `pointer-events`
 * is off everywhere it would otherwise swallow a click into the text —
 * hovering is detected by hit-testing the measured rects against the mouse
 * position in the parent, not by putting elements under the cursor.
 */

// Two widths, because the design uses two. The inline-detection card is 320 — a
// glance over the sentence, sized to be read without moving your eyes far. The
// citation flow is 380, because a list of candidate sources with titles, venues
// and match percentages does not fit in 320. The same pair the overlay uses.
const POPOVER_WIDTH = 320
const POPOVER_WIDTH_FLOW = 380
const POPOVER_GAP = 10
const TAIL_WIDTH = 16
const TAIL_HEIGHT = 10

/** Skeleton bar widths, from the design — the uneven pair is what makes a
 *  loading row read as two lines of a citation rather than a progress widget. */
const SKELETON_ROWS: Array<[number, number]> = [
  [214, 122],
  [186, 96]
]

const CITATION_STYLES: CitationStyle[] = ['MLA', 'APA', 'Chicago']

/** Both halves of a formatted citation: the marker, and the bibliography line. */
export interface DocCitation {
  inTextCitation: string
  worksCitedEntry: string
}

/** One row of "Find a Source (Results)" — flattened from an `EvidenceItem`. */
export interface DocSourceCandidate {
  sourceId: string
  title: string
  venue: string | null
  year: number | null
  /** `relevanceScore` as a percentage — how directly it bears on the sentence. */
  matchPercent: number
  /** The monogram tile's letters, when no favicon is available (they never are
   *  here: these come from academic indexes, not publisher sites). */
  initials: string
}

export type DocCitationFlowState =
  | { step: 'searching' }
  | {
      step: 'picking'
      candidates: DocSourceCandidate[]
      selectedId: string | null
      style: CitationStyle
      /**
       * What "Insert citation" would write, once Preview has been pressed.
       * Cleared by every change to the selection or the style, so a block left
       * standing can never describe something other than what Insert will do.
       */
      preview: DocCitation | null
    }
  | { step: 'inserted'; citation: DocCitation; style: CitationStyle; showWorksCited: boolean }
  | { step: 'error'; message: string }

/**
 * The citation flow for one claim, owned by AnalyzeView.
 *
 * State and handlers arrive together as one object rather than as a dozen
 * props, and the state lives above this component because the popover unmounts
 * the moment the pointer leaves the sentence — a flow that lived here would be
 * destroyed by the first mouse movement after pressing "Add citation".
 */
export interface DocCitationFlow {
  claimId: string
  state: DocCitationFlowState
  inserting: boolean
  previewing: boolean
  undoing: boolean
  /** Flags left on OTHER sentences — the confirmation's "N flags left" line. */
  flagsRemaining: number
  onSelect: (sourceId: string) => void
  onSetStyle: (style: CitationStyle) => void
  onSearchAgain: () => void
  onPreview: () => void
  onInsert: () => void
  onCancel: () => void
  onDone: () => void
  onToggleWorksCited: () => void
  onUndo: () => void
}

export interface DocumentMarkLayerProps {
  marks: DocumentMark[]
  /** The claim the pointer is over, or the one whose popover is pinned open. */
  active: { mark: DocumentMark; rect: MarkRect } | null
  /** Width of the scroll container, so the popover can be kept inside it. */
  wrapWidth: number
  /**
   * Visible height of the scroll container, and how far it is scrolled, as of
   * the hover that opened the popover. Together they say where the visible box
   * sits in the content coordinates `rect` and the card are positioned in —
   * which is what decides whether the card fits below the sentence.
   */
  wrapHeight: number
  wrapScrollTop: number
  /**
   * The citation flow, when one is open for the active mark's claim. Null on
   * every other mark, so the card falls back to the problem statement.
   */
  flow: DocCitationFlow | null
  onFindSource: (mark: DocumentMark) => void
  onSuggestFix: (mark: DocumentMark) => void
  onDismiss: (mark: DocumentMark) => void
  /** Keeps the popover open while the pointer is inside it. */
  onPopoverEnter: () => void
  onPopoverLeave: () => void
}

export default function DocumentMarkLayer({
  marks,
  active,
  wrapWidth,
  wrapHeight,
  wrapScrollTop,
  flow,
  onFindSource,
  onSuggestFix,
  onDismiss,
  onPopoverEnter,
  onPopoverLeave
}: DocumentMarkLayerProps): JSX.Element {
  const activeFlow = flow && active && flow.claimId === active.mark.claim.id ? flow : null
  return (
    <div className="docmark-layer" aria-hidden="true">
      {marks.map((mark) =>
        mark.rects.map((rect, i) => {
          const kind = mark.problemKinds[0]
          const isActive = active?.mark.claim.id === mark.claim.id
          return (
            <span
              key={`${mark.claim.id}:${i}`}
              className={`docmark${isActive ? ' active' : ''}`}
              title={PROBLEM_LABEL[kind]}
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                // The mark is the bottom border, so the box can also carry the
                // hover wash without the underline moving.
                borderBottomColor: PROBLEM_COLOR[kind],
                background: isActive ? `${PROBLEM_COLOR[kind]}1f` : 'transparent'
              }}
            />
          )
        })
      )}
      {active ? (
        <MarkPopover
          mark={active.mark}
          rect={active.rect}
          wrapWidth={wrapWidth}
          wrapHeight={wrapHeight}
          wrapScrollTop={wrapScrollTop}
          flow={activeFlow}
          onFindSource={() => onFindSource(active.mark)}
          onSuggestFix={() => onSuggestFix(active.mark)}
          onDismiss={() => onDismiss(active.mark)}
          onMouseEnter={onPopoverEnter}
          onMouseLeave={onPopoverLeave}
        />
      ) : null}
    </div>
  )
}

function MarkPopover({
  mark,
  rect,
  wrapWidth,
  wrapHeight,
  wrapScrollTop,
  flow,
  onFindSource,
  onSuggestFix,
  onDismiss,
  onMouseEnter,
  onMouseLeave
}: {
  mark: DocumentMark
  rect: MarkRect
  wrapWidth: number
  wrapHeight: number
  wrapScrollTop: number
  flow: DocCitationFlow | null
  onFindSource: () => void
  onSuggestFix: () => void
  onDismiss: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  // Re-measured on the step as well as the claim: the flow's cards are three to
  // five times the height of the problem statement they replace, and a stale
  // measurement is what decides above-vs-below.
  const step = flow?.state.step ?? null
  useLayoutEffect(() => {
    setHeight(cardRef.current?.offsetHeight ?? 0)
  }, [mark.claim.id, step])

  const kind = mark.problemKinds[0]

  const width = flow ? POPOVER_WIDTH_FLOW : POPOVER_WIDTH

  // Centred on the line it points at, then pulled back inside the editor. The
  // tail stays on the sentence when the card moves, which is the whole reason
  // it is offset separately rather than pinned to the card's centre.
  const idealLeft = rect.left + rect.width / 2 - width / 2
  const left = Math.max(8, Math.min(idealLeft, wrapWidth - width - 8))
  const tailLeft = Math.max(12, Math.min(rect.left + rect.width / 2 - left - TAIL_WIDTH / 2, width - 28))

  // Above the line only when there is genuinely no room below and there is room
  // above. Decided in `shared/popoverPlacement.ts`, which is where the tests for
  // it are — the version inlined here reduced to `height > 390` and had been
  // flipping on the card's own height rather than on any measurement.
  const { above: wantsAbove, top } = placePopover({
    markTop: rect.top,
    markHeight: rect.height,
    cardHeight: height,
    gap: POPOVER_GAP,
    viewportHeight: wrapHeight,
    scrollTop: wrapScrollTop
  })

  const { title, description, action } = popoverCopyFor(
    { claimType: mark.claim.claimType, hasInlineCitation: mark.hasInlineCitation, critique: mark.claim.critique },
    mark.evidence,
    kind
  )
  const remaining = mark.problemKinds.length

  return (
    <div
      className="docmark-popover"
      style={{ left, top, width }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {!wantsAbove ? <Tail left={tailLeft} pointing="up" above={false} /> : null}
      <div ref={cardRef} className="docmark-card">
        {flow ? (
          <CitationFlowCard flow={flow} claimText={mark.claim.text} />
        ) : (
          <>
        <div className="docmark-head">
          <span className="docmark-dot" style={{ background: PROBLEM_COLOR[kind] }} />
          <span className="docmark-title">{title}</span>
          {/* Only the first problem is shown; the count is the writer's warning
              that fixing this one will reveal another. */}
          {remaining > 1 ? (
            <span className="docmark-count" title={`${remaining} issues with this sentence — this is the first`}>
              {remaining}
            </span>
          ) : null}
        </div>
        {/* Markdown, not plain text. Two of these descriptions are the
            critique verbatim (see popoverCopyFor), the relay's prompts neither
            request nor forbid markdown, and the model emits it freely — so this
            card was printing literal `**cross-sectional**` at the reader. The
            overlay's identical card has rendered it since MarkdownText existed;
            this one was simply missed. Renders React elements from a parsed
            tree, never HTML, so model output cannot inject markup. */}
        <MarkdownText className="docmark-body">{description}</MarkdownText>
        <div className="docmark-actions">
          <button
            className="docmark-btn-primary"
            onClick={isReasoningProblem(kind) ? onSuggestFix : onFindSource}
          >
            {action}
          </button>
          <button className="docmark-btn-secondary" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
          </>
        )}
      </div>
      {wantsAbove ? <Tail left={tailLeft} pointing="down" above /> : null}
    </div>
  )
}

/**
 * The citation flow, drawn inside the same bordered card the problem statement
 * uses — Figma "Find a Source (Searching)" (294:343), "Find a Source (Results)"
 * (295:349) and "Add Citation (Inserted)" (298:130).
 *
 * The same three frames the Screen Watch overlay draws, and deliberately not a
 * shared component with it: that surface is inline styles in a window with no
 * stylesheet of its own, this one is `.docmark-*` classes from index.css. What
 * they share is the wording (citationFlowCopy.ts) and the shape.
 *
 * The one real difference between the surfaces is Preview, and it is a
 * difference in what each surface CAN do rather than in taste. Over another
 * app's window the overlay writes through UIA and the writer cannot see the
 * result until it lands, so being shown it first is the safeguard. Here the
 * insert goes into Tracely's own editor, on the browser's undo stack — the
 * citation appears in the sentence a few pixels away, and Ctrl+Z takes it back
 * out. Preview is offered anyway, because the works-cited entry is the half
 * that does NOT appear in the sentence.
 */
function CitationFlowCard({ flow, claimText }: { flow: DocCitationFlow; claimText: string }): JSX.Element {
  const { state } = flow

  if (state.step === 'searching') {
    return (
      <>
        <div className="docmark-head">
          <span className="docmark-dot" style={{ background: '#ff5900' }} />
          <span className="docmark-title">Searching for a source</span>
        </div>
        <p className="docmark-body">{searchingBody(claimText)}</p>
        <div className="docmark-progress">
          <div className="docmark-progress-fill" />
        </div>
        <div className="docmark-skeletons">
          {SKELETON_ROWS.map(([wide, narrow], i) => (
            <div className="docmark-skeleton-row" key={i}>
              <span className="docmark-skeleton tile" />
              <span className="docmark-skeleton-lines">
                <span className="docmark-skeleton" style={{ width: wide }} />
                <span className="docmark-skeleton faint" style={{ width: narrow }} />
              </span>
            </div>
          ))}
        </div>
        <div className="docmark-actions">
          <button className="docmark-btn-secondary" onClick={flow.onCancel}>
            Cancel
          </button>
          <span className="docmark-hint">Usually 3–5 seconds</span>
        </div>
      </>
    )
  }

  if (state.step === 'error') {
    return (
      <>
        <div className="docmark-head">
          <span className="docmark-dot" style={{ background: '#d93636' }} />
          <span className="docmark-title">Search failed</span>
        </div>
        <p className="docmark-body">{state.message}</p>
        <div className="docmark-actions">
          <button className="docmark-btn-primary" onClick={flow.onSearchAgain}>
            Search again
          </button>
          <button className="docmark-btn-secondary" onClick={flow.onCancel}>
            Cancel
          </button>
        </div>
      </>
    )
  }

  if (state.step === 'inserted') {
    return (
      <>
        <div className="docmark-head">
          <span className="docmark-dot" style={{ background: '#16a34a' }} />
          <span className="docmark-title">Citation added</span>
        </div>
        <p className="docmark-body">{insertedBody(state.style)}</p>
        {state.showWorksCited ? (
          <div className="docmark-block">
            <div className="docmark-block-label">ADDED TO WORKS CITED</div>
            <div className="docmark-block-body">{state.citation.worksCitedEntry}</div>
          </div>
        ) : null}
        <div className="docmark-resolved">
          <span className="docmark-resolved-yes">Claim resolved</span>
          <span className="docmark-hint">· {flagsLeft(flow.flagsRemaining)}</span>
        </div>
        <div className="docmark-actions">
          <button className="docmark-btn-primary" onClick={flow.onDone}>
            Done
          </button>
          <button className="docmark-btn-secondary" onClick={flow.onToggleWorksCited}>
            {state.showWorksCited ? 'Hide Works Cited' : 'View Works Cited'}
          </button>
          <button className="docmark-btn-secondary" onClick={flow.onUndo} disabled={flow.undoing}>
            {flow.undoing ? 'Undoing…' : 'Undo'}
          </button>
        </div>
      </>
    )
  }

  const { candidates, selectedId, style, preview } = state

  if (candidates.length === 0) {
    return (
      <>
        <div className="docmark-head">
          <span className="docmark-dot" style={{ background: '#ffb800' }} />
          <span className="docmark-title">No sources found</span>
        </div>
        <p className="docmark-body">{emptyResultsBody(claimText)}</p>
        <div className="docmark-actions">
          <button className="docmark-btn-primary" onClick={flow.onSearchAgain}>
            Search again
          </button>
          <button className="docmark-btn-secondary" onClick={flow.onCancel}>
            Dismiss
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="docmark-head">
        <span className="docmark-dot" style={{ background: '#16a34a' }} />
        <span className="docmark-title">{resultsTitle(candidates.length)}</span>
        <span className="docmark-chip">{CITATION_STYLE_LABEL[style]}</span>
      </div>
      <p className="docmark-body">{resultsBody(claimText)}</p>
      <div className="docmark-rows">
        {candidates.map((candidate) => (
          <button
            type="button"
            key={candidate.sourceId}
            className={`docmark-row${candidate.sourceId === selectedId ? ' selected' : ''}`}
            onClick={() => flow.onSelect(candidate.sourceId)}
          >
            <span className="docmark-row-badge">{candidate.initials}</span>
            <span className="docmark-row-meta">
              <span className="docmark-row-title">{candidate.title}</span>
              {/* The venue is what gives and the match percentage is what does
                  not — see .docmark-venue / .docmark-match. Ellipsising the
                  line as a whole would cut the number the card is titled
                  around. */}
              <span className="docmark-row-sub">
                <span className="docmark-venue">
                  {candidate.venue ?? 'Unknown venue'}
                  {candidate.year ? ` · ${candidate.year}` : ''}
                </span>
                <span className="docmark-match">{candidate.matchPercent}% match</span>
              </span>
            </span>
            <span
              className={`docmark-radio${candidate.sourceId === selectedId ? ' on' : ''}`}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      {/* Every option at once, as the frame draws them — not one cycling
          button, which hid two thirds of the control behind a second click. */}
      <div className="docmark-styles">
        <span className="docmark-styles-label">Style</span>
        {CITATION_STYLES.map((option) => (
          <button
            type="button"
            key={option}
            className={`docmark-style-pill${option === style ? ' on' : ''}`}
            onClick={() => flow.onSetStyle(option)}
          >
            {CITATION_STYLE_LABEL[option]}
          </button>
        ))}
      </div>
      {preview ? (
        <div className="docmark-block">
          <div className="docmark-block-label">WILL BE INSERTED</div>
          <div className="docmark-block-marker">{preview.inTextCitation}</div>
          <div className="docmark-block-body">{preview.worksCitedEntry}</div>
        </div>
      ) : null}
      <div className="docmark-actions">
        <button
          className="docmark-btn-primary"
          onClick={flow.onInsert}
          disabled={flow.inserting || !selectedId}
        >
          {flow.inserting ? 'Inserting…' : 'Insert citation'}
        </button>
        <button
          className="docmark-btn-secondary"
          onClick={flow.onPreview}
          disabled={flow.previewing || !selectedId}
        >
          {flow.previewing ? 'Formatting…' : 'Preview'}
        </button>
      </div>
      {/* Full-width under the pair — the frame's own third row. Re-runs the
          four academic searches rather than filtering what came back. */}
      <button className="docmark-btn-secondary docmark-btn-wide" onClick={flow.onSearchAgain}>
        Search again
      </button>
    </>
  )
}

/** Figma's own tail path (node 288:545), stroked to meet the card's border. */
function Tail({ left, pointing, above }: { left: number; pointing: 'up' | 'down'; above: boolean }): JSX.Element {
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
        display: 'block',
        transform: pointing === 'down' ? 'scaleY(-1)' : undefined,
        ...(above ? { marginTop: -2 } : { marginBottom: -2 })
      }}
    >
      <path d="M11.5708 6.5H2.28562L6.9282 1.47363L11.5708 6.5Z" fill="white" stroke="black" strokeWidth="2" />
    </svg>
  )
}
