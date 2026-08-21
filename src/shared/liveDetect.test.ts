import { describe, it } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import {
  MIN_DETECT_CHARS,
  MIN_DETECT_DELTA_CHARS,
  MIN_DETECT_INTERVAL_MS,
  hasMeaningfulDelta,
  shouldDetectNow
} from './liveDetect.ts'

const draft = (n: number) => 'The study found a clear effect on adolescents. '.repeat(n)
const LONG = draft(4)

const at = (over: Partial<Parameters<typeof shouldDetectNow>[0]> = {}) =>
  shouldDetectNow({
    text: LONG,
    lastDetectedText: null,
    lastDetectAt: null,
    now: 1_000_000,
    ...over
  })

/**
 * This decides when the editor makes a relay call with nobody's finger on the
 * button, so every test here is a bound holding. The asymmetry it is written
 * from: a detection missed costs a redraw the next pause brings anyway, and a
 * detection taken costs money.
 */
describe('shouldDetectNow', () => {
  it('detects a draft nothing has read yet', () => {
    strictEqual(at(), true)
  })

  // Below this there is no claim to find, and firing would burn the interval
  // floor on a sentence fragment.
  it('waits until there is enough draft to be worth a call', () => {
    strictEqual(at({ text: 'Screen time is bad.' }), false)
    strictEqual(at({ text: 'a'.repeat(MIN_DETECT_CHARS - 1) }), false)
    strictEqual(at({ text: 'a'.repeat(MIN_DETECT_CHARS) }), true)
  })

  it('ignores whitespace when measuring the draft', () => {
    strictEqual(at({ text: `   ${' '.repeat(200)}   ` }), false)
  })

  // Fixing a typo and pausing must not re-read the whole document to find the
  // same claims plus one corrected word.
  it('does not re-detect after a small edit', () => {
    strictEqual(at({ lastDetectedText: LONG }), false)
    strictEqual(at({ lastDetectedText: `${LONG}a few more words` }), false)
  })

  /**
   * Exact lengths rather than `draft(n)` counts — one repeat is 46 characters,
   * comfortably under the threshold, and a test that reads as "one more
   * sentence" while measuring 46 would pass or fail for reasons nobody could
   * see. Both sides are trimmed inside the function, so these are built without
   * trailing space.
   */
  const exactly = (n: number) => 'a'.repeat(n)

  it('detects once a sentence-sized amount has changed', () => {
    const before = exactly(MIN_DETECT_CHARS)
    strictEqual(
      at({ text: exactly(MIN_DETECT_CHARS + MIN_DETECT_DELTA_CHARS - 1), lastDetectedText: before }),
      false
    )
    strictEqual(
      at({ text: exactly(MIN_DETECT_CHARS + MIN_DETECT_DELTA_CHARS), lastDetectedText: before }),
      true
    )
  })

  // Deletions count. Cutting a paragraph changes what the draft claims just as
  // much as adding one.
  it('counts a deletion as a change', () => {
    const before = exactly(MIN_DETECT_CHARS + MIN_DETECT_DELTA_CHARS)
    strictEqual(at({ text: exactly(MIN_DETECT_CHARS), lastDetectedText: before }), true)
  })

  /**
   * The idle timer alone bounds nothing — type-pause-type-pause clears it
   * indefinitely, and each pass is a full relay call on the whole document.
   * This floor is the actual ceiling on what live detection can spend.
   */
  it('holds the floor between two detections however much is typed', () => {
    const base = { text: LONG + draft(2), lastDetectedText: LONG, lastDetectAt: 1_000_000 }
    strictEqual(at({ ...base, now: 1_000_000 + MIN_DETECT_INTERVAL_MS - 1 }), false)
    strictEqual(at({ ...base, now: 1_000_000 + MIN_DETECT_INTERVAL_MS }), true)
  })

  // A draft nothing has read is not "unchanged", however long ago the clock
  // says the last detection was.
  it('treats a document with no prior detection as changed', () => {
    strictEqual(hasMeaningfulDelta(LONG, null), true)
    strictEqual(at({ lastDetectedText: null, lastDetectAt: null }), true)
  })

  it('never fires on text identical to what was already read', () => {
    strictEqual(hasMeaningfulDelta(LONG, LONG), false)
    strictEqual(at({ lastDetectedText: LONG, lastDetectAt: 0 }), false)
  })
})
