import { useLayoutEffect, useRef, useState } from 'react'
import { placePopover } from '@shared/popoverPlacement'
import type { DocumentMark, MarkRect } from './documentMarks'
import MarkdownText from './MarkdownText'
import { PROBLEM_COLOR, PROBLEM_LABEL, isReasoningProblem, popoverCopyFor } from './problemCopy'

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

const POPOVER_WIDTH = 320
const POPOVER_GAP = 10
const TAIL_WIDTH = 16
const TAIL_HEIGHT = 10

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
  onFindSource,
  onSuggestFix,
  onDismiss,
  onPopoverEnter,
  onPopoverLeave
}: DocumentMarkLayerProps): JSX.Element {
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
  onFindSource: () => void
  onSuggestFix: () => void
  onDismiss: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    setHeight(cardRef.current?.offsetHeight ?? 0)
  }, [mark.claim.id])

  const kind = mark.problemKinds[0]

  // Centred on the line it points at, then pulled back inside the editor. The
  // tail stays on the sentence when the card moves, which is the whole reason
  // it is offset separately rather than pinned to the card's centre.
  const idealLeft = rect.left + rect.width / 2 - POPOVER_WIDTH / 2
  const left = Math.max(8, Math.min(idealLeft, wrapWidth - POPOVER_WIDTH - 8))
  const tailLeft = Math.max(12, Math.min(rect.left + rect.width / 2 - left - TAIL_WIDTH / 2, POPOVER_WIDTH - 28))

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

  // No 'searching' variant here, unlike the overlay's card. A mark is only ever
  // drawn for a claim whose search has resolved — see measureMarks — so there is
  // no spinner state to render, and adding one would be a state the editor
  // cannot actually reach.
  const { title, description, action } = popoverCopyFor(
    { claimType: mark.claim.claimType, hasInlineCitation: mark.hasInlineCitation, critique: mark.claim.critique },
    mark.evidence,
    kind
  )
  const remaining = mark.problemKinds.length

  return (
    <div
      className="docmark-popover"
      style={{ left, top, width: POPOVER_WIDTH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {!wantsAbove ? <Tail left={tailLeft} pointing="up" above={false} /> : null}
      <div ref={cardRef} className="docmark-card">
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
      </div>
      {wantsAbove ? <Tail left={tailLeft} pointing="down" above /> : null}
    </div>
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
