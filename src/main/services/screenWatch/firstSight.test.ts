import { describe, it } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import { MIN_PREEXISTING_LENGTH, isPreexistingText } from './firstSight.ts'

const PAGE = 'She raised money for the Dutch resistance through silent performances at home.'

describe('isPreexistingText', () => {
  /**
   * The complaint. Switching to a document that already has a page in it waited
   * STABLE_MS (4s) plus a poll interval before anything was analysed — a debounce
   * for typing, applied to text nobody was typing.
   */
  it('skips the debounce for a document that was already open', () => {
    strictEqual(isPreexistingText(true, PAGE), true)
  })

  /**
   * The case the length test exists to protect. Typing into an empty control
   * arrives a character at a time, and firing there analyses half a sentence and
   * then takes the 20s floor — locking out the real analysis. Skipping the
   * debounce must never cost a detection.
   */
  it('makes someone typing from scratch wait, as before', () => {
    strictEqual(isPreexistingText(true, ''), false)
    strictEqual(isPreexistingText(true, 'She raised'), false)
  })

  /**
   * Only the FIRST snapshot. Every later change is an edit to text we have
   * already seen, however long the document is by then.
   */
  it('applies to the first snapshot only, however long the text gets', () => {
    strictEqual(isPreexistingText(false, PAGE), false)
    strictEqual(isPreexistingText(false, PAGE.repeat(20)), false)
  })

  // Trimmed, because a control that returns a screenful of whitespace has no
  // more content than an empty one.
  it('does not count whitespace as a document', () => {
    strictEqual(isPreexistingText(true, ' '.repeat(200)), false)
    strictEqual(isPreexistingText(true, '\n\t  \r\n'), false)
  })

  it('turns over exactly at the length the service would analyse', () => {
    strictEqual(isPreexistingText(true, 'a'.repeat(MIN_PREEXISTING_LENGTH - 1)), false)
    strictEqual(isPreexistingText(true, 'a'.repeat(MIN_PREEXISTING_LENGTH)), true)
  })
})
