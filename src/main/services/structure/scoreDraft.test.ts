import { ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { COMPONENT_MAX, scoreDraft, type ScoreSignals } from './scoreDraft.ts'

type Role =
  | 'thesis'
  | 'claim'
  | 'evidence'
  | 'reasoning'
  | 'significance'
  | 'counterargument'
  | 'conclusion'
  | 'transition'
  | 'unknown'

const NO_SIGNALS: ScoreSignals = { soWhatInConclusion: false }

/** `'claim+'` marks a paragraph that also carries a warrant. */
function outline(...specs: string[]): Array<{
  index: number
  role: Role
  hasWarrant: boolean
  claimIds: string[]
}> {
  return specs.map((spec, i) => ({
    index: i + 1,
    role: spec.replace(/\+$/, '') as Role,
    hasWarrant: spec.endsWith('+'),
    claimIds: []
  }))
}

function score(specs: string[], signals: ScoreSignals = NO_SIGNALS): number {
  return scoreDraft(outline(...specs), signals).score
}

function component(specs: string[], key: keyof typeof COMPONENT_MAX): number {
  return scoreDraft(outline(...specs), NO_SIGNALS).components[key]
}

describe('scoreDraft — thesis', () => {
  it('awards full marks for a thesis in the first paragraph', () => {
    strictEqual(component(['thesis', 'claim', 'conclusion'], 'thesis'), COMPONENT_MAX.thesis)
  })

  it('awards full marks for a thesis in the second paragraph', () => {
    strictEqual(component(['transition', 'thesis', 'conclusion'], 'thesis'), COMPONENT_MAX.thesis)
  })

  it('halves it for a thesis buried later', () => {
    strictEqual(
      component(['claim', 'claim', 'thesis', 'conclusion'], 'thesis'),
      COMPONENT_MAX.thesis / 2
    )
  })

  it('awards nothing when there is no thesis', () => {
    strictEqual(component(['claim', 'claim', 'conclusion'], 'thesis'), 0)
  })
})

describe('scoreDraft — governing claims', () => {
  it('awards full marks when half the body carries a claim', () => {
    const specs = ['thesis', 'claim', 'evidence', 'claim', 'evidence', 'conclusion']
    strictEqual(component(specs, 'governingClaims'), COMPONENT_MAX.governingClaims)
  })

  it('awards partial marks below that', () => {
    const specs = ['thesis', 'claim', 'evidence', 'evidence', 'evidence', 'conclusion']
    strictEqual(component(specs, 'governingClaims'), COMPONENT_MAX.governingClaims / 2)
  })

  it('does not exceed full marks when every body paragraph is a claim', () => {
    const specs = ['thesis', 'claim', 'claim', 'claim', 'claim', 'conclusion']
    strictEqual(component(specs, 'governingClaims'), COMPONENT_MAX.governingClaims)
  })

  it('awards nothing for a body with no claims', () => {
    strictEqual(
      component(['thesis', 'evidence', 'evidence', 'conclusion'], 'governingClaims'),
      0
    )
  })

  it('ignores claims in the first and last paragraphs', () => {
    // Those positions are the thesis and conclusion slots; a claim there is
    // scored by those components, not counted twice as body structure.
    strictEqual(component(['claim', 'evidence', 'claim'], 'governingClaims'), 0)
  })
})

describe('scoreDraft — length invariance', () => {
  it('scores 8 and 14 paragraphs with the same proportions identically', () => {
    // The property that stops the score being a word-count proxy. If this
    // fails, padding an essay raises its score.
    //
    // Both bodies are one third claim-bearing (2/6 and 4/12) — deliberately
    // NOT at the component's cap, since two saturated values would match
    // trivially and prove nothing about the ratio.
    const unit = ['claim+', 'evidence+', 'evidence+']
    const short = ['thesis', ...unit, ...unit, 'conclusion']
    const long = ['thesis', ...unit, ...unit, ...unit, ...unit, 'conclusion']
    strictEqual(short.length, 8)
    strictEqual(long.length, 14)
    strictEqual(score(short), score(long))
  })

  it('lowers the score when filler paragraphs are added', () => {
    const tight = ['thesis', 'claim+', 'evidence+', 'conclusion']
    const padded = ['thesis', 'claim+', 'evidence+', 'unknown', 'unknown', 'unknown', 'conclusion']
    strictEqual(score(padded) < score(tight), true)
  })
})

describe('scoreDraft — warrant', () => {
  it('awards full marks when every claim and evidence paragraph is warranted', () => {
    strictEqual(component(['thesis', 'claim+', 'evidence+', 'conclusion'], 'warrant'), COMPONENT_MAX.warrant)
  })

  it('awards half when half of them are', () => {
    strictEqual(
      component(['thesis', 'claim+', 'evidence', 'conclusion'], 'warrant'),
      COMPONENT_MAX.warrant / 2
    )
  })

  it('awards nothing when no paragraph owes a warrant', () => {
    // Averaging over the whole essay instead would hand free marks to a draft
    // that never presents evidence at all.
    strictEqual(component(['thesis', 'transition', 'conclusion'], 'warrant'), 0)
  })

  it('ignores warrants on paragraphs that do not owe one', () => {
    strictEqual(component(['thesis+', 'transition+', 'conclusion+'], 'warrant'), 0)
  })
})

describe('scoreDraft — counterargument, significance, conclusion', () => {
  it('scores counterargument as binary', () => {
    strictEqual(component(['thesis', 'counterargument', 'conclusion'], 'counterargument'), COMPONENT_MAX.counterargument)
    strictEqual(component(['thesis', 'claim', 'conclusion'], 'counterargument'), 0)
  })

  it('does not pay twice for two counterargument paragraphs', () => {
    const specs = ['thesis', 'counterargument', 'counterargument', 'conclusion']
    strictEqual(component(specs, 'counterargument'), COMPONENT_MAX.counterargument)
  })

  it('gives full significance for a dedicated paragraph', () => {
    strictEqual(component(['thesis', 'significance', 'conclusion'], 'significance'), COMPONENT_MAX.significance)
  })

  it('gives half significance for a so-what marker in the conclusion', () => {
    const result = scoreDraft(outline('thesis', 'claim', 'conclusion'), { soWhatInConclusion: true })
    strictEqual(result.components.significance, COMPONENT_MAX.significance / 2)
  })

  it('prefers the dedicated paragraph over the marker rather than adding them', () => {
    const result = scoreDraft(outline('thesis', 'significance', 'conclusion'), {
      soWhatInConclusion: true
    })
    strictEqual(result.components.significance, COMPONENT_MAX.significance)
  })

  it('gives full conclusion marks only in the last position', () => {
    strictEqual(component(['thesis', 'claim', 'conclusion'], 'conclusion'), COMPONENT_MAX.conclusion)
    strictEqual(component(['thesis', 'conclusion', 'claim'], 'conclusion'), COMPONENT_MAX.conclusion / 2)
    strictEqual(component(['thesis', 'claim', 'evidence'], 'conclusion'), 0)
  })
})

describe('scoreDraft — completeness and bounds', () => {
  it('marks a draft incomplete when any paragraph is unknown', () => {
    strictEqual(scoreDraft(outline('thesis', 'unknown', 'conclusion'), NO_SIGNALS).complete, false)
  })

  it('marks a fully labelled draft complete', () => {
    strictEqual(scoreDraft(outline('thesis', 'claim', 'conclusion'), NO_SIGNALS).complete, true)
  })

  it('scores an all-unknown draft 0 and incomplete', () => {
    // Never a confident number over paragraphs nothing has read.
    const result = scoreDraft(outline('unknown', 'unknown', 'unknown'), NO_SIGNALS)
    strictEqual(result.score, 0)
    strictEqual(result.complete, false)
  })

  it('scores an empty document 0 and incomplete', () => {
    const result = scoreDraft([], NO_SIGNALS)
    strictEqual(result.score, 0)
    strictEqual(result.complete, false)
  })

  it('reaches exactly 100 for a draft satisfying every component', () => {
    // Note both claim paragraphs: the counterargument and significance
    // paragraphs sit in the body too, so they dilute the claim ratio they
    // share it with. Reaching 100 genuinely requires half the body to be
    // claim-bearing *including* them, which is the rubric working, not a
    // quirk — an essay is not perfect for having one claim and two asides.
    const specs = ['thesis', 'claim+', 'claim+', 'counterargument', 'significance', 'conclusion']
    strictEqual(score(specs), 100)
  })

  it('never leaves [0, 100] across a spread of shapes', () => {
    const shapes = [
      ['thesis'],
      ['unknown'],
      ['thesis', 'conclusion'],
      ['claim+', 'claim+', 'claim+'],
      ['thesis', 'claim+', 'evidence+', 'counterargument', 'significance', 'conclusion'],
      ['transition', 'transition', 'transition', 'transition']
    ]
    for (const shape of shapes) {
      const value = score(shape, { soWhatInConclusion: true })
      strictEqual(value >= 0 && value <= 100, true, `out of range for ${shape.join(',')}`)
    }
  })
})

describe('scoreDraft — always returns a grade', () => {
  // This suite used to pin the opposite: a draft under three paragraphs was
  // reported `applicable: false` and every surface showed "not enough draft to
  // grade" instead of a number. The case behind that is real and is recorded on
  // `applicable` in scoreDraft.ts — a strong single-paragraph MUN position
  // paper scored 20/100 and was shown an F.
  //
  // Owner's call, 2026-08-16: "Worst case scenario it would be a 0/100, I never
  // want it to say not enough info to grade." So a short draft scores low now,
  // and the components below are what explains the number.
  it('grades a single paragraph rather than declining to', () => {
    const result = scoreDraft(outline('thesis'), NO_SIGNALS)
    strictEqual(result.applicable, true)
    ok(result.score >= 0, 'a one-paragraph draft still gets a number')
  })

  it('grades two paragraphs, which still have no body slice', () => {
    strictEqual(scoreDraft(outline('thesis', 'conclusion'), NO_SIGNALS).applicable, true)
  })

  it('grades from three paragraphs up, where the body slice is non-empty', () => {
    const result = scoreDraft(outline('thesis', 'claim+', 'conclusion'), NO_SIGNALS)
    strictEqual(result.applicable, true)
    ok(result.score > 0, 'a three-paragraph draft should score above zero')
  })

  it('scores a short draft below a full one, since the body components are unreachable', () => {
    // The mechanism the old gate existed to hide, now visible as a number: a
    // one-paragraph draft cannot earn governingClaims, warrant, counterargument
    // or significance, because all four read the slice between first and last.
    const short = scoreDraft(outline('thesis'), NO_SIGNALS)
    const full = scoreDraft(outline('thesis', 'claim+', 'counterargument', 'conclusion'), NO_SIGNALS)
    ok(short.score < full.score, `short ${short.score} should be under full ${full.score}`)
    strictEqual(short.components.governingClaims, 0)
    strictEqual(short.components.warrant, 0)
  })

  it('reports an empty draft as 0, not as ungradeable', () => {
    const result = scoreDraft(outline(), NO_SIGNALS)
    strictEqual(result.applicable, true)
    strictEqual(result.score, 0)
  })
})

describe('a title is not an unread paragraph', () => {
  // The title is 'unknown' by rights - it states no claim. Counting it as
  // unlabelled made every titled essay "provisional", and weaknesses.ts
  // withholds all whole-draft findings while anything is unlabelled: a student
  // who titled their work got a score and no feedback at all, including no
  // "this draft has no counterargument".
  const titled = outline('unknown', 'thesis', 'claim+', 'evidence+', 'conclusion')

  it('reads as complete when the leading unknown is the title', () => {
    strictEqual(scoreDraft(titled, { soWhatInConclusion: true, titleParagraph: true }).complete, true)
  })

  it('still reads as provisional when it is a genuinely unlabelled paragraph', () => {
    strictEqual(scoreDraft(titled, { soWhatInConclusion: true, titleParagraph: false }).complete, false)
  })

  it('does not excuse an unknown anywhere else', () => {
    const midGap = outline('unknown', 'thesis', 'unknown', 'conclusion')
    strictEqual(scoreDraft(midGap, { soWhatInConclusion: true, titleParagraph: true }).complete, false)
  })
})
