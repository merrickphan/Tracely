/**
 * When may the Screen Watch overlay take the mouse away from the app underneath?
 *
 * The overlay covers the whole focused window and is click-through by default
 * (`setIgnoreMouseEvents(true, { forward: true })`). Turning that off does not
 * make one element interactive — it makes the ENTIRE overlay solid to the
 * mouse, across everything it covers.
 *
 * That was being done on underline hover, and the consequence is the bug this
 * file exists to prevent: putting the cursor on a flagged sentence in Word or
 * Chrome turned the overlay solid within one 80ms poll, so the click never
 * reached the document and the caret could not be placed. The flagged sentence
 * is exactly the text a writer is trying to edit — they were told it has a
 * problem — so the feature made its own subject uneditable, and the only way
 * out was to turn Screen Watch off.
 *
 * The underline never needed capture. Hover is detected by polling the OS
 * cursor position from the main process precisely BECAUSE a click-through
 * window receives no mouse events (see hoverTracking.ts), so the popover opens
 * whether or not the overlay is solid. What genuinely needs the mouse is the
 * part with controls: the popover card, and the widget.
 *
 * A leaf so `npm test` can load it. The decision is three booleans and the cost
 * of getting it wrong is silent — a writer who cannot click their own document
 * has no way to tell it is Tracely doing it.
 */

export interface CaptureInput {
  /**
   * A widget drag is in flight. The cursor ranges over the whole screen during
   * one, far outside any hit rect, so capture is forced for its duration or the
   * rest of the drag is dropped.
   */
  dragActive: boolean
  /**
   * What the cursor is currently on, if anything. 'claim' is an underline —
   * decoration over someone else's document, and the case that must stay
   * click-through.
   */
  hovering: 'claim' | 'widget' | null
  /** The cursor is inside the open popover's real rendered rect. */
  inPopover: boolean
}

export function shouldCaptureMouse({ dragActive, hovering, inPopover }: CaptureInput): boolean {
  if (dragActive) return true
  // The card has buttons — Find a source, Dismiss, the whole citation flow —
  // and they are unreachable without this.
  if (inPopover) return true
  // The launcher circle and the expanded panel are Tracely's own UI, drawn over
  // the app rather than over its text, and clicking them is the point of them.
  return hovering === 'widget'
}
