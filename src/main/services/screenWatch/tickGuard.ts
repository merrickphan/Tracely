/**
 * Whether a poll result that has come back from UI Automation may still be
 * drawn.
 *
 * A tick spawns PowerShell and awaits it, which takes hundreds of milliseconds.
 * Anything can happen in that window — the user can turn Screen Watch off from
 * Settings or the tray, or the tracked document can change — and the result
 * that eventually arrives describes a world that no longer exists.
 *
 * The bug this was written for: `stopScreenWatch` sets `enabled = false` and
 * clears the timer, but a tick already awaiting its snapshot carried on to
 * completion and called `showOverlay()`. Because `enabled` was false, the
 * `finally` did not reschedule — so nothing ever ran again to take those
 * underlines down. They stayed drawn over every application, at
 * screen-saver level, until Screen Watch was turned back on. "Turn the feature
 * off and it draws on your screen forever" is the worst possible shape for a
 * bug in an always-on-top click-through window.
 *
 * A leaf with tests, because the interesting part is a three-way condition
 * that is otherwise only reachable by racing a subprocess.
 */

export interface TickGuardInput {
  /** Whether Screen Watch is enabled RIGHT NOW, not when the tick started. */
  enabled: boolean
  /** `trackingGeneration` sampled before the await. */
  generationAtStart: number
  /** `trackingGeneration` as it stands now. */
  generationNow: number
}

export type TickDecision =
  /** Draw it. */
  | 'apply'
  /** Screen Watch was turned off mid-flight. Take the overlay DOWN — hiding is
   *  not enough on its own, because the payload the renderer holds would be
   *  re-shown by the next present. */
  | 'clear'
  /** The tracked document moved on. Another tick is already coming for the new
   *  one, so drop this result without touching what is drawn — clearing here
   *  would blink the underlines between two good frames. */
  | 'discard'

export function tickDecision({
  enabled,
  generationAtStart,
  generationNow
}: TickGuardInput): TickDecision {
  // Checked first and separately from the generation: disabling is the case
  // where something must actively come down, and it outranks staleness because
  // a stale result from a disabled watcher must not be drawn either.
  if (!enabled) return 'clear'
  if (generationAtStart !== generationNow) return 'discard'
  return 'apply'
}
