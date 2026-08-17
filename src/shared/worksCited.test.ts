import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  findWorksCitedSection,
  planWorksCited,
  withoutWorksCited,
  WORKS_CITED_HEADINGS
} from './worksCited.ts'

const MLA = 'Ionescu, Maria. “Grid-Scale Storage and Reliability.” Applied Energy, vol. 318, 2022, pp. 1–14.'
const APA = 'Ionescu, M. (2022). Grid-scale storage and reliability. Applied Energy, 318, 1–14.'
const OTHER = 'Bakker, Lena. “Curtailment in Northern Grids.” Renewable Energy, vol. 190, 2021, pp. 55–70.'

/** Applies an edit the way documentMarks' Range + insertText does. */
function apply(text: string, plan: ReturnType<typeof planWorksCited>): string {
  if (!plan.edit) return text
  return text.slice(0, plan.edit.start) + plan.edit.replacement + text.slice(plan.edit.end)
}

describe('findWorksCitedSection', () => {
  it('returns null for a draft with no reference list', () => {
    assert.equal(findWorksCitedSection('An essay about grids.\n\nIt ends here.'), null)
  })

  it('does not mistake prose that mentions references for a list', () => {
    // The heading test is anchored to a whole line for exactly this: a sentence
    // containing the word is prose, and treating it as a heading would put the
    // reference list in the middle of the essay.
    assert.equal(findWorksCitedSection('Prior references disagree about storage.'), null)
  })

  it('finds the heading and its entries', () => {
    const text = `Body paragraph.\n\nWorks Cited\n${MLA}\n${OTHER}`
    const section = findWorksCitedSection(text)
    assert.ok(section)
    assert.equal(section.heading, 'Works Cited')
    assert.deepEqual(section.entries, [MLA, OTHER])
    assert.equal(text.slice(section.start, section.start + 11), 'Works Cited')
  })

  it('accepts References and Bibliography, so a second list is never appended', () => {
    for (const heading of Object.values(WORKS_CITED_HEADINGS)) {
      const section = findWorksCitedSection(`Body.\n\n${heading}\n${APA}`)
      assert.ok(section, heading)
      assert.equal(section.heading, heading)
    }
  })

  it('ends at the last entry, not past the trailing blank lines', () => {
    const text = `Body.\n\nWorks Cited\n${MLA}\n\n\n`
    const section = findWorksCitedSection(text)
    assert.ok(section)
    assert.equal(text.slice(section.start, section.end), `Works Cited\n${MLA}`)
  })

  it('takes the LAST heading, so an essay about bibliographies still works', () => {
    const text = `A bibliography is a list.\n\nWorks Cited\n${MLA}`
    const section = findWorksCitedSection(text)
    assert.ok(section)
    assert.equal(section.heading, 'Works Cited')
  })
})

describe('planWorksCited — creating the section', () => {
  it('appends a heading and the entry when the document has no list', () => {
    const text = 'Storage improves reliability.\n'
    const plan = planWorksCited({ text, entry: MLA, sourceTitle: null, style: 'MLA' })
    assert.ok(plan.edit)
    assert.equal(plan.edit.created, true)
    assert.equal(apply(text, plan), `Storage improves reliability.\n\nWorks Cited\n${MLA}\n`)
  })

  it('does not grow a run of empty paragraphs on a text ending in newlines', () => {
    // buildTextMap ends its reconstruction with the newline every block element
    // contributes, so appending at text.length would open the section one blank
    // line lower on every citation. The writer's own trailing blank lines are
    // left where they were — below the list, not swallowed by it.
    const plan = planWorksCited({ text: 'Body.\n\n\n', entry: MLA, sourceTitle: null, style: 'MLA' })
    assert.equal(apply('Body.\n\n\n', plan), `Body.\n\nWorks Cited\n${MLA}\n\n\n`)
  })

  it('uses the style-appropriate heading', () => {
    assert.match(
      apply('Body.', planWorksCited({ text: 'Body.', entry: APA, sourceTitle: null, style: 'APA' })),
      /\nReferences\n/
    )
    assert.match(
      apply('Body.', planWorksCited({ text: 'Body.', entry: APA, sourceTitle: null, style: 'Chicago' })),
      /\nBibliography\n/
    )
  })
})

describe('planWorksCited — dedupe', () => {
  it('refuses to add a source that is already listed', () => {
    const text = `Body.\n\nWorks Cited\n${MLA}`
    const plan = planWorksCited({ text, entry: MLA, sourceTitle: 'Grid-Scale Storage and Reliability', style: 'MLA' })
    assert.equal(plan.edit, null)
  })

  it('matches across straight and curly quotes', () => {
    const typed = MLA.replace(/[“”]/g, '"').replace(/–/g, '-')
    const text = `Body.\n\nWorks Cited\n${typed}`
    const plan = planWorksCited({ text, entry: MLA, sourceTitle: null, style: 'MLA' })
    assert.equal(plan.edit, null)
  })

  it('matches the same work across two styles, on the title', () => {
    const text = `Body.\n\nWorks Cited\n${MLA}`
    const plan = planWorksCited({
      text,
      entry: APA,
      sourceTitle: 'Grid-Scale Storage and Reliability',
      style: 'APA'
    })
    assert.equal(plan.edit, null)
  })

  it('does NOT collapse two papers by the same author in the same year', () => {
    // The rejected surname+year key would have deduped these, silently losing a
    // reference — the failure direction that cannot be seen in the finished list.
    const second =
      'Ionescu, Maria. “Interconnection Delays in Europe.” Applied Energy, vol. 319, 2022, pp. 20–33.'
    const text = `Body.\n\nWorks Cited\n${MLA}`
    const plan = planWorksCited({ text, entry: second, sourceTitle: 'Interconnection Delays in Europe', style: 'MLA' })
    assert.ok(plan.edit)
    assert.equal(apply(text, plan).split('\n').filter((l) => l.startsWith('Ionescu')).length, 2)
  })

  it('ignores a title too short to identify a work', () => {
    // "Energy" appearing inside an unrelated entry must not swallow a new one.
    const text = `Body.\n\nWorks Cited\n${MLA}`
    const plan = planWorksCited({ text, entry: OTHER, sourceTitle: 'Energy', style: 'MLA' })
    assert.ok(plan.edit)
  })

  it('drops a duplicate the writer already had in the list', () => {
    const text = `Body.\n\nWorks Cited\n${MLA}\n${MLA}`
    const plan = planWorksCited({ text, entry: OTHER, sourceTitle: null, style: 'MLA' })
    assert.equal(apply(text, plan), `Body.\n\nWorks Cited\n${OTHER}\n${MLA}`)
  })
})

describe('planWorksCited — ordering', () => {
  it('files a new entry alphabetically, not at the end', () => {
    const text = `Body.\n\nWorks Cited\n${MLA}`
    const plan = planWorksCited({ text, entry: OTHER, sourceTitle: null, style: 'MLA' })
    assert.equal(apply(text, plan), `Body.\n\nWorks Cited\n${OTHER}\n${MLA}`)
  })

  it('re-sorts a list that was already out of order', () => {
    const text = `Body.\n\nWorks Cited\n${MLA}\n${OTHER}`
    const third = 'Adeyemi, Tunde. “Storage Economics.” Energy Policy, vol. 160, 2022, pp. 1–9.'
    const plan = planWorksCited({ text, entry: third, sourceTitle: null, style: 'MLA' })
    assert.deepEqual(apply(text, plan).split('\n').slice(-3), [third, OTHER, MLA])
  })

  it('files a title-led entry under its title, not under the quote mark', () => {
    const titleLed = '“Anonymous Grid Report.” Energy Review, 2020, pp. 4–8.'
    const text = `Body.\n\nWorks Cited\n${MLA}`
    const plan = planWorksCited({ text, entry: titleLed, sourceTitle: null, style: 'MLA' })
    assert.deepEqual(apply(text, plan).split('\n').slice(-2), [titleLed, MLA])
  })

  it('keeps the writer’s own heading wording when rewriting', () => {
    const text = `Body.\n\nREFERENCES\n${APA}`
    const plan = planWorksCited({ text, entry: OTHER, sourceTitle: null, style: 'MLA' })
    assert.match(apply(text, plan), /\nREFERENCES\n/)
    assert.ok(!apply(text, plan).includes('Works Cited'))
  })
})

describe('withoutWorksCited', () => {
  it('trims the reference list so the argument score is not computed over it', () => {
    const text = `Intro.\n\nConclusion.\n\nWorks Cited\n${MLA}`
    assert.equal(withoutWorksCited(text), 'Intro.\n\nConclusion.\n\n')
  })

  it('is a suffix trim, so offsets before it are unchanged', () => {
    const text = `Intro.\n\nConclusion.\n\nWorks Cited\n${MLA}`
    const trimmed = withoutWorksCited(text)
    assert.equal(text.slice(0, trimmed.length), trimmed)
  })

  it('leaves a draft with no list alone', () => {
    assert.equal(withoutWorksCited('Intro.\n\nConclusion.'), 'Intro.\n\nConclusion.')
  })
})
