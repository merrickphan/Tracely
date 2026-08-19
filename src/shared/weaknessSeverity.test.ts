import { describe, it } from 'node:test'
import { ok, strictEqual } from 'node:assert'
import { isSubstantive, needsWork } from './weaknessSeverity.ts'

/**
 * Owner, 2026-08-19: "too many paragraphs are being flagged as 'needs work'…
 * It feels like the system is flagging things just for the sake of flagging
 * them."
 *
 * The badge used to be `issues.length === 0`, so one "obviously" printed the
 * same NEEDS WORK as a circular argument.
 */
describe('needsWork', () => {
  it('is quiet for a paragraph carrying only notes', () => {
    strictEqual(needsWork(['unsupported-emphasis']), false)
    strictEqual(needsWork(['generic-opening', 'malformed-citation']), false)
    strictEqual(needsWork(['undeveloped-repetition']), false)
  })

  it('fires for a hole in the argument', () => {
    for (const kind of [
      'no-thesis',
      'warrant-gap',
      'circular-reasoning',
      'sequence-as-cause',
      'single-case-generalisation',
      'logical-leap',
      'dropped-evidence',
      'off-thesis-paragraph',
      'unsupported-claim',
      'summary-without-point'
    ] as const) {
      strictEqual(needsWork([kind]), true, kind)
    }
  })

  it('fires when a real problem sits among notes', () => {
    strictEqual(needsWork(['unsupported-emphasis', 'logical-leap', 'generic-opening']), true)
  })

  it('is quiet for a paragraph with nothing to say about it', () => {
    strictEqual(needsWork([]), false)
  })

  // The default direction. A finding added later is loud until someone decides
  // it is a note — a real problem shown quietly is worse than a small one shown
  // loudly.
  it('treats an unlisted kind as substantive', () => {
    ok(isSubstantive('something-new-nobody-triaged' as never))
  })
})
