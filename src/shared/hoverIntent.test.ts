import { ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HOVER_CLOSE_DELAY_MS, createHoverCloser } from './hoverIntent.ts'

/** A fake clock, so the timing is asserted rather than waited for. */
function fakeClock() {
  let now = 0
  let next = 1
  const pending = new Map<number, { at: number; fn: () => void }>()
  return {
    schedule: (fn: () => void, ms: number): unknown => {
      const id = next++
      pending.set(id, { at: now + ms, fn })
      return id
    },
    unschedule: (h: unknown): void => {
      pending.delete(h as number)
    },
    advance: (ms: number): void => {
      now += ms
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id)
          t.fn()
        }
      }
    },
    pendingCount: () => pending.size
  }
}

describe('createHoverCloser', () => {
  it('closes after the delay when nothing cancels it', () => {
    const clock = fakeClock()
    const closer = createHoverCloser(clock.schedule, clock.unschedule, 140)
    let closed = false
    closer.arm(() => {
      closed = true
    })

    clock.advance(139)
    strictEqual(closed, false, 'must not close before the grace period is up')
    clock.advance(1)
    strictEqual(closed, true)
  })

  /** The bug this exists for: the pointer is over neither the mark nor the card
   *  while crossing the gap between them, and the card vanished on the first
   *  such frame — so it could never be reached. */
  it('does not close when the pointer reaches the card in time', () => {
    const clock = fakeClock()
    const closer = createHoverCloser(clock.schedule, clock.unschedule, 140)
    let closed = false
    closer.arm(() => {
      closed = true
    })

    clock.advance(60) // crossing the gap
    closer.cancel() // onMouseEnter on the card
    clock.advance(500)
    strictEqual(closed, false)
  })

  /**
   * Arming is idempotent. `mousemove` fires continuously while the pointer sits
   * in a dead zone; restarting the timer on each event would hold the card open
   * for as long as the pointer hovered nothing, which is the opposite failure.
   */
  it('does not restart the timer while a close is already pending', () => {
    const clock = fakeClock()
    const closer = createHoverCloser(clock.schedule, clock.unschedule, 140)
    let closed = false
    const close = () => {
      closed = true
    }

    closer.arm(close)
    clock.advance(100)
    closer.arm(close) // another mousemove over the gap
    closer.arm(close)
    strictEqual(clock.pendingCount(), 1, 'a second arm must not schedule a second timer')
    clock.advance(40)
    strictEqual(closed, true, 'the original deadline still applies')
  })

  it('reports whether a close is pending', () => {
    const clock = fakeClock()
    const closer = createHoverCloser(clock.schedule, clock.unschedule, 140)
    strictEqual(closer.armed(), false)
    closer.arm(() => {})
    strictEqual(closer.armed(), true)
    closer.cancel()
    strictEqual(closer.armed(), false)
  })

  it('flushes immediately for closes that are not a gap crossing', () => {
    const clock = fakeClock()
    const closer = createHoverCloser(clock.schedule, clock.unschedule, 140)
    let closed = false
    closer.arm(() => {
      closed = true
    })
    closer.flush(() => {
      closed = true
    })
    strictEqual(closed, true, 'flush does not wait')
    strictEqual(clock.pendingCount(), 0, 'flush cancels the pending close too')
  })

  it('cancelling twice is harmless', () => {
    const clock = fakeClock()
    const closer = createHoverCloser(clock.schedule, clock.unschedule, 140)
    closer.arm(() => {})
    closer.cancel()
    closer.cancel()
    strictEqual(clock.pendingCount(), 0)
  })
})

describe('HOVER_CLOSE_DELAY_MS', () => {
  it('is long enough to cross the gap and short enough not to linger', () => {
    // A deliberate 10px move takes roughly 30-60ms; past ~250ms the card
    // visibly outstays the pointer on a fast sweep across a paragraph.
    ok(HOVER_CLOSE_DELAY_MS >= 100, 'too short to cross the gap between mark and card')
    ok(HOVER_CLOSE_DELAY_MS <= 250, 'long enough to read as lag')
  })
})
