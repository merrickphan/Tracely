import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildStructurePrompt, reconcileRoles } from './structureRoles.ts'

const LIMITS = { maxParagraphs: 24, maxParagraphChars: 420, maxInputChars: 8000 }

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
      warranted: [],
      statesClaim: []
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

  it('cuts at word boundaries on both sides of the elision', () => {
    // Was "truncates at a word boundary", asserting the output ended in an
    // ellipsis — the old head-only contract. A window ends with the
    // paragraph's real last words, so what has to hold now is that neither
    // side is split mid-word.
    const text = `${'alpha '.repeat(20).trim()} omega`
    const out = buildStructurePrompt([text], { ...LIMITS, maxParagraphChars: 40 })
    ok(out.includes('[…]'), 'the elided middle is not marked')
    ok(!/alph\b(?!a)/.test(out), `a word was split: ${out}`)
    ok(out.trimEnd().endsWith('omega'), `the paragraph's ending was lost: ${out}`)
  })

  it('returns an empty string for no paragraphs', () => {
    strictEqual(buildStructurePrompt([], LIMITS), '')
  })

  /**
   * The regression this window exists for.
   *
   * A student's introduction is long and ends on its thesis. Head-only
   * truncation showed the model the anecdote and cut the thesis off, so it
   * labelled the introduction 'claim', called a body paragraph the thesis,
   * found no warrant anywhere, and scored the draft 18/100 — against 78 from
   * the local regexes the classifier was meant to improve on. The model was not
   * bad at the task; it was answering about text it had never been shown.
   */
  it('keeps the END of a long paragraph, not just the beginning', () => {
    const thesis =
      'Whilst helping others is typically a moral obligation, her early struggles set her apart from her contemporaries.'
    const intro = `${'She was born in Brussels and her childhood was ordinary. '.repeat(20)}${thesis}`

    const out = buildStructurePrompt([intro], LIMITS)

    ok(out.includes('Whilst helping others'), 'the closing thesis was cut off')
    ok(out.startsWith('[1] She was born in Brussels'), 'the opening was lost')
    ok(out.includes('[…]'), 'the elided middle is not marked')
  })

  it('marks the gap so the two halves cannot read as one sentence', () => {
    // Without the marker the model reasons about a sentence that does not
    // exist — the head's last clause welded to the tail's first.
    const long = `${'alpha '.repeat(200)}omega ends here.`
    const out = buildStructurePrompt([long], LIMITS)
    ok(out.includes('[…]'))
    ok(out.trimEnd().endsWith('omega ends here.'))
  })

  it('still respects the per-paragraph cap', () => {
    // Both halves plus the marker, not the cap applied twice.
    const long = 'word '.repeat(1000).trim()
    const out = buildStructurePrompt([long], LIMITS)
    ok(
      out.length <= LIMITS.maxParagraphChars + 12,
      `window overran the cap: ${out.length} > ${LIMITS.maxParagraphChars}`
    )
  })

  it('leaves a paragraph shorter than the cap completely untouched', () => {
    // Most paragraphs in a real draft are under the cap, and a window applied
    // to them would elide nothing while still inserting a marker.
    const short = 'A short paragraph that states its point and stops.'
    strictEqual(buildStructurePrompt([short], LIMITS), `[1] ${short}`)
  })
})

describe('reconcileRoles — statesClaim', () => {
  it('reads the field when the relay sends it, whatever the role is', () => {
    const result = reconcileRoles(
      payload(
        { index: 1, role: 'evidence', hasWarrant: true, statesClaim: true },
        { index: 2, role: 'claim', hasWarrant: false, statesClaim: false }
      ),
      2
    )
    // Both disagree with the role, which is the entire point of the field: a
    // paragraph presenting sources can still open with the point they support,
    // and a paragraph the model called a claim can be restating an earlier one.
    deepStrictEqual(result.statesClaim, [true, false])
  })

  /**
   * The two-repo case. The client can reach users before the relay deploy that
   * added the field, and defaulting the missing value to false would zero
   * `governingClaims` for everyone on the older relay — a regression shipped by
   * a client-only change. Falling back to the role reproduces the exact
   * component that existed before the field.
   */
  it('falls back to the role when a relay predating the field answers', () => {
    const result = reconcileRoles(
      payload(
        { index: 1, role: 'claim', hasWarrant: false },
        { index: 2, role: 'evidence', hasWarrant: false },
        { index: 3, role: 'unknown', hasWarrant: false }
      ),
      3
    )
    deepStrictEqual(result.statesClaim, [true, false, false])
  })

  it('treats a non-boolean as absent rather than as false', () => {
    const result = reconcileRoles(
      payload({ index: 1, role: 'claim', hasWarrant: false, statesClaim: 'yes' }),
      1
    )
    deepStrictEqual(result.statesClaim, [true])
  })

  it('leaves paragraphs the payload never mentions at false', () => {
    // Not the role fallback: an unmentioned paragraph is 'unknown', and
    // 'unknown' was never claim-bearing under the old rule either.
    const result = reconcileRoles(payload({ index: 1, role: 'claim', hasWarrant: false }), 3)
    deepStrictEqual(result.statesClaim, [true, false, false])
  })
})
