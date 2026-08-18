import { strictEqual, ok } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampWindowScale,
  LAYOUT_HEIGHT,
  LAYOUT_WIDTH,
  MAX_COMFORTABLE_SCALE,
  MAX_WINDOW_SCALE,
  maximizedScale,
  MIN_WINDOW_SCALE,
  sizeForScale,
  zoomForWindowWidth
} from './windowSize.ts'

describe('maximizedScale', () => {
  // The whole point of the cap. A 4K display has room for 4.9x; letting it
  // have that would render 28px body text.
  it('stops at the comfortable cap on a large display', () => {
    strictEqual(maximizedScale({ width: 3840, height: 2160 }), MAX_COMFORTABLE_SCALE)
  })

  it('fits the work area when the screen is the binding constraint', () => {
    const scale = maximizedScale({ width: 1366, height: 768 })
    ok(scale < MAX_COMFORTABLE_SCALE, `expected the screen to bind, got ${scale}`)
    const { width, height } = sizeForScale(scale)
    ok(width <= 1366 && height <= 768, `maximized to ${width}x${height}, larger than the work area`)
  })

  // Height binds on a wide, short screen — taking the min of the two is what
  // stops the window running off the bottom.
  it('takes whichever dimension binds first', () => {
    const wide = maximizedScale({ width: 3440, height: 900 })
    const { height } = sizeForScale(wide)
    ok(height <= 900, `maximized to ${height}px tall on a 900px work area`)
  })

  it('leaves a margin, so the resize grips stay grabbable', () => {
    const { width } = sizeForScale(maximizedScale({ width: 1200, height: 2000 }))
    ok(width < 1200, 'maximized flush to the work area edge')
  })

  it('never goes below the minimum, even on a tiny work area', () => {
    strictEqual(maximizedScale({ width: 320, height: 240 }), MIN_WINDOW_SCALE)
  })
})

describe('clampWindowScale', () => {
  it('holds the range', () => {
    strictEqual(clampWindowScale(0.1), MIN_WINDOW_SCALE)
    strictEqual(clampWindowScale(99), MAX_WINDOW_SCALE)
    strictEqual(clampWindowScale(1), 1)
  })

  it('falls back to 1 for a value that is not a scale', () => {
    strictEqual(clampWindowScale(Number.NaN), 1)
    strictEqual(clampWindowScale(0), 1)
    strictEqual(clampWindowScale(-2), 1)
  })
})

describe('zoomForWindowWidth', () => {
  // The invariant the resizable window rests on: layout box stays LAYOUT_WIDTH
  // design units at every pixel size.
  it('is the identity at the design width', () => {
    strictEqual(zoomForWindowWidth(LAYOUT_WIDTH), 1)
  })

  it('divides back to the layout width at any scale', () => {
    for (const scale of [0.7, 1.4, 2.5]) {
      const { width } = sizeForScale(scale)
      const designUnits = width / zoomForWindowWidth(width)
      ok(Math.abs(designUnits - LAYOUT_WIDTH) < 1, `scale ${scale} gave ${designUnits} design units`)
    }
  })

  it('refuses to divide by a width that is not one', () => {
    strictEqual(zoomForWindowWidth(0), 1)
    strictEqual(zoomForWindowWidth(Number.NaN), 1)
  })
})

describe('sizeForScale', () => {
  it('keeps the layout aspect at every scale', () => {
    const expected = LAYOUT_WIDTH / LAYOUT_HEIGHT
    for (const scale of [MIN_WINDOW_SCALE, 1, MAX_WINDOW_SCALE]) {
      const { width, height } = sizeForScale(scale)
      ok(Math.abs(width / height - expected) < 0.01, `scale ${scale} drifted to ${width / height}`)
    }
  })
})
