import { describe, it } from 'node:test'
import { ok, strictEqual } from 'node:assert'
import { POPOVER_CRITIQUE_CHARS, summariseCritique } from './critiqueSummary.ts'

// The real thing, from the preview fixture — markdown, a list, 300+ chars.
const REAL =
  'The cited work is **cross-sectional**, so it cannot separate "screen time causes depression" from "depressed teenagers use their phones more."\n\nTwo ways forward:\n\n- State the *association* rather than the cause.\n- Find a longitudinal source that measures screen time first.'

describe('summariseCritique', () => {
  it('keeps a hover card to about two lines', () => {
    const out = summariseCritique(REAL)!
    ok(out.length <= POPOVER_CRITIQUE_CHARS + 1, `${out.length} chars`)
  })

  it('flattens markdown rather than showing its syntax', () => {
    const out = summariseCritique(REAL)!
    ok(!out.includes('**'), out)
    ok(out.includes('cross-sectional'), out)
  })

  it('ends on a sentence, not mid-clause', () => {
    ok(/[.!?]["'”’)]]*$/.test(summariseCritique(REAL)!), summariseCritique(REAL)!)
  })

  it('leaves a short critique exactly as it is', () => {
    const short = 'This treats a correlation as a cause.'
    strictEqual(summariseCritique(short), short)
  })

  it('does not split on an abbreviation', () => {
    const text =
      'The figure comes from one cohort, e.g. the 2014 Minnesota sample, and the claim generalises well past it to every district in the country, which the source does not support.'
    const out = summariseCritique(text)!
    ok(!out.endsWith('e.g.'), out)
  })

  it('never ends mid-word when there is no sentence break', () => {
    const out = summariseCritique('word '.repeat(80))!
    ok(out.endsWith('…'))
    ok(!/\bwor…$/.test(out), out)
  })

  it('passes null through', () => {
    strictEqual(summariseCritique(null), null)
    strictEqual(summariseCritique(''), null)
  })
})
