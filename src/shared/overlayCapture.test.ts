import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldCaptureMouse } from './overlayCapture.ts'

const base = { dragActive: false, hovering: null as 'claim' | 'widget' | null, inPopover: false }

describe('shouldCaptureMouse', () => {
  // The regression. Capturing here makes the whole overlay solid over someone
  // else's document, so a click on a flagged sentence never reaches it and the
  // caret cannot be placed in the text the flag is about.
  it('does NOT capture while the cursor is on an underline', () => {
    strictEqual(shouldCaptureMouse({ ...base, hovering: 'claim' }), false)
  })

  it('captures inside the popover, which has the buttons', () => {
    strictEqual(shouldCaptureMouse({ ...base, hovering: 'claim', inPopover: true }), true)
  })

  it('captures on the widget, which is Tracely’s own UI', () => {
    strictEqual(shouldCaptureMouse({ ...base, hovering: 'widget' }), true)
  })

  it('captures through a drag, wherever the cursor has got to', () => {
    strictEqual(shouldCaptureMouse({ ...base, dragActive: true }), true)
    strictEqual(shouldCaptureMouse({ ...base, dragActive: true, hovering: 'claim' }), true)
  })

  it('releases when the cursor is on nothing', () => {
    strictEqual(shouldCaptureMouse(base), false)
  })

  // A popover can be open while the cursor is back over the underline that
  // opened it — the card must not hold the mouse from a distance.
  it('does not capture for an open popover the cursor is outside of', () => {
    strictEqual(shouldCaptureMouse({ ...base, hovering: 'claim', inPopover: false }), false)
  })
})
