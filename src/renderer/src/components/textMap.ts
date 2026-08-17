// The offset<->text-node mapping behind the document editor's marks, split out
// of `documentMarks.ts` so `npm test` can load it.
//
// Same rule as `structure/roles.ts` and `shared/paragraphSplit.ts` (CLAUDE.md,
// "Tested modules are leaves"): Node's type stripping rejects this codebase's
// extensionless relative imports, so anything with a relative *value* import is
// untestable. `documentMarks.ts` has five of them (`@shared/*`); these two
// functions have none, and they hold a decision that has already been wrong in
// production once — see the boundary note on `locate`.
//
// Deliberately import-free, and deliberately free of DOM *globals* too: the
// node-type checks are the numeric literals rather than `Node.TEXT_NODE` /
// `Node.ELEMENT_NODE`, because `Node` does not exist in the test runner and a
// module that throws at import time teaches nothing. Those two constants are
// fixed by the DOM spec, so this is the same comparison written portably.

const TEXT_NODE = 3
const ELEMENT_NODE = 1

export interface TextNodePos {
  node: Text
  /** Offset of this node's text within the reconstructed string. */
  start: number
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL'
])

/**
 * Rebuilds the editor's text alongside a map back to the text nodes it came
 * from, inserting the same newlines `innerText` renders at block boundaries.
 *
 * Claim offsets cannot come from `innerText` directly: it reports newlines that
 * exist nowhere in any text node, so every offset after the first paragraph
 * break would be shifted by the number of breaks before it and every underline
 * would sit a few characters to the left of its sentence, drifting further down
 * the page. Building the string and the map in one pass is what keeps them
 * honest — the offsets are of *this* string, and this string knows which node
 * each character came from.
 *
 * It does not have to match innerText exactly, and does not try to. Claims are
 * located with `computeClaimSpans`, which falls back to a whitespace-insensitive
 * search precisely for near-misses like this one.
 */
export function buildTextMap(root: HTMLElement): { text: string; nodes: TextNodePos[] } {
  const nodes: TextNodePos[] = []
  let text = ''

  const walk = (parent: Node): void => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        const node = child as Text
        if (node.data.length === 0) continue
        nodes.push({ node, start: text.length })
        text += node.data
        continue
      }
      if (child.nodeType !== ELEMENT_NODE) continue

      const element = child as HTMLElement
      if (element.tagName === 'BR') {
        text += '\n'
        continue
      }
      const isBlock = BLOCK_TAGS.has(element.tagName)
      if (isBlock && text.length > 0 && !text.endsWith('\n')) text += '\n'
      walk(element)
      if (isBlock && text.length > 0 && !text.endsWith('\n')) text += '\n'
    }
  }

  walk(root)
  return { text, nodes }
}

/**
 * The text node and in-node offset holding character `offset`.
 *
 * No node contains an offset that lands exactly ON a boundary, and a claim's
 * END offset is a boundary every time the claim ends its paragraph — which is
 * most of them. That case used to be special-cased for the LAST node only, so
 * every earlier paragraph's final sentence resolved to null and
 * `measureMarks` skipped it. Measured in the preview harness against the
 * fixture document: both flagged claims ended at a node boundary (43 of a
 * 43-char node, 162 of a node ending at 162) and the editor drew no underlines
 * at all.
 *
 * A boundary now resolves to the end of the node that precedes it, which is
 * the same character position expressed as a place a Range can actually
 * address. Null is kept for an offset past every node — there the text really
 * has moved on, and a guessed position would underline the wrong sentence.
 */
export function locate(nodes: TextNodePos[], offset: number): { node: Text; offset: number } | null {
  let before: TextNodePos | null = null
  for (const entry of nodes) {
    const end = entry.start + entry.node.data.length
    if (offset >= entry.start && offset < end) {
      return { node: entry.node, offset: offset - entry.start }
    }
    if (offset >= end) before = entry
  }
  if (before) {
    return { node: before.node, offset: before.node.data.length }
  }
  return null
}
