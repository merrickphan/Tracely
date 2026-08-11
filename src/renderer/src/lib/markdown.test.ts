// Run with `npm test`. Node's built-in test runner and type stripping, so
// there is no test framework, no transpile step and no new dependency.
//
// These files are excluded from both tsconfigs on purpose: pulling `node` into
// tsconfig.web.json's `types` to satisfy `node:test` would put Node globals in
// the renderer program, which CLAUDE.md already warns degrades inference across
// every renderer file. The tests are therefore not typechecked; the module they
// test is.
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseMarkdown, parseInline, type Block, type InlineNode } from './markdown.ts'

/** Compact debug form, so a failure reads as the text rather than as a tree. */
function inline(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return n.value
      if (n.type === 'code') return `<code>${n.value}</code>`
      if (n.type === 'strong') return `<b>${inline(n.children)}</b>`
      return `<i>${inline(n.children)}</i>`
    })
    .join('')
}

function blocks(input: string): string {
  return parseMarkdown(input)
    .map((b: Block) => {
      if (b.type === 'heading') return `<h>${inline(b.children)}</h>`
      if (b.type === 'paragraph') return inline(b.children)
      const tag = b.ordered ? 'ol' : 'ul'
      return `<${tag}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${tag}>`
    })
    .join('\n||\n')
}

describe('parseInline — emphasis', () => {
  it('renders the reported case', () => {
    strictEqual(inline(parseInline('This is **important** here')), 'This is <b>important</b> here')
  })

  it('renders single-asterisk italics', () => {
    strictEqual(inline(parseInline('a *b* c')), 'a <i>b</i> c')
  })

  it('renders underscore italics', () => {
    strictEqual(inline(parseInline('a _b_ c')), 'a <i>b</i> c')
  })

  it('nests bold and italic', () => {
    strictEqual(inline(parseInline('***both***')), '<b><i>both</i></b>')
  })

  it('nests italic inside bold', () => {
    strictEqual(inline(parseInline('**a *b* c**')), '<b>a <i>b</i> c</b>')
  })
})

describe('parseInline — unmatched delimiters stay literal', () => {
  // The governing rule. A stray delimiter must change nothing but itself.
  it('leaves an unclosed ** alone', () => {
    strictEqual(inline(parseInline('an **unclosed run')), 'an **unclosed run')
  })

  it('leaves an unclosed * alone', () => {
    strictEqual(inline(parseInline('2 * 3 is 6')), '2 * 3 is 6')
  })

  it('leaves a lone trailing ** alone', () => {
    strictEqual(inline(parseInline('trailing **')), 'trailing **')
  })

  it('does not treat whitespace-flanked ** as emphasis', () => {
    strictEqual(inline(parseInline('a ** b ** c')), 'a ** b ** c')
  })

  it('leaves an unclosed backtick alone', () => {
    strictEqual(inline(parseInline('a ` b')), 'a ` b')
  })

  it('leaves an empty code span alone', () => {
    strictEqual(inline(parseInline('a `` b')), 'a `` b')
  })
})

describe('parseInline — word-internal underscores', () => {
  it('does not italicise snake_case', () => {
    strictEqual(inline(parseInline('call some_long_name now')), 'call some_long_name now')
  })

  it('does not italicise a URL path', () => {
    strictEqual(inline(parseInline('see foo_bar_baz.html')), 'see foo_bar_baz.html')
  })
})

describe('parseInline — code spans', () => {
  it('renders a code span', () => {
    strictEqual(inline(parseInline('use `npm test` now')), 'use <code>npm test</code> now')
  })

  it('does not read emphasis inside a code span', () => {
    strictEqual(inline(parseInline('`a*b*c`')), '<code>a*b*c</code>')
  })
})

describe('parseInline — escapes', () => {
  it('escapes an asterisk', () => {
    strictEqual(inline(parseInline('a \\*not italic\\* b')), 'a *not italic* b')
  })

  it('escapes a backtick', () => {
    strictEqual(inline(parseInline('a \\` b')), 'a ` b')
  })
})

describe('parseMarkdown — blocks', () => {
  it('leaves plain prose exactly as it was', () => {
    // The no-regression case: text with no markdown must survive verbatim,
    // newlines included, because these surfaces rendered it with pre-wrap
    // before this parser existed.
    const prose = 'First line.\nSecond line, same paragraph.'
    strictEqual(blocks(prose), prose)
    deepStrictEqual(parseMarkdown(prose), [
      { type: 'paragraph', children: [{ type: 'text', value: prose }] }
    ])
  })

  it('splits paragraphs on a blank line', () => {
    strictEqual(blocks('One.\n\nTwo.'), 'One.\n||\nTwo.')
  })

  it('reads a bullet list', () => {
    strictEqual(blocks('- a\n- b'), '<ul><li>a</li><li>b</li></ul>')
  })

  it('reads an asterisk bullet list', () => {
    strictEqual(blocks('* a\n* b'), '<ul><li>a</li><li>b</li></ul>')
  })

  it('reads an ordered list', () => {
    strictEqual(blocks('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>')
  })

  it('reads a heading', () => {
    strictEqual(blocks('## Why this matters'), '<h>Why this matters</h>')
  })

  it('parses emphasis inside list items', () => {
    strictEqual(blocks('- **a** b'), '<ul><li><b>a</b> b</li></ul>')
  })

  it('ends a paragraph when a list starts', () => {
    strictEqual(blocks('Intro:\n- a'), 'Intro:\n||\n<ul><li>a</li></ul>')
  })
})

describe('parseMarkdown — things that must NOT become blocks', () => {
  it('does not read a sentence starting with a year as an ordered list', () => {
    // "2020. Smith reported…" is prose. `\d{1,9}[.)]` would have reformatted
    // it into a numbered list.
    strictEqual(blocks('2020. Smith reported a decline.'), '2020. Smith reported a decline.')
  })

  it('does not read leading italics as a bullet', () => {
    // Both list patterns require whitespace after the marker; emphasis never
    // has it.
    strictEqual(blocks('*Emphasis* opens this line.'), '<i>Emphasis</i> opens this line.')
  })

  it('does not read a hash without a space as a heading', () => {
    strictEqual(blocks('#1 cause of failure'), '#1 cause of failure')
  })
})

describe('parseMarkdown — degenerate input', () => {
  it('returns no blocks for an empty string', () => {
    deepStrictEqual(parseMarkdown(''), [])
  })

  it('returns no blocks for whitespace only', () => {
    deepStrictEqual(parseMarkdown('   \n\n  '), [])
  })

  it('normalises CRLF', () => {
    // Windows clipboards and Word's UIA both hand back \r\n.
    strictEqual(blocks('a\r\n\r\nb'), 'a\n||\nb')
  })
})
