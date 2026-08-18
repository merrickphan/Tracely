import { ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BAND_ALPHA,
  JUMP_X,
  JUMP_Y,
  LINE_HEIGHT,
  LINE_HEIGHT_HOVERED,
  bandBackground,
  hasJumped,
  withAlpha
} from './markMotion.ts'

describe('hasJumped', () => {
  it('treats the first render as a jump', () => {
    // A mark must appear where it belongs rather than sliding in from 0,0.
    ok(hasJumped(null, { x: 100, y: 200 }))
  })

  it('glides for reflow-sized movement', () => {
    // Typing a word ahead of the mark pushes it a few pixels along the line.
    ok(!hasJumped({ x: 100, y: 200 }, { x: 118, y: 200 }))
    ok(!hasJumped({ x: 100, y: 200 }, { x: 100, y: 214 }))
  })

  it('cuts for scroll-sized movement', () => {
    // The failure this exists to stop: a scrolled rect animating hundreds of
    // pixels sends the underline across unrelated text on the way.
    ok(hasJumped({ x: 100, y: 200 }, { x: 100, y: 640 }))
    ok(hasJumped({ x: 100, y: 200 }, { x: 700, y: 200 }))
  })

  it('is exclusive at the threshold', () => {
    ok(!hasJumped({ x: 0, y: 0 }, { x: JUMP_X, y: JUMP_Y }))
    ok(hasJumped({ x: 0, y: 0 }, { x: JUMP_X + 1, y: 0 }))
    ok(hasJumped({ x: 0, y: 0 }, { x: 0, y: JUMP_Y + 1 }))
  })

  it('is symmetric in direction', () => {
    strictEqual(
      hasJumped({ x: 0, y: 0 }, { x: 200, y: 0 }),
      hasJumped({ x: 200, y: 0 }, { x: 0, y: 0 })
    )
  })
})

describe('withAlpha', () => {
  it('converts a hex colour to rgba', () => {
    strictEqual(withAlpha('#ff5900', 0.3), 'rgba(255, 89, 0, 0.3)')
    strictEqual(withAlpha('#000000', 1), 'rgba(0, 0, 0, 1)')
    strictEqual(withAlpha('#ffffff', 0), 'rgba(255, 255, 255, 0)')
  })

  it('keeps a low channel from bleeding into the next', () => {
    // A shift-and-mask bug here shows up only on colours with a zero byte.
    strictEqual(withAlpha('#0a0b0c', 0.5), 'rgba(10, 11, 12, 0.5)')
  })
})

describe('bandBackground', () => {
  it('is invisible at rest and translucent when hovered', () => {
    strictEqual(bandBackground('#ff5900', false), 'rgba(255, 89, 0, 0)')
    strictEqual(bandBackground('#ff5900', true), `rgba(255, 89, 0, ${BAND_ALPHA})`)
  })

  // The band sits OVER the words on both surfaces — the overlay window is above
  // the watched app, the mark layer is above the contentEditable. An opaque
  // band hides the text it is drawing attention to.
  it('never reaches full opacity', () => {
    ok(BAND_ALPHA > 0 && BAND_ALPHA < 0.4)
  })
})

describe('line weight', () => {
  it('thickens on hover without moving the baseline', () => {
    ok(LINE_HEIGHT_HOVERED > LINE_HEIGHT)
    // One pixel. More than that and the line's growth reads as the text
    // shifting, since it grows upward from a fixed bottom edge.
    strictEqual(LINE_HEIGHT_HOVERED - LINE_HEIGHT, 1)
  })
})
