import { ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { REVISION_GUIDANCE, guidanceFor } from './revisionGuidance.ts'

const KINDS = [
  'no-thesis',
  'unsupported-claim',
  'warrant-gap',
  'new-claim-in-conclusion',
  'evidence-stacking',
  'no-counterargument',
  'no-significance'
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
      // The report's problem card is 3 lines of body text at ~330px. Past ~340
      // characters a field stops being read at all.
      ok(g.move.length <= 340, `${kind}.move is ${g.move.length} chars`)
      ok(g.why.length <= 340, `${kind}.why is ${g.why.length} chars`)
      ok(g.done.length <= 340, `${kind}.done is ${g.done.length} chars`)
    }
  })
})
