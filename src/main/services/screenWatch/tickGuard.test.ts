import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tickDecision } from './tickGuard.ts'

describe('tickDecision', () => {
  it('applies a fresh result from an enabled watcher', () => {
    strictEqual(tickDecision({ enabled: true, generationAtStart: 4, generationNow: 4 }), 'apply')
  })

  /**
   * The bug. `stopScreenWatch` sets enabled = false and clears the timer, but a
   * tick already awaiting PowerShell ran to completion and re-showed the
   * overlay. Nothing rescheduled after it, so those underlines stayed drawn
   * over every application until the feature was switched back on.
   */
  it('clears when Screen Watch was turned off mid-flight', () => {
    strictEqual(tickDecision({ enabled: false, generationAtStart: 4, generationNow: 4 }), 'clear')
  })

  // Clearing, not discarding. A disabled watcher must take down what is
  // already on screen; discarding would leave the last frame drawn forever,
  // which is the bug rather than the fix.
  it('clears rather than discards when disabled AND stale', () => {
    strictEqual(tickDecision({ enabled: false, generationAtStart: 4, generationNow: 9 }), 'clear')
  })

  /**
   * Discard, never clear. Another tick is already on its way for the new
   * document, so taking the overlay down here would blink it off and back
   * between two good frames — the artifact `useStableUnderlines` exists to
   * suppress.
   */
  it('discards a result whose document has moved on', () => {
    strictEqual(tickDecision({ enabled: true, generationAtStart: 4, generationNow: 5 }), 'discard')
  })

  it('treats any generation change as stale, in either direction', () => {
    strictEqual(tickDecision({ enabled: true, generationAtStart: 9, generationNow: 4 }), 'discard')
    strictEqual(tickDecision({ enabled: true, generationAtStart: 0, generationNow: 1 }), 'discard')
  })
})
