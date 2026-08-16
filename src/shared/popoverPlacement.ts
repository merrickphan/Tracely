/**
 * Which side of a flagged sentence the document editor's popover opens on.
 *
 * A leaf, and tested, because this decision had a wrong answer available and
 * took it for months. The condition read
 *
 *   below + height > rect.top + rect.height + 400
 *
 * with `below = rect.top + rect.height + gap`, so `rect.top + rect.height`
 * appeared on both sides and the whole thing reduced to `height > 390`. The
 * card flipped on nothing but its own height: a tall one over a sentence in the
 * first line was drawn at a negative offset, off the top of the editor, and a
 * short one over the last line never flipped and hung off the bottom. It read
 * like a considered rule and was arithmetic that cancelled.
 *
 * Everything here is in the scroll container's CONTENT coordinate space — the
 * space the marks are measured in and the popover is positioned in — so the
 * visible box is `[scrollTop, scrollTop + viewportHeight)` rather than
 * `[0, viewportHeight)`.
 */

export interface PopoverPlacementInput {
  /** Top of the line the popover points at, in content space. */
  markTop: number
  markHeight: number
  /** Measured card height. 0 before the first measuring pass. */
  cardHeight: number
  /** Gap between the line and the card. */
  gap: number
  /** Visible height of the scroll container, and how far it is scrolled. */
  viewportHeight: number
  scrollTop: number
}

export interface PopoverPlacement {
  above: boolean
  top: number
}

export function placePopover({
  markTop,
  markHeight,
  cardHeight,
  gap,
  viewportHeight,
  scrollTop
}: PopoverPlacementInput): PopoverPlacement {
  const below = markTop + markHeight + gap
  const spaceBelow = scrollTop + viewportHeight - below
  const spaceAbove = markTop - gap - scrollTop

  // Room above is required, not just a shortage below. A card too tall for
  // either side stays below, where it clips at the bottom of the viewport —
  // flipping it would put it above the top of the document, where no amount of
  // scrolling brings it back.
  //
  // cardHeight 0 is the pre-measure paint, and reads as "it fits": below is the
  // default, and the measured pass moves it only if it actually does not.
  const above = cardHeight > 0 && cardHeight > spaceBelow && cardHeight <= spaceAbove
  return { above, top: above ? markTop - gap - cardHeight : below }
}
