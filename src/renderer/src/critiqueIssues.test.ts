import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { critiqueIssues } from './critiqueIssues.ts'

describe('critiqueIssues — markdown headings', () => {
  // The bullet class used to be [-*•], which matched the first character of
  // `**Bold**` and stripped it. The `^\*\*` test then failed on every block, so
  // this whole branch was unreachable: the heading was mangled into the body
  // and the card fell back to printing the verdict as the title.
  it('reads a bold heading as the row title', () => {
    const [row] = critiqueIssues('**Overstated, not wrong.** Evidence 2 notes effects vary by district.')
    strictEqual(row.title, 'Overstated, not wrong.')
    strictEqual(row.detail, 'Evidence 2 notes effects vary by district.')
  })

  it('does not leave a stray asterisk in the detail', () => {
    for (const row of critiqueIssues('**Citation format.** The year sits in the page slot.')) {
      strictEqual(row.detail.includes('*'), false)
      strictEqual(row.title.includes('*'), false)
    }
  })

  it('still strips a real single-asterisk bullet', () => {
    const rows = critiqueIssues('* First finding here.\n* Second finding here.')
    strictEqual(rows.length, 2)
    strictEqual(rows[0].detail.startsWith('*'), false)
    strictEqual(rows[1].detail.startsWith('*'), false)
  })

  it('still strips dash and numbered bullets', () => {
    deepStrictEqual(
      critiqueIssues('- One thing.\n- Two thing.').map((r) => r.detail),
      ['One thing.', 'Two thing.']
    )
    strictEqual(critiqueIssues('1. Numbered point.').length, 1)
  })

  it('keeps one paragraph as one row rather than inventing findings', () => {
    const rows = critiqueIssues('The evidence is thin and does not address the population claimed.')
    strictEqual(rows.length, 1)
  })

  it('returns nothing for an empty critique', () => {
    deepStrictEqual(critiqueIssues('   '), [])
  })
})
