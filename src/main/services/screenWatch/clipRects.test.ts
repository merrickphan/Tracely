import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'

import { clipUnderline, intersectRect, isUsableClip, resolveClip } from './clipRects.ts'

const R = (x: number, y: number, width: number, height: number): {
  x: number
  y: number
  width: number
  height: number
} => ({ x, y, width, height })

describe('intersectRect', () => {
  it('returns the overlap', () => {
    deepStrictEqual(intersectRect(R(0, 0, 100, 100), R(50, 50, 100, 100)), R(50, 50, 50, 50))
  })

  it('returns null when disjoint', () => {
    strictEqual(intersectRect(R(0, 0, 10, 10), R(20, 20, 10, 10)), null)
  })

  it('returns null when merely touching', () => {
    // A zero-area overlap is not an overlap.
    strictEqual(intersectRect(R(0, 0, 10, 10), R(10, 0, 10, 10)), null)
  })

  it('returns the inner rect when fully contained', () => {
    deepStrictEqual(intersectRect(R(20, 20, 10, 10), R(0, 0, 100, 100)), R(20, 20, 10, 10))
  })
})

describe('isUsableClip', () => {
  it('rejects null and undefined', () => {
    strictEqual(isUsableClip(null), false)
    strictEqual(isUsableClip(undefined), false)
  })

  it('rejects zero extent', () => {
    strictEqual(isUsableClip(R(0, 0, 0, 10)), false)
  })

  it('rejects Infinity', () => {
    // System.Windows.Rect.Empty has X = Double.PositiveInfinity, and it can
    // reach here through the PowerShell bridge.
    strictEqual(isUsableClip(R(Infinity, 0, 10, 10)), false)
    strictEqual(isUsableClip(R(0, 0, Infinity, 10)), false)
  })

  it('rejects NaN', () => {
    strictEqual(isUsableClip(R(NaN, 0, 10, 10)), false)
  })

  it('accepts a normal rect', () => {
    strictEqual(isUsableClip(R(0, 0, 10, 10)), true)
  })
})

describe('clipUnderline', () => {
  it('passes a fully visible rect through unchanged', () => {
    deepStrictEqual(clipUnderline(R(30, 30, 100, 18), R(0, 0, 800, 600)), R(30, 30, 100, 18))
  })

  it('trims a rect that runs past the right edge', () => {
    deepStrictEqual(clipUnderline(R(700, 30, 200, 18), R(0, 0, 800, 600)), R(700, 30, 100, 18))
  })

  it('trims a rect that starts left of the clip', () => {
    deepStrictEqual(clipUnderline(R(-50, 30, 200, 18), R(0, 0, 800, 600)), R(0, 30, 150, 18))
  })

  it('drops a rect entirely outside the clip', () => {
    // The toolbar case: text scrolled above the editable control still reports
    // a valid rect, and used to be drawn on top of the app's own chrome.
    strictEqual(clipUnderline(R(30, -100, 100, 18), R(0, 0, 800, 600)), null)
  })

  it('drops a rect only slightly overlapping vertically', () => {
    // Spans y 90..108 against a clip starting at 100, so 8 of 18px are visible
    // = 44%, under the 60% floor. Squashing it would put the rule through the
    // middle of the glyphs instead of under them.
    strictEqual(clipUnderline(R(30, 90, 100, 18), R(0, 100, 800, 500)), null)
  })

  it('keeps a rect just above the visibility floor', () => {
    // Spans y 96..114, so 14 of 18px = 78%. Pins which side of the floor the
    // two cases above sit on.
    deepStrictEqual(clipUnderline(R(30, 96, 100, 18), R(0, 100, 800, 500)), R(30, 100, 100, 14))
  })

  it('keeps a rect that is mostly visible vertically', () => {
    // 16 of 18px = 89%.
    deepStrictEqual(clipUnderline(R(30, 98, 100, 18), R(0, 100, 800, 500)), R(30, 100, 100, 16))
  })

  it('drops a sub-pixel sliver', () => {
    strictEqual(clipUnderline(R(799.5, 30, 100, 18), R(0, 0, 800, 600)), null)
  })
})

describe('resolveClip', () => {
  it('intersects several candidates', () => {
    deepStrictEqual(
      resolveClip([R(0, 0, 800, 600), R(0, 100, 800, 400)]),
      R(0, 100, 800, 400)
    )
  })

  it('ignores unusable candidates rather than failing', () => {
    // A missing controlRect must fall back to the window rect, not to nothing.
    deepStrictEqual(resolveClip([null, R(0, 0, 800, 600)]), R(0, 0, 800, 600))
    deepStrictEqual(resolveClip([R(Infinity, 0, 1, 1), R(0, 0, 800, 600)]), R(0, 0, 800, 600))
  })

  it('returns null when nothing is usable, meaning draw unclipped', () => {
    // Never let a degenerate clip erase every underline: that failure is
    // indistinguishable from "UIA found nothing", so it would never be found.
    strictEqual(resolveClip([null, undefined]), null)
  })

  it('returns null when candidates do not overlap at all', () => {
    strictEqual(resolveClip([R(0, 0, 10, 10), R(500, 500, 10, 10)]), null)
  })
})
