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

describe('scoreDraft — refuses to grade a draft the rubric cannot measure', () => {
  // A real single-paragraph MUN position paper — nine sentences, five
  // citations, a thesis and a close — scored 20/100 and was shown an F. Four of
  // the six components read `roles.slice(1, -1)` or the paragraphs inside it,
  // which is empty for a one-paragraph draft, so 80 points were unreachable
  // however good the writing was.
  it('reports a single paragraph as unmeasurable rather than failing it', () => {
    const result = scoreDraft(outline('thesis'), NO_SIGNALS)
    strictEqual(result.applicable, false)
    strictEqual(result.score, 0)
  })

  it('does the same for two paragraphs, which still have no body', () => {
    strictEqual(scoreDraft(outline('thesis', 'conclusion'), NO_SIGNALS).applicable, false)
  })

  it('grades from three paragraphs up, where the body slice is non-empty', () => {
    const result = scoreDraft(outline('thesis', 'claim+', 'conclusion'), NO_SIGNALS)
    strictEqual(result.applicable, true)
    ok(result.score > 0, 'a three-paragraph draft should score above zero')
  })

  it('zeroes every component when it declines, so no partial number leaks out', () => {
    const { components } = scoreDraft(outline('thesis'), NO_SIGNALS)
    for (const [name, value] of Object.entries(components)) {
      strictEqual(value, 0, `${name} should be 0 when the rubric does not apply`)
    }
  })

  it('is not applicable for an empty draft either', () => {
    strictEqual(scoreDraft(outline(), NO_SIGNALS).applicable, false)
  })
})
