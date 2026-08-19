import { ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  COHESION_GUIDANCE,
  REVISION_GUIDANCE,
  cohesionGuidanceFor,
  guidanceFor
} from './revisionGuidance.ts'

const COHESION_KINDS = ['no-transition', 'topic-jump', 'unanswered-counterargument'] as const

const KINDS = [
  'no-thesis',
  'unsupported-claim',
  'warrant-gap',
  'new-claim-in-conclusion',
  'evidence-stacking',
  'no-significance',
  'dropped-evidence',
  'overreaching-claim',
  'unsupported-emphasis',
  'unclear-reference',
  'restated-conclusion',
  'undeveloped-repetition',
  'generic-opening',
  'topic-not-thesis',
  'summary-without-point',
  'malformed-citation',
  'circular-reasoning',
  'sequence-as-cause',
  'single-case-generalisation',
  'logical-leap',
  'vague-significance',
  'off-thesis-paragraph'
] as const

describe('REVISION_GUIDANCE', () => {
  it('covers every weakness kind the report can raise', () => {
    // The list here is written out rather than derived from the record, so a
    // kind deleted from both at once still fails.
    for (const kind of KINDS) {
      ok(REVISION_GUIDANCE[kind], `no guidance for ${kind}`)
    }
    strictEqual(Object.keys(REVISION_GUIDANCE).length, KINDS.length)
  })

  it('gives all three fields for every kind', () => {
    for (const kind of KINDS) {
      const g = guidanceFor(kind)
      for (const [field, value] of Object.entries(g)) {
        ok(value.trim().length > 0, `${kind}.${field} is empty`)
      }
    }
  })

  /**
   * The line this module is built to hold.
   *
   * Guidance describes the MOVE; it must never supply the sentence. A quoted
   * fragment in the `move` field would be a phrase to paste into an essay,
   * which is the thing `weaknesses.ts` refuses to do and the reason its
   * messages are local templates rather than model output.
   *
   * Quotation marks are allowed in `why` and `done`, where they appear around
   * examples of what NOT to write and around the questions to ask.
   */
  it('never puts a ready-made sentence in the move', () => {
    for (const kind of KINDS) {
      const { move } = guidanceFor(kind)
      ok(!/["“”]/.test(move.replace(/"so what[^"]*"/i, '')), `${kind}.move quotes a phrase to paste`)
    }
  })

  it('phrases every move as an instruction, not a description', () => {
    // Starts with a verb. A move that opens "There should be a warrant" is a
    // restatement of the diagnosis, which is the failure this replaces.
    const DESCRIPTIVE = /^(the|this|there|it|your|a|an)\b/i
    for (const kind of KINDS) {
      ok(!DESCRIPTIVE.test(guidanceFor(kind).move.trim()), `${kind}.move does not start with a verb`)
    }
  })

  it('gives a test the writer can run alone', () => {
    // `done` must be checkable against the draft itself — no "ask your teacher",
    // no "consider whether". The counterargument case is the deliberate
    // exception: the only honest test for a strawman is a person who holds the
    // view.
    for (const kind of KINDS) {
      if (kind === 'no-counterargument') continue
      const { done } = guidanceFor(kind)
      ok(!/\bask (your|a) (teacher|tutor|marker|professor)\b/i.test(done), `${kind}.done defers to someone else`)
    }
  })

  it('keeps each field short enough to read inside a card', () => {
    for (const kind of KINDS) {
      const g = guidanceFor(kind)
      // One line each, not three. At 340 the three fields together came to ~640
      // characters — about 100 words behind a "+ How to fix this" toggle, which
      // the owner read as unskimmable and was right to. 110 is one sentence.
      ok(g.move.length <= 110, `${kind}.move is ${g.move.length} chars`)
      ok(g.why.length <= 110, `${kind}.why is ${g.why.length} chars`)
      ok(g.done.length <= 110, `${kind}.done is ${g.done.length} chars`)
    }
  })
})

describe('COHESION_GUIDANCE', () => {
  it('covers every cohesion finding kind', () => {
    for (const kind of COHESION_KINDS) ok(COHESION_GUIDANCE[kind], `no guidance for ${kind}`)
    strictEqual(Object.keys(COHESION_GUIDANCE).length, COHESION_KINDS.length)
  })

  it('gives all three fields for every kind', () => {
    for (const kind of COHESION_KINDS) {
      const g = cohesionGuidanceFor(kind)
      for (const [field, value] of Object.entries(g)) {
        ok(value.trim().length > 0, `${kind}.${field} is empty`)
      }
    }
  })

  it('phrases every move as an instruction, not a description', () => {
    const DESCRIPTIVE = /^(the|this|there|it|your|a|an)\b/i
    for (const kind of COHESION_KINDS) {
      ok(!DESCRIPTIVE.test(cohesionGuidanceFor(kind).move.trim()), `${kind}.move does not start with a verb`)
    }
  })

  // The same line the weakness guidance holds: describe the move, never supply
  // the sentence. A transition is the easiest place to slip a ready-made clause
  // in, and a pasted "Building on this," is exactly what this must not offer.
  it('never puts a ready-made transition in the move', () => {
    for (const kind of COHESION_KINDS) {
      ok(!/["“”]/.test(cohesionGuidanceFor(kind).move), `${kind}.move quotes a phrase to paste`)
    }
  })

  it('keeps each field short enough to read inside a card', () => {
    for (const kind of COHESION_KINDS) {
      const g = cohesionGuidanceFor(kind)
      for (const [field, value] of Object.entries(g)) {
        ok(value.length <= 340, `${kind}.${field} is ${value.length} chars`)
      }
    }
  })

  // Reordering is a real fix and often the better one - a tool that only ever
  // says "add a transition" teaches students to paper over a structural
  // problem with a sentence.
  it('offers reordering for a topic jump, not just a bridge', () => {
    ok(/move one|reorder/i.test(COHESION_GUIDANCE['topic-jump'].move + COHESION_GUIDANCE['topic-jump'].done))
  })
})
