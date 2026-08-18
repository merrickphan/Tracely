import { strictEqual, ok } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampWindowScale,
  LAYOUT_HEIGHT,
  LAYOUT_WIDTH,
  MAX_COMFORTABLE_SCALE,
  MAX_WINDOW_SCALE,
  clampDragScale,
  fitToWorkAreaScale,
  maximizedScale,
  MIN_WINDOW_SCALE,
  sizeForScale,
  zoomForWindowWidth
} from './windowSize.ts'

describe('maximizedScale', () => {
  /**
   * Maximize fills the display now, and no longer stops at a taste threshold.
   * It used to cap at MAX_COMFORTABLE_SCALE, which on a 2560x1392 work area
   * held it to 1.6 where the screen allowed 2.12 — the button used 75% of the
   * height available and read as barely working. See the note on that constant.
   */
  it('uses the whole display rather than a comfort cap', () => {
    strictEqual(maximizedScale({ width: 2560, height: 1392 }), fitToWorkAreaScale({ width: 2560, height: 1392 }))
  })

  it('still stops at MAX_WINDOW_SCALE on an enormous display', () => {
    // A 4K screen has room for ~4.9x. The hard ceiling is still a ceiling —
    // what was dropped is the *taste* cap below it, not the bound.
    strictEqual(maximizedScale({ width: 3840, height: 2160 }), MAX_WINDOW_SCALE)
  })

  it('fits the work area when the screen is the binding constraint', () => {
    const scale = maximizedScale({ width: 1366, height: 768 })
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

describe('clampDragScale — a drag can never grow past the display', () => {
  /**
   * The bug this exists for. The aspect ratio is locked, so a size taken from
   * the drag's WIDTH alone can be far taller than the screen: at
   * MAX_WINDOW_SCALE on this work area the window is 2245x1585, and 193px of
   * the app — the footer of every view, the lower half of any open popover —
   * is below the bottom edge of the monitor. Reported as "the overlay cuts out
   * when you resize the app too big"; nothing was mis-rendered, it was drawn
   * off-screen.
   */
  it('holds a 2.5x drag inside a 2560x1392 work area', () => {
    const workArea = { width: 2560, height: 1392 }
    const scale = clampDragScale(MAX_WINDOW_SCALE, workArea)
    const { width, height } = sizeForScale(scale)
    ok(height <= workArea.height, `window is ${height}px tall in a ${workArea.height}px work area`)
    ok(width <= workArea.width, `window is ${width}px wide in a ${workArea.width}px work area`)
  })

  it('binds on HEIGHT for an ordinary widescreen display', () => {
    // The case width-only clamping gets wrong every time: there is plenty of
    // width left and none of height.
    const workArea = { width: 1920, height: 1040 }
    const scale = clampDragScale(MAX_WINDOW_SCALE, workArea)
    strictEqual(scale, fitToWorkAreaScale(workArea))
    ok(sizeForScale(scale).height <= workArea.height)
  })

  it('leaves a drag that already fits completely alone', () => {
    // The clamp must not be a resize of its own — dragging to 1.2 on a big
    // display has to land on 1.2.
    strictEqual(clampDragScale(1.2, { width: 2560, height: 1392 }), 1.2)
  })

  it('still refuses to go past MAX_WINDOW_SCALE on an enormous display', () => {
    strictEqual(clampDragScale(99, { width: 7680, height: 4320 }), MAX_WINDOW_SCALE)
  })

  it('still refuses to go below the readable floor', () => {
    strictEqual(clampDragScale(0.1, { width: 2560, height: 1392 }), MIN_WINDOW_SCALE)
  })

  /**
   * The floor wins over the fit. On a display too small to hold even
   * MIN_WINDOW_SCALE something must overflow, and overflowing the screen edge
   * is recoverable — the window can be moved — while shrinking below 0.7 makes
   * the 11px labels in Settings unreadable, which is not.
   */
  it('prefers overflowing a tiny display to shrinking below the floor', () => {
    strictEqual(clampDragScale(1, { width: 320, height: 240 }), MIN_WINDOW_SCALE)
  })

  it('keeps the grips off the screen edge', () => {
    const workArea = { width: 1920, height: 1040 }
    const { height } = sizeForScale(clampDragScale(MAX_WINDOW_SCALE, workArea))
    ok(workArea.height - height >= 40, `only ${workArea.height - height}px of margin left for the grips`)
  })
})

describe('maximizedScale still caps at what is comfortable', () => {
  it('is never larger than a drag would be allowed to reach', () => {
    for (const workArea of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1040 },
      { width: 2560, height: 1392 },
      { width: 3840, height: 2160 }
    ]) {
      ok(
        maximizedScale(workArea) <= clampDragScale(MAX_WINDOW_SCALE, workArea) + 1e-9,
        `maximize exceeds the drag ceiling on ${workArea.width}x${workArea.height}`
      )
    }
  })
})
