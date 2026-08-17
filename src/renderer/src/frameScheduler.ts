/**
 * "Run this once, just before the next paint — and run it even if there is no
 * next paint."
 *
 * A bare `requestAnimationFrame` is the right primitive for batching work that
 * forces layout: several callers in one tick collapse into one run, and the run
 * lands before the frame is painted, so nothing is drawn in a stale position.
 * Its failure mode is that Chromium *freezes* rAF entirely when the page is not
 * compositing — a hidden document, a fully occluded window, a browser pane that
 * is not being displayed. The callback then never fires at all.
 *
 * That is not hypothetical. The document editor measures its underline marks
 * this way, and in the `preview:ui` harness driven headlessly the frame never
 * came: `marks` stayed empty, no underline was ever drawn, and the hover
 * popover that opens on one was unreachable. The standing workaround was "reach
 * that card with `npm run dev` instead" — a whole surface the harness could not
 * test.
 *
 * So both timers are armed and the first to fire wins:
 *
 * - Compositing: the rAF fires in ~16ms, well inside `fallbackMs`, and the
 *   behaviour is exactly the old rAF batching, paint alignment included.
 * - Not compositing: the rAF never fires, the timer does, and the work still
 *   happens — a frame late by the clock, but there is no frame to be late for.
 *
 * The fallback is a plain timer rather than a `document.visibilityState`
 * branch on purpose. Visibility is only one of the ways a page stops
 * compositing (occlusion does not change it), and branching on it would make
 * the hidden path a *different* code path from the one that ships — which is
 * the thing this fix exists to avoid.
 *
 * The host is injected rather than reaching for `window` so this stays a leaf
 * module with no relative value imports, which is what `npm test` (Node type
 * stripping, whose ESM resolver rejects extensionless relative imports) can
 * actually load.
 */
export interface FrameSchedulerHost {
  requestAnimationFrame(callback: () => void): number
  cancelAnimationFrame(handle: number): void
  setTimeout(callback: () => void, ms: number): number
  clearTimeout(handle: number): void
}

/**
 * Comfortably longer than a 60Hz frame (16.7ms) and than a 30Hz one, so a
 * merely slow frame never beats the rAF and splits a batch; short enough that a
 * non-compositing page still measures within one imperceptible beat.
 */
export const FRAME_FALLBACK_MS = 50

/**
 * Runs `work` once, at the next frame or after `fallbackMs`, whichever comes
 * first. Returns a cancel function that is safe to call at any time — including
 * after the work has already run, since a React effect cleanup does not know
 * which happened.
 */
export function scheduleFrame(
  host: FrameSchedulerHost,
  work: () => void,
  fallbackMs: number = FRAME_FALLBACK_MS
): () => void {
  let settled = false
  let frame = 0
  let timer = 0

  // Both handles are released on either path. Leaving the loser armed would run
  // `work` a second time once the page resumed compositing — for the mark
  // measurement that is a second forced layout per keystroke, the exact cost the
  // batching exists to avoid.
  const cancel = (): void => {
    if (settled) return
    settled = true
    host.cancelAnimationFrame(frame)
    host.clearTimeout(timer)
  }

  const run = (): void => {
    if (settled) return
    cancel()
    work()
  }

  frame = host.requestAnimationFrame(run)
  timer = host.setTimeout(run, fallbackMs)
  return cancel
}
