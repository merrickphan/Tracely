import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FRAME_FALLBACK_MS, scheduleFrame, type FrameSchedulerHost } from './frameScheduler.ts'

/**
 * A host with both clocks driven by hand, so "which timer fired" is a property
 * of the test rather than of how fast the machine running it happens to be.
 * `frames`/`timers` are left as null after firing so a double-fire would be a
 * visible extra call rather than a silent one.
 */
function makeHost(): FrameSchedulerHost & {
  runFrame(): void
  runTimer(): void
  pendingFrames: number
  pendingTimers: number
  lastDelay: number
} {
  const frames = new Map<number, () => void>()
  const timers = new Map<number, () => void>()
  let nextId = 1
  let lastDelay = -1
  return {
    requestAnimationFrame(cb) {
      const id = nextId++
      frames.set(id, cb)
      return id
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle)
    },
    setTimeout(cb, ms) {
      const id = nextId++
      lastDelay = ms
      timers.set(id, cb)
      return id
    },
    clearTimeout(handle) {
      timers.delete(handle)
    },
    runFrame() {
      for (const [id, cb] of [...frames]) {
        frames.delete(id)
        cb()
      }
    },
    runTimer() {
      for (const [id, cb] of [...timers]) {
        timers.delete(id)
        cb()
      }
    },
    get pendingFrames() {
      return frames.size
    },
    get pendingTimers() {
      return timers.size
    },
    get lastDelay() {
      return lastDelay
    }
  }
}

describe('scheduleFrame', () => {
  it('runs the work on the frame when the page is compositing', () => {
    const host = makeHost()
    let runs = 0
    scheduleFrame(host, () => runs++)
    strictEqual(runs, 0, 'must not run synchronously — that is what batches a tick')
    host.runFrame()
    strictEqual(runs, 1)
  })

  // The whole point of the module. A hidden or occluded page never runs a rAF
  // callback, which left the editor's marks unmeasured and its hover popover
  // unreachable in the preview harness.
  it('runs the work from the fallback timer when no frame ever comes', () => {
    const host = makeHost()
    let runs = 0
    scheduleFrame(host, () => runs++)
    host.runTimer()
    strictEqual(runs, 1)
  })

  it('runs the work exactly once when the frame fires first', () => {
    const host = makeHost()
    let runs = 0
    scheduleFrame(host, () => runs++)
    host.runFrame()
    host.runTimer()
    strictEqual(runs, 1, 'the losing timer must be cleared, not left armed')
    strictEqual(host.pendingTimers, 0)
  })

  it('runs the work exactly once when the timer fires first', () => {
    const host = makeHost()
    let runs = 0
    scheduleFrame(host, () => runs++)
    host.runTimer()
    host.runFrame()
    strictEqual(runs, 1)
    strictEqual(host.pendingFrames, 0)
  })

  it('cancel stops both clocks', () => {
    const host = makeHost()
    let runs = 0
    const cancel = scheduleFrame(host, () => runs++)
    cancel()
    strictEqual(host.pendingFrames, 0)
    strictEqual(host.pendingTimers, 0)
    host.runFrame()
    host.runTimer()
    strictEqual(runs, 0)
  })

  // React effect cleanups run whether or not the scheduled work already
  // happened, so cancel-after-run has to be a no-op rather than a throw.
  it('cancel after the work has already run is a no-op', () => {
    const host = makeHost()
    let runs = 0
    const cancel = scheduleFrame(host, () => runs++)
    host.runFrame()
    cancel()
    cancel()
    strictEqual(runs, 1)
  })

  // A slow frame must not beat the fallback and split a batch into two forced
  // layouts, so the default has to sit clear of a 30Hz frame (33.3ms).
  it('defaults the fallback clear of a slow frame', () => {
    const host = makeHost()
    scheduleFrame(host, () => {})
    strictEqual(host.lastDelay, FRAME_FALLBACK_MS)
    strictEqual(FRAME_FALLBACK_MS > 34, true)
  })
})
