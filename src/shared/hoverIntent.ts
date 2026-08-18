/**
 * Why a hover popover does not close the instant the pointer leaves the mark.
 *
 * The card is drawn a short gap away from the text it is about — `POPOVER_GAP`,
 * plus the tail. Crossing that gap means the pointer is, for a few frames, over
 * neither the mark nor the card. Closing on the first such frame makes the card
 * impossible to reach: it vanishes exactly as the user moves toward it, which
 * is the single most common way a hover UI is unusable, and it looks like the
 * feature is broken rather than like a timing choice.
 *
 * The fix is a grace period, not a bigger hit area. Widening the mark's hit
 * region would make it swallow neighbouring text, and bridging the gap with an
 * invisible element only works for one of the four placements the card takes
 * (above, below, and shifted left or right to stay inside the editor).
 *
 * Kept here rather than as a magic number inside the view because it is a
 * decision with a wrong answer on both sides, and because both surfaces that
 * draw a hover card — the claim popover and the prose card — have to agree. A
 * card that lingers when the pointer has genuinely gone elsewhere is its own
 * bug: it covers the very text the writer moved on to read.
 */

/**
 * How long the pointer may be over neither the mark nor the card before the
 * card closes.
 *
 * 140ms. A deliberate 10px move takes roughly 30–60ms at ordinary pointer
 * speeds, so this clears the gap with room to spare; past about 250ms the card
 * starts visibly outstaying the pointer on a fast sweep across a paragraph of
 * marks, which reads as lag.
 */
export const HOVER_CLOSE_DELAY_MS = 140

/**
 * A pending close that can be cancelled — the whole mechanism, in a shape both
 * surfaces can hold in a ref.
 *
 * `arm` is idempotent: arming an already-armed close does NOT restart the
 * timer. That matters because `mousemove` fires continuously while the pointer
 * sits in the gap, and restarting on each event would hold the card open for as
 * long as the pointer hovered a dead zone — which is precisely the lingering
 * failure this is bounded to avoid.
 */
export interface HoverCloser {
  /** Schedule the close, unless one is already scheduled. */
  arm: (close: () => void) => void
  /** The pointer reached the card, or another mark. Nothing closes. */
  cancel: () => void
  /** Close now, without waiting — for cases that are not a gap crossing, like
   *  the flow being dismissed or the document being closed. */
  flush: (close: () => void) => void
  /** Whether a close is currently pending. */
  armed: () => boolean
}

export function createHoverCloser(
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
  unschedule: (handle: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  delayMs: number = HOVER_CLOSE_DELAY_MS
): HoverCloser {
  let handle: unknown = null

  const cancel = (): void => {
    if (handle === null) return
    unschedule(handle)
    handle = null
  }

  return {
    arm(close) {
      if (handle !== null) return
      handle = schedule(() => {
        handle = null
        close()
      }, delayMs)
    },
    cancel,
    flush(close) {
      cancel()
      close()
    },
    armed: () => handle !== null
  }
}
