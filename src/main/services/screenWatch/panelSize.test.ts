import { ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeAllPanelSize,
  computeStructurePanelSize,
  MAX_LIST_PANEL_HEIGHT,
  PANEL_WIDTH,
  SINGLE_PANEL_WIDTH
} from './panelSize.ts'

describe('panel width', () => {
  it('is the same in every view mode', () => {
    // The panel is anchored to the watched window's bottom-right corner, so a
    // mode with a different width makes the whole card jump sideways when the
    // user switches views. This is the assertion most likely to catch a future
    // edit that changes one mode's layout without thinking about the others.
    strictEqual(SINGLE_PANEL_WIDTH, PANEL_WIDTH)
    strictEqual(computeAllPanelSize(3).width, PANEL_WIDTH)
    strictEqual(computeStructurePanelSize({ weaknessCount: 3, paragraphCount: 6 }).width, PANEL_WIDTH)
  })
})

describe('computeAllPanelSize', () => {
  it('grows with claim count', () => {
    ok(computeAllPanelSize(3).height > computeAllPanelSize(1).height)
  })

  it('never exceeds the cap', () => {
    strictEqual(computeAllPanelSize(50).height, MAX_LIST_PANEL_HEIGHT)
  })

  it('treats zero claims as one, rather than collapsing to a header', () => {
    strictEqual(computeAllPanelSize(0).height, computeAllPanelSize(1).height)
  })
})

describe('computeStructurePanelSize', () => {
  it('grows with weaknesses and with paragraphs', () => {
    const base = computeStructurePanelSize({ weaknessCount: 0, paragraphCount: 0 }).height
    ok(computeStructurePanelSize({ weaknessCount: 2, paragraphCount: 0 }).height > base)
    ok(computeStructurePanelSize({ weaknessCount: 0, paragraphCount: 4 }).height > base)
  })

  it('is monotonic in both inputs', () => {
    let previous = 0
    for (let n = 0; n <= 6; n++) {
      const height = computeStructurePanelSize({ weaknessCount: n, paragraphCount: n }).height
      ok(height >= previous, `height fell at n=${n}`)
      previous = height
    }
  })

  it('never exceeds the cap, however long the draft', () => {
    strictEqual(
      computeStructurePanelSize({ weaknessCount: 40, paragraphCount: 200 }).height,
      MAX_LIST_PANEL_HEIGHT
    )
  })

  it('stops growing past the row caps, so the request stays meaningful', () => {
    // Beyond the caps the body scrolls. Asking for 900px only to be clamped to
    // 560 would make the returned height say nothing about the content.
    strictEqual(
      computeStructurePanelSize({ weaknessCount: 4, paragraphCount: 8 }).height,
      computeStructurePanelSize({ weaknessCount: 9, paragraphCount: 30 }).height
    )
  })

  it('still has room for the score when there is nothing else to show', () => {
    // A clean draft has no weaknesses. The panel must not collapse to a header.
    ok(computeStructurePanelSize({ weaknessCount: 0, paragraphCount: 0 }).height > 150)
  })
})
