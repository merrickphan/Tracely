import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildStructurePrompt, reconcileRoles } from './structureRoles.ts'

const LIMITS = { maxParagraphs: 24, maxParagraphChars: 320, maxInputChars: 8000 }

function payload(...entries: Array<Record<string, unknown>>): unknown {
  return { paragraphs: entries }
}

describe('reconcileRoles — well-formed payloads', () => {
  it('maps entries onto 1-based paragraph positions', () => {
    const result = reconcileRoles(
      payload(
        { index: 1, role: 'thesis', hasWarrant: false },
        { index: 2, role: 'evidence', hasWarrant: true }
      ),
      2
    )
    deepStrictEqual(result.roles, ['thesis', 'evidence'])
    deepStrictEqual(result.warranted, [false, true])
  })

  it('does not care what order entries arrive in', () => {
    const result = reconcileRoles(
      payload(
        { index: 3, role: 'conclusion', hasWarrant: false },
        { index: 1, role: 'thesis', hasWarrant: false }
      ),
      3
    )
    deepStrictEqual(result.roles, ['thesis', 'unknown', 'conclusion'])
  })
})

describe('reconcileRoles — malformed payloads never shift the vector', () => {
  it('fills gaps with unknown rather than compacting', () => {
    // Compacting here would score paragraph 3's role against paragraph 2.
    const result = reconcileRoles(payload({ index: 3, role: 'evidence', hasWarrant: true }), 4)
    deepStrictEqual(result.roles, ['unknown', 'unknown', 'evidence', 'unknown'])
    deepStrictEqual(result.warranted, [false, false, true, false])
  })

  it('drops an index past the end', () => {
    const result = reconcileRoles(payload({ index: 9, role: 'thesis', hasWarrant: true }), 2)
    deepStrictEqual(result.roles, ['unknown', 'unknown'])
  })

  it('drops index 0 and negatives', () => {
    const result = reconcileRoles(
      payload({ index: 0, role: 'thesis', hasWarrant: true }, { index: -1, role: 'claim', hasWarrant: true }),
      2
    )
    deepStrictEqual(result.roles, ['unknown', 'unknown'])
  })

  it('keeps the first of two entries for the same paragraph', () => {
    const result = reconcileRoles(
      payload(
        { index: 1, role: 'thesis', hasWarrant: false },
        { index: 1, role: 'conclusion', hasWarrant: true }
      ),
      1
    )
    deepStrictEqual(result.roles, ['thesis'])
    deepStrictEqual(result.warranted, [false])
  })

  it('drops a role outside the vocabulary', () => {
    const result = reconcileRoles(payload({ index: 1, role: 'rebuttal', hasWarrant: true }), 1)
    deepStrictEqual(result.roles, ['unknown'])
  })

  it('drops a non-integer index', () => {
    const result = reconcileRoles(
      payload({ index: 1.5, role: 'thesis', hasWarrant: true }, { index: '2', role: 'claim', hasWarrant: true }),
      2
    )
    deepStrictEqual(result.roles, ['unknown', 'unknown'])
  })

  it('treats a non-boolean hasWarrant as no warrant', () => {
    // Defaulting the other way hands out points for a field never answered.
    const result = reconcileRoles(
      payload(
        { index: 1, role: 'claim', hasWarrant: 'yes' },
        { index: 2, role: 'claim' },
        { index: 3, role: 'claim', hasWarrant: 1 }
      ),
      3
    )
    deepStrictEqual(result.warranted, [false, false, false])
    deepStrictEqual(result.roles, ['claim', 'claim', 'claim'])
  })

  it('survives entries that are not objects', () => {
    const result = reconcileRoles(payload(null as never, 'thesis' as never, 42 as never), 2)
    deepStrictEqual(result.roles, ['unknown', 'unknown'])
  })
})

describe('reconcileRoles — degenerate input', () => {
  it('returns all unknown for a non-array payload', () => {
    deepStrictEqual(reconcileRoles({ paragraphs: 'nope' }, 2).roles, ['unknown', 'unknown'])
    deepStrictEqual(reconcileRoles({}, 2).roles, ['unknown', 'unknown'])
    deepStrictEqual(reconcileRoles(null, 2).roles, ['unknown', 'unknown'])
    deepStrictEqual(reconcileRoles(undefined, 2).roles, ['unknown', 'unknown'])
  })

  it('returns empty vectors for a document with no paragraphs', () => {
    deepStrictEqual(reconcileRoles(payload({ index: 1, role: 'thesis', hasWarrant: true }), 0), {
      roles: [],
      warranted: []
    })
  })

  it('always returns exactly one entry per paragraph', () => {
    for (const count of [1, 3, 12]) {
      const result = reconcileRoles(payload({ index: 2, role: 'claim', hasWarrant: true }), count)
      strictEqual(result.roles.length, count)
      strictEqual(result.warranted.length, count)
    }
  })
})

describe('buildStructurePrompt', () => {
  it('numbers paragraphs from 1', () => {
    strictEqual(buildStructurePrompt(['One.', 'Two.'], LIMITS), '[1] One.\n[2] Two.')
  })

  it('caps each paragraph before the total', () => {
    // The load-bearing order. With a single 5000-char paragraph, slicing the
    // assembled string would consume most of an 8000-char budget and starve
    // everything after it; capping per paragraph first leaves room for all.
    const long = 'word '.repeat(1000).trim()
    const out = buildStructurePrompt([long, long, long], LIMITS)
    strictEqual(out.split('\n').length, 3)
    for (const line of out.split('\n')) {
      strictEqual(line.length <= LIMITS.maxParagraphChars + 8, true, `line too long: ${line.length}`)
    }
  })

  it('stops at a whole paragraph rather than emitting a partial entry', () => {
    const out = buildStructurePrompt(['aaaa', 'bbbb', 'cccc'], {
      ...LIMITS,
      maxInputChars: 18
    })
    // Each line is "[n] xxxx" = 8 chars, +1 for the separator.
    deepStrictEqual(out.split('\n'), ['[1] aaaa', '[2] bbbb'])
  })

  it('drops paragraphs past the count cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}.`)
    strictEqual(buildStructurePrompt(many, LIMITS).split('\n').length, LIMITS.maxParagraphs)
  })

  it('truncates at a word boundary where one is close enough', () => {
    const text = `${'alpha '.repeat(20).trim()} omega`
    const out = buildStructurePrompt([text], { ...LIMITS, maxParagraphChars: 40 })
    strictEqual(out.endsWith('…'), true)
    strictEqual(out.includes('alph…'), false)
  })

  it('returns an empty string for no paragraphs', () => {
    strictEqual(buildStructurePrompt([], LIMITS), '')
  })
})
