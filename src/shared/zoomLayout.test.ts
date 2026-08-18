import { ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clientToLayout, contentOffset, readZoom, safeZoom } from './zoomLayout.ts'

describe('safeZoom', () => {
  it('passes a real zoom through', () => {
    strictEqual(safeZoom(1.3), 1.3)
    strictEqual(safeZoom(0.7), 0.7)
  })

  // A mark positioned at NaN or Infinity is not drawn at all. Falling back to
  // 1 leaves it merely mis-scaled, which is strictly better.
  it('falls back to 1 for anything that could not scale', () => {
    for (const bad of [0, -1, NaN, Infinity, null, undefined]) {
      strictEqual(safeZoom(bad as number), 1, `zoom ${String(bad)} should fall back`)
    }
  })
})

describe('contentOffset', () => {
  /**
   * The measurement this is built from, taken in the preview harness at zoom
   * 1.3: a mark sitting 150 layout px below its scroll container's top, with
   * the container scrolled 150, reports a client delta of 195.
   */
  it('recovers the layout offset from a post-zoom delta', () => {
    strictEqual(contentOffset(195, 150, 1.3), 300)
  })

  it('is identity at zoom 1', () => {
    strictEqual(contentOffset(195, 150, 1), 345)
    strictEqual(contentOffset(40, 0, 1), 40)
  })

  /**
   * The ordering bug this signature exists to prevent.
   *
   * Dividing after adding the scroll offset scales the scroll term too, so an
   * unscrolled document looks correct and a scrolled one is wrong by an amount
   * that changes as the user scrolls — the hardest version of this to notice.
   */
  it('divides the delta but never the scroll offset', () => {
    const divideAfter = (d: number, s: number, z: number): number => (d + s) / z
    strictEqual(contentOffset(260, 100, 1.3), 300)
    ok(Math.abs(divideAfter(260, 100, 1.3) - 300) > 1, 'the wrong order should not agree')
  })

  it('handles zoom below 1', () => {
    // A shrunk window: the client delta is smaller than the layout distance.
    strictEqual(contentOffset(75, 0, 0.75), 100)
  })
})

describe('clientToLayout', () => {
  it('converts a measured width', () => {
    strictEqual(Math.round(clientToLayout(898, 1.3)), 691)
  })

  it('is identity at zoom 1', () => {
    strictEqual(clientToLayout(320, 1), 320)
  })
})

describe('readZoom', () => {
  const view = (zoom: string | undefined) => ({ getComputedStyle: () => ({ zoom }) })
  const root = {}

  it('parses a numeric zoom', () => {
    strictEqual(readZoom(view('1.3'), root), 1.3)
  })

  it('treats a missing or non-numeric zoom as 1', () => {
    strictEqual(readZoom(view(undefined), root), 1)
    strictEqual(readZoom(view('normal'), root), 1)
    strictEqual(readZoom(view(''), root), 1)
  })

  it('treats a missing view or root as 1', () => {
    strictEqual(readZoom(null, root), 1)
    strictEqual(readZoom(view('1.3'), null), 1)
  })
})
