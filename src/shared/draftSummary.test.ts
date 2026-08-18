import { match, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { summariseDraft } from './draftSummary.ts'

const full = {
  thesis: 20,
  governingClaims: 20,
  warrant: 20,
  counterargument: 15,
  significance: 15,
  conclusion: 10
}

const base = { complete: true, withOwnCitation: 4, detected: 4 }

describe('summariseDraft', () => {
  it('names the component holding the most points, not the lowest fraction', () => {
    // warrant is at half of 20 (10 points away); conclusion is at ZERO but only
    // 10 points away. Ranking by fraction would send the writer to the cheaper
    // repair, so the points have to win.
    const text = summariseDraft({
      ...base,
      score: 70,
      components: { ...full, warrant: 10, conclusion: 0 }
    })
    match(text, /reasoning that links evidence to claims/)
  })

  it('states the counterfactual as real arithmetic on the rubric', () => {
    // 62 + (20 - 6) = 76. Not encouragement — exactly what the score becomes if
    // that one component reaches full marks and nothing else changes.
    const text = summariseDraft({
      ...base,
      score: 62,
      components: { ...full, warrant: 6 }
    })
    match(text, /6 of 20/)
    match(text, /would put this at 76/)
  })

  it('opens differently by band', () => {
    const high = summariseDraft({ ...base, score: 88, components: full })
    const low = summariseDraft({ ...base, score: 40, components: { ...full, thesis: 0, warrant: 0 } })
    ok(high !== low)
    match(high, /good shape/)
    match(low, /notes rather than/)
  })

  it('says the reading is provisional when any paragraph was unlabelled', () => {
    const text = summariseDraft({ ...base, score: 74, components: full, complete: false })
    match(text, /provisional/)
    // Last, so nothing after it reads as confident over a partial reading.
    ok(text.trimEnd().endsWith('provisional.'))
  })

  it('reports unattributed claims without needing a search to have run', () => {
    const text = summariseDraft({ ...base, score: 74, components: full, withOwnCitation: 1, detected: 4 })
    match(text, /3 of 4 detected claims read as unattributed/)
  })

  it('says nothing about citations when every claim carries one', () => {
    const text = summariseDraft({ ...base, score: 90, components: full })
    ok(!text.includes('unattributed'))
  })

  it('omits the counterfactual for a draft already at full marks', () => {
    const text = summariseDraft({ ...base, score: 100, components: full })
    ok(!text.includes('would put this at'))
  })

  it('is a single deterministic string', () => {
    const input = { ...base, score: 74, components: { ...full, warrant: 8 } }
    strictEqual(summariseDraft(input), summariseDraft(input))
  })
})
