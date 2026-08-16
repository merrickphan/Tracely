import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { placePopover } from './popoverPlacement.ts'

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
