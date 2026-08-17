// Run with `npm test`. See the note in src/renderer/src/lib/markdown.test.ts
// for why these files are excluded from both tsconfigs.
//
// The nodes below are hand-built literals, not a DOM library. That is on
// purpose and it is not a shim: `buildTextMap` reads exactly four properties —
// `nodeType`, `data`, `tagName`, `childNodes` — so a literal tree exercises the
// real walk with nothing faked around it. Pulling in jsdom to get the same four
// fields would add a dependency this repo has deliberately never had, and would
// still not make the parts that genuinely need a browser (Range rects,
// execCommand) testable here.
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildTextMap, locate, type TextNodePos } from './textMap.ts'

/** A Text node, as far as buildTextMap is concerned. */
function t(data: string): Text {
  return { nodeType: 3, data } as unknown as Text
}

/** An Element node, as far as buildTextMap is concerned. */
function e(tagName: string, ...childNodes: unknown[]): HTMLElement {
  return { nodeType: 1, tagName, childNodes } as unknown as HTMLElement
}

/** A comment node — the third thing a contentEditable can actually contain. */
function comment(): Node {
  return { nodeType: 8, data: 'note' } as unknown as Node
}

/** The invariant the whole feature rests on: every offset means what it says. */
function assertOffsetsAddressTheirNodes(text: string, nodes: TextNodePos[]): void {
  for (const entry of nodes) {
    strictEqual(
      text.slice(entry.start, entry.start + entry.node.data.length),
      entry.node.data
    )
  }
}

describe('buildTextMap — the string it reconstructs', () => {
  it('concatenates sibling text nodes with no separator', () => {
    const { text } = buildTextMap(e('DIV', t('Rates '), t('fell.')))
    strictEqual(text, 'Rates fell.')
  })

  it('inserts one newline between block siblings', () => {
    const root = e('DIV', e('DIV', t('First.')), e('DIV', t('Second.')))
    strictEqual(buildTextMap(root).text, 'First.\nSecond.\n')
  })

  it('does not open the document with a newline', () => {
    // The leading guard is `text.length > 0`. Without it every offset in the
    // document would be one character late.
    strictEqual(buildTextMap(e('DIV', e('P', t('First.')))).text.startsWith('\n'), false)
  })

  it('does not double the newline between adjacent blocks', () => {
    // Each block writes a trailing newline and the next writes a leading one;
    // `!text.endsWith('\\n')` is what collapses the pair. A doubled break here
    // would shift every later offset by one per paragraph.
    const root = e('DIV', e('P', t('One.')), e('P', t('Two.')), e('P', t('Three.')))
    strictEqual(buildTextMap(root).text, 'One.\nTwo.\nThree.\n')
  })

  it('renders BR as a newline', () => {
    const { text } = buildTextMap(e('DIV', t('One.'), e('BR'), t('Two.')))
    strictEqual(text, 'One.\nTwo.')
  })

  it('leaves inline elements seamless', () => {
    // A <b> mid-sentence must not break the sentence: splitSentences would
    // then see two fragments and the claim would never be located.
    const root = e('DIV', t('Rates '), e('B', t('fell')), t(' sharply.'))
    strictEqual(buildTextMap(root).text, 'Rates fell sharply.')
  })

  it('skips comment nodes entirely', () => {
    const { text, nodes } = buildTextMap(e('DIV', t('One.'), comment(), t(' Two.')))
    strictEqual(text, 'One. Two.')
    strictEqual(nodes.length, 2)
  })
})

describe('buildTextMap — the map back to nodes', () => {
  it('records a start for every non-empty text node', () => {
    const { nodes } = buildTextMap(e('DIV', t('Rates '), t('fell.')))
    deepStrictEqual(nodes.map((n) => n.start), [0, 6])
  })

  it('drops empty text nodes without shifting anything', () => {
    // Chromium leaves zero-length text nodes behind after editing. An entry for
    // one would be a node no offset can ever land inside, and `locate`'s
    // `before` bookkeeping would happily return it.
    const { text, nodes } = buildTextMap(e('DIV', t(''), t('Rates fell.'), t('')))
    strictEqual(nodes.length, 1)
    strictEqual(nodes[0].start, 0)
    assertOffsetsAddressTheirNodes(text, nodes)
  })

  it('counts the synthesized block newlines in later offsets', () => {
    // This is the bug the file's docblock is about: innerText's newlines exist
    // in no text node, so a map built from the nodes alone would put "Second."
    // at 6 instead of 7 and every underline after the first paragraph would sit
    // one character left, drifting further down the page.
    const root = e('DIV', e('P', t('First.')), e('P', t('Second.')))
    const { text, nodes } = buildTextMap(root)
    deepStrictEqual(nodes.map((n) => n.start), [0, 7])
    assertOffsetsAddressTheirNodes(text, nodes)
  })

  it('counts a BR the same way', () => {
    const { text, nodes } = buildTextMap(e('DIV', t('One.'), e('BR'), t('Two.')))
    deepStrictEqual(nodes.map((n) => n.start), [0, 5])
    assertOffsetsAddressTheirNodes(text, nodes)
  })

  it('keeps offsets honest across a realistic mixed document', () => {
    const root = e(
      'DIV',
      e('P', t('Babies born to smokers have low weight.')),
      e('P', t('Rates rose '), e('B', t('sharply')), t(' last year.')),
      e('UL', e('LI', t('One.')), e('LI', t('Two.')))
    )
    const { text, nodes } = buildTextMap(root)
    assertOffsetsAddressTheirNodes(text, nodes)
    strictEqual(text.includes('Rates rose sharply last year.'), true)
  })

  it('returns an empty map for an empty editor', () => {
    const { text, nodes } = buildTextMap(e('DIV'))
    strictEqual(text, '')
    deepStrictEqual(nodes, [])
  })
})

describe('locate — inside a node', () => {
  const nodes = buildTextMap(e('DIV', t('Rates '), t('fell.'))).nodes

  it('finds offset 0', () => {
    deepStrictEqual(locate(nodes, 0), { node: nodes[0].node, offset: 0 })
  })

  it('finds an offset mid-node', () => {
    deepStrictEqual(locate(nodes, 3), { node: nodes[0].node, offset: 3 })
  })

  it('finds an offset in a later node relative to that node', () => {
    deepStrictEqual(locate(nodes, 8), { node: nodes[1].node, offset: 2 })
  })
})

describe('locate — the boundary case that broke the editor', () => {
  // Regression pin. A claim's END offset is a node boundary every time the
  // claim ends its paragraph, which is most of them. When this resolved to
  // null, `measureMarks` skipped the claim and the editor drew no underlines at
  // all — measured against the preview fixture, where both flagged claims ended
  // at a boundary (43 of a 43-char node, and 162 of a node ending at 162).
  const nodes = buildTextMap(e('DIV', e('P', t('First.')), e('P', t('Second.')))).nodes

  it('resolves a boundary to the end of the node before it', () => {
    // Offset 6 is one past "First." — no node contains it.
    deepStrictEqual(locate(nodes, 6), { node: nodes[0].node, offset: 6 })
  })

  it('resolves the very end of the document, not just the last node', () => {
    // 14 is past "Second." and past its trailing synthesized newline.
    deepStrictEqual(locate(nodes, 14), { node: nodes[1].node, offset: 7 })
  })

  it('resolves an offset sitting on a synthesized newline', () => {
    // Character 6 is the '\n' that no text node contains. Falling back to the
    // end of the preceding node is the same character position expressed as a
    // place a Range can address.
    const at = locate(nodes, 6)
    strictEqual(at?.node, nodes[0].node)
  })

  it('is not special-cased to the LAST node', () => {
    // The original bug: only the final node's end resolved, so every earlier
    // paragraph's closing sentence was dropped. nodes[0] is not last.
    strictEqual(locate(nodes, 6) === null, false)
  })
})

describe('locate — refusals', () => {
  const nodes = buildTextMap(e('DIV', t('Rates fell.'))).nodes

  it('clamps an offset past the end to the last node it has', () => {
    // Deliberate, and the reason `insertCitationForClaim` can still place a
    // citation after the draft grew: the last node is the nearest addressable
    // position, not a guess about which sentence is meant.
    deepStrictEqual(locate(nodes, 999), { node: nodes[0].node, offset: 11 })
  })

  it('returns null for a negative offset', () => {
    strictEqual(locate(nodes, -1), null)
  })

  it('returns null for an empty map', () => {
    // No node precedes anything, so there is nothing to fall back to.
    strictEqual(locate([], 0), null)
    strictEqual(locate([], 999), null)
  })
})

describe('buildTextMap + locate — round trip', () => {
  it('addresses every character of a multi-paragraph document', () => {
    const root = e(
      'DIV',
      e('P', t('Babies born to smokers have low weight.')),
      e('P', t('Rates rose sharply last year.'))
    )
    const { text, nodes } = buildTextMap(root)

    for (let i = 0; i < text.length; i++) {
      const at = locate(nodes, i)
      strictEqual(at !== null, true, `no node for offset ${i}`)
      if (!at) continue
      // Either the offset addresses this character directly, or it is one of
      // the synthesized newlines and resolves to the end of the node before it.
      const addressed = at.node.data[at.offset]
      strictEqual(addressed === text[i] || addressed === undefined, true, `offset ${i}`)
    }
  })
})
