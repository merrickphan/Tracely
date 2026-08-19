import { describe, it } from 'node:test'
import { ok, strictEqual } from 'node:assert'
import { FLAG_RUBRIC_SOURCE, RUBRIC_TEXT, rubricSourceFor, type FlagKind } from './rubric.ts'

/**
 * The enforcement half of "ONLY flag stuff that comes out of this list".
 *
 * `FLAG_RUBRIC_SOURCE` being a total Record over `FlagKind` is the first half —
 * the compiler refuses a new flag kind until someone gives it a clause. That
 * alone is not enough: a clause can be typed out from memory, paraphrased, or
 * quietly widened to cover a check the owner never asked for, and TypeScript
 * cannot tell the difference between a real clause and a plausible one.
 *
 * So the assertion below is a VERBATIM substring check against the rubric as
 * written. Reword the rubric and the flags that no longer have a home fail
 * here by name. That failure is the review.
 */

// Written out rather than derived from the record, for the same reason
// revisionGuidance.test.ts writes its list out: a kind deleted from both at
// once should still fail, and a list generated from the thing under test
// asserts nothing.
const EVERY_FLAG_KIND: FlagKind[] = [
  // structure — the argument
  'no-thesis',
  'topic-not-thesis',
  'unsupported-claim',
  'overreaching-claim',
  'dropped-evidence',
  'malformed-citation',
  'summary-without-point',
  'warrant-gap',
  'undeveloped-repetition',
  'evidence-stacking',
  'new-claim-in-conclusion',
  'restated-conclusion',
  'generic-opening',
  'no-significance',
  'unsupported-emphasis',
  'unclear-reference',
  // cohesion — the joins
  'no-transition',
  'topic-jump',
  'unanswered-counterargument',
  // prose — mechanics and clarity
  'repeated-word',
  'article-agreement',
  'possessive-its',
  'subject-verb',
  'verb-of',
  'run-together',
  'capitalisation',
  'wordiness',
  'filler',
  'long-sentence'
]

describe('every flag traces to the rubric', () => {
  it('cites a clause that appears verbatim in the rubric', () => {
    for (const kind of EVERY_FLAG_KIND) {
      const { clause } = rubricSourceFor(kind)
      ok(
        RUBRIC_TEXT.includes(clause),
        `${kind} cites a clause that is not in the rubric:\n  "${clause}"`
      )
    }
  })

  it('names the section that clause actually sits under', () => {
    for (const kind of EVERY_FLAG_KIND) {
      const { section, clause } = rubricSourceFor(kind)
      const headingAt = RUBRIC_TEXT.indexOf(`\n${section}`)
      ok(headingAt !== -1, `${kind} names a section not in the rubric: ${section}`)
      const clauseAt = RUBRIC_TEXT.indexOf(clause)
      ok(clauseAt > headingAt, `${kind}: "${clause}" does not sit under ${section}`)
      // And under THAT heading, not one further down: the next blank-line
      // heading after `section` must come after the clause.
      const nextHeading = RUBRIC_TEXT.slice(headingAt + 1).search(/\n[A-Z][A-Z /]{3,}\n/)
      if (nextHeading !== -1) {
        ok(
          clauseAt < headingAt + 1 + nextHeading,
          `${kind}: "${clause}" sits below the ${section} section`
        )
      }
    }
  })

  it('covers every kind, with no entries for kinds that no longer exist', () => {
    for (const kind of EVERY_FLAG_KIND) ok(FLAG_RUBRIC_SOURCE[kind], `no rubric source for ${kind}`)
    strictEqual(
      Object.keys(FLAG_RUBRIC_SOURCE).length,
      EVERY_FLAG_KIND.length,
      'FLAG_RUBRIC_SOURCE and the list in this test disagree about how many flags exist'
    )
  })
})

/**
 * The three deletions, pinned by name.
 *
 * Each was a working check before 2026-08-19 and each was removed because no
 * clause covers it. Naming them here means re-adding one is a deliberate act
 * with a failing test attached, rather than something that quietly reappears
 * because it seemed useful.
 */
describe('the flags the rubric does not ask for', () => {
  const REMOVED = [
    // "Do not require counterarguments for every essay; judge based on the
    // prompt and genre." Tracely never sees the prompt.
    'no-counterargument',
    // Absent from the rubric entirely, and against its opening line.
    'passive-voice',
    // "Do not heavily penalize an occasional typo or comma mistake."
    'spacing'
  ]

  it('are not in the mapping', () => {
    for (const kind of REMOVED) {
      ok(
        !(kind in FLAG_RUBRIC_SOURCE),
        `${kind} is back in FLAG_RUBRIC_SOURCE — the rubric has no clause for it`
      )
    }
  })

  it('and the rubric says so about counterarguments', () => {
    ok(
      RUBRIC_TEXT.includes(
        'Do not require counterarguments for every essay; judge based on the prompt and genre.'
      )
    )
  })
})
