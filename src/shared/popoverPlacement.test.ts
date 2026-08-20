import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MIN_CARD_HEIGHT, maxCardHeight, placePopover } from './popoverPlacement.ts'

/** The editor's real geometry: 527px of visible height, a 20px line, 10px gap. */
const at = (
  markTop: number,
  cardHeight: number,
  scrollTop = 0,
  viewportHeight = 527
): ReturnType<typeof placePopover> =>
  placePopover({ markTop, markHeight: 20, cardHeight, gap: 10, viewportHeight, scrollTop })

describe('placePopover', () => {
  it('opens below when the card fits there', () => {
    const p = at(26, 261)
    strictEqual(p.above, false)
    strictEqual(p.top, 56) // 26 + 20 + 10
  })

  it('flips above when the sentence is low in the viewport', () => {
    // Measured in the preview harness: mark at 626, 527 of visible height,
    // scrolled to 300. Room below is 171, room above 316, card 261.
    const p = at(626, 261, 300)
    strictEqual(p.above, true)
    strictEqual(p.top, 355) // 626 - 10 - 261
  })

  it('does not flip a card that still fits below by a hair', () => {
    // Same mark, scrolled 100px further: room below is 271 for a 261 card.
    const p = at(626, 261, 400)
    strictEqual(p.above, false)
    strictEqual(p.top, 656)
  })

  it('never flips a card off the top of the document', () => {
    // The failure the old condition produced. A tall card over the first line
    // has no room below AND no room above; flipping puts it at a negative top,
    // which no scrolling can reach. Below clips at the bottom instead, which
    // scrolling fixes.
    const p = at(26, 600)
    strictEqual(p.above, false)
    strictEqual(p.top >= 0, true)
  })

  it('decides on room, not on the card being tall', () => {
    // `height > 390` was the whole of the old rule. A 400px card with room
    // below must stay below; a 100px card with none must flip. Both were
    // decided the wrong way round.
    strictEqual(at(26, 400).above, false)
    strictEqual(at(480, 100, 0).above, true)
  })

  it('reads the viewport in content space, not from zero', () => {
    // The same mark and the same card, differing only in scroll. Unscrolled,
    // the visible box ends at 527 and the mark at 300 has 197px under it — too
    // little for a 200px card, so it flips. Scrolled down 100, the box ends at
    // 627 and the same mark has 297px, so it stays below.
    //
    // A version that ignored scrollTop — as the original did — answers both
    // identically, which is the bug in one line.
    strictEqual(at(300, 200, 0).above, true)
    strictEqual(at(300, 200, 100).above, false)
  })

  it('treats the unmeasured first paint as fitting below', () => {
    const p = at(626, 0, 300)
    strictEqual(p.above, false)
    strictEqual(p.top, 656)
  })
})

/**
 * The cap that stops a tall card clipping its own buttons. See the note on
 * `maxCardHeight` — placePopover deliberately leaves a too-tall card below,
 * and the bottom is where Dismiss lives.
 */
describe('maxCardHeight', () => {
  const base = { markTop: 300, markHeight: 20, gap: 10, viewportHeight: 600, scrollTop: 0 }

  it('below: the room between the line and the bottom of the viewport', () => {
    // 0 + 600 - (300 + 20 + 10)
    strictEqual(maxCardHeight({ ...base, above: false }), 270)
  })

  it('above: the room between the top of the viewport and the line', () => {
    // 300 - 10 - 0
    strictEqual(maxCardHeight({ ...base, above: true }), 290)
  })

  it('measures against the SCROLLED viewport, not the document', () => {
    // Everything here is in content space, so a scrolled container's visible
    // box is [scrollTop, scrollTop + viewportHeight). Forgetting that is how
    // the placement bug this file exists for got in.
    strictEqual(maxCardHeight({ ...base, scrollTop: 100, above: false }), 370)
    strictEqual(maxCardHeight({ ...base, scrollTop: 100, above: true }), 190)
  })

  it('never returns a card too short to hold anything', () => {
    // A line at the very bottom of the viewport: the true room is 10px, and a
    // 10px card is worse than one that clips.
    strictEqual(maxCardHeight({ ...base, markTop: 570, above: false }), MIN_CARD_HEIGHT)
    // And at the very top, going the other way.
    strictEqual(maxCardHeight({ ...base, markTop: 4, above: true }), MIN_CARD_HEIGHT)
  })

  /**
   * The cap and the placement have to agree, or the card is sized for a side it
   * is not on. Both read the same inputs; this pins that they stay consistent.
   */
  it('caps for the side placePopover actually chose', () => {
    const input = { markTop: 500, markHeight: 20, cardHeight: 400, gap: 10, viewportHeight: 600, scrollTop: 0 }
    const { above } = placePopover(input)
    strictEqual(above, true, 'more room above than below here')
    strictEqual(maxCardHeight({ ...input, above }), 490)
  })
})
