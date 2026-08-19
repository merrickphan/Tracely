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

/**
 * `'claim+'` marks a paragraph that also carries a warrant. `'evidence*'` marks
 * one the labeller said states a claim of its own, `'claim-'` one it said does
 * not.
 *
 * A spec with NEITHER marker leaves `statesClaim` undefined on purpose — that
 * is a stored outline from before the field existed, and every test written
 * before it is therefore also the compatibility test for the fallback.
 */
function outline(...specs: string[]): Array<{
  index: number
  role: Role
  hasWarrant: boolean
  statesClaim?: boolean
  claimIds: string[]
}> {
  return specs.map((spec, i) => {
    const states = spec.includes('*') ? true : spec.includes('-') ? false : undefined
    return {
      index: i + 1,
      role: spec.replace(/[+*-]/g, '') as Role,
      hasWarrant: spec.includes('+'),
      ...(states === undefined ? {} : { statesClaim: states }),
      claimIds: []
    }
  })
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

describe('governingClaims reads statesClaim, not the role', () => {
  /**
   * The bug, in one assertion. Both body paragraphs open with an evaluative
   * sub-point and then cite for it, so both labellers call them `evidence` —
   * the model because it is told to report the DOMINANT role, the heuristics
   * because their citation branch is checked before their claim branch. The
   * component that asks "is this body governed by claims?" answered no about
   * an essay whose body paragraphs are nothing but.
   */
  it('credits an evidence paragraph that states its own claim', () => {
    const specs = ['thesis', 'evidence*', 'evidence*', 'conclusion']
    strictEqual(component(specs, 'governingClaims'), COMPONENT_MAX.governingClaims)
    // And without the field — a stored outline, or a relay a deploy behind —
    // it scores what it always scored.
    strictEqual(component(['thesis', 'evidence', 'evidence', 'conclusion'], 'governingClaims'), 0)
  })

  it('withholds credit from a claim paragraph the labeller says restates an earlier one', () => {
    strictEqual(component(['thesis', 'claim-', 'claim-', 'conclusion'], 'governingClaims'), 0)
  })

  it('still measures a fraction of the body, so padding lowers it', () => {
    strictEqual(
      component(['thesis', 'evidence*', 'evidence', 'evidence', 'conclusion'], 'governingClaims'),
      COMPONENT_MAX.governingClaims / 2
    )
  })

  /**
   * The four roles with somewhere else to earn their points. Without this gate
   * a draft could collect governingClaims for its counterargument and its
   * significance paragraph — both of which assert something contestable by
   * construction — and be paid twice for one paragraph.
   */
  it('does not credit roles that have their own component', () => {
    for (const role of ['counterargument', 'significance', 'transition', 'thesis']) {
      strictEqual(
        component(['thesis', `${role}*`, 'evidence', 'conclusion'], 'governingClaims'),
        0,
        `${role} was credited as a governing claim`
      )
    }
  })

  /**
   * The one that would quietly undo `unknown`-is-a-real-answer. A labeller that
   * could not say what a paragraph does has not established that it governs
   * anything, and a `statesClaim: true` on an unlabelled paragraph would turn
   * "we could not read this" into 20 points.
   */
  it('does not credit an unknown paragraph', () => {
    strictEqual(component(['thesis', 'unknown*', 'unknown*', 'conclusion'], 'governingClaims'), 0)
  })

  it('counts reasoning paragraphs, which do argue a point of their own', () => {
    strictEqual(
      component(['thesis', 'reasoning*', 'evidence', 'conclusion'], 'governingClaims'),
      COMPONENT_MAX.governingClaims
    )
  })
})

describe('thesis position is a fraction of the draft, not paragraph 1 or 2', () => {
  /**
   * The rule the absolute test was written for. Every draft short enough for
   * "paragraph 1 or 2" to have been a sensible way to say "up front" scores
   * exactly as it did — this is the compatibility half, and the eval corpus
   * (15 essays, none over six paragraphs) does not move at all.
   */
  it('is unchanged on a short essay', () => {
    strictEqual(component(['thesis', 'claim', 'conclusion'], 'thesis'), COMPONENT_MAX.thesis)
    strictEqual(
      component(['transition', 'thesis', 'claim', 'conclusion'], 'thesis'),
      COMPONENT_MAX.thesis
    )
    strictEqual(
      component(['claim', 'claim', 'thesis', 'conclusion'], 'thesis'),
      COMPONENT_MAX.thesis / 2
    )
  })

  /**
   * A 14-paragraph essay that spends four paragraphs establishing what the
   * literature says and states its thesis in the fifth was docked ten points,
   * by the same rule that gives full marks to a three-paragraph draft asserting
   * its thesis in line one. Earning a thesis is not burying it.
   */
  it('gives full marks to a thesis in the first third of a long draft', () => {
    const long = [
      'unknown',
      'evidence',
      'evidence',
      'evidence',
      'thesis',
      'claim',
      'claim',
      'claim',
      'claim',
      'counterargument',
      'counterargument',
      'claim',
      'reasoning',
      'conclusion'
    ]
    strictEqual(component(long, 'thesis'), COMPONENT_MAX.thesis)
  })

  it('still halves a thesis in the back of a long draft', () => {
    // Paragraph 10 of 14 really is a discovery the reader had to make unaided.
    const buried = [
      'unknown',
      'evidence',
      'evidence',
      'evidence',
      'claim',
      'claim',
      'claim',
      'claim',
      'claim',
      'thesis',
      'claim',
      'claim',
      'reasoning',
      'conclusion'
    ]
    strictEqual(component(buried, 'thesis'), COMPONENT_MAX.thesis / 2)
  })
})

describe('warrant counts reasoning paragraphs', () => {
  /**
   * A `reasoning` paragraph IS the warrant — the classifier's own definition is
   * "explains how evidence bears on a claim, or works through an implication,
   * no new evidence and no new claim". Leaving the role out of `owed` meant a
   * draft that spent whole paragraphs on the link between its evidence and its
   * claim earned nothing for them, while one that wrote "therefore" once inside
   * a claim paragraph earned full marks.
   *
   * Only reachable on the model path: `heuristicRoles` never returns
   * 'reasoning', which is why this went unnoticed.
   */
  it('counts a reasoning paragraph as owed and satisfied', () => {
    strictEqual(
      component(['thesis', 'reasoning', 'conclusion'], 'warrant'),
      COMPONENT_MAX.warrant
    )
  })

  it('does not require hasWarrant on a reasoning paragraph', () => {
    // Asking the model whether the paragraph whose whole job is the explanation
    // also signposts its explanation gets `false` often enough that gating on
    // it would make the role cost points rather than earn them.
    strictEqual(
      component(['thesis', 'reasoning', 'claim+', 'conclusion'], 'warrant'),
      COMPONENT_MAX.warrant
    )
  })

  it('still dilutes the ratio with unwarranted claim and evidence paragraphs', () => {
    strictEqual(
      component(['thesis', 'reasoning', 'claim', 'conclusion'], 'warrant'),
      COMPONENT_MAX.warrant / 2
    )
  })

  it('leaves a draft with no reasoning paragraphs exactly where it was', () => {
    strictEqual(
      component(['thesis', 'claim+', 'evidence', 'conclusion'], 'warrant'),
      COMPONENT_MAX.warrant / 2
    )
  })
})

/**
 * The Hepburn essay, 2026-08-19 — the case that produced this fallback.
 *
 * The classifier's real answer for it, read out of the preview build's stored
 * outline: the introduction came back `claim` rather than `thesis`, and both
 * body paragraphs came back `evidence` with `statesClaim` false even though
 * each opens with its own topic sentence. That scored 48/100 — thesis 0/20 and
 * governing claims 10/20 — on a draft with a thesis in the last sentence of its
 * introduction and a claim at the head of every body paragraph.
 *
 * The numbers here are the two ends of that: what the vector alone scores, and
 * what it scores once the local reader's two NON-ROLE signals are honoured.
 */
describe('a thesis the role vector did not name', () => {
  // Role, statesClaim and warrant exactly as stored: the introduction is
  // `claim` (not `thesis`), and neither body paragraph is credited with
  // stating one.
  const MODEL = ['unknown', 'claim*+', 'evidence-+', 'evidence-+', 'conclusion*+']

  it('scores 0 for thesis when nothing is labelled thesis and there is no fallback', () => {
    strictEqual(component(MODEL, 'thesis'), 0)
  })

  it('credits the local reader when the vector names no thesis', () => {
    // Paragraph 2, 0-based 1 — the introduction behind the title.
    strictEqual(
      scoreDraft(outline(...MODEL), { ...NO_SIGNALS, titleParagraph: true, thesisFallbackIndex: 1 })
        .components.thesis,
      20
    )
  })

  it('never overrides a thesis the vector DID name', () => {
    // The fallback points at the conclusion; the label wins, and scores full
    // marks for being up front rather than half for being last.
    strictEqual(
      scoreDraft(outline('thesis+', 'evidence+', 'conclusion+'), {
        ...NO_SIGNALS,
        thesisFallbackIndex: 2
      }).components.thesis,
      20
    )
  })

  it('ignores a fallback outside the draft', () => {
    strictEqual(
      scoreDraft(outline('evidence+', 'evidence+'), { ...NO_SIGNALS, thesisFallbackIndex: 9 })
        .components.thesis,
      0
    )
    strictEqual(
      scoreDraft(outline('evidence+', 'evidence+'), { ...NO_SIGNALS, thesisFallbackIndex: null })
        .components.thesis,
      0
    )
  })

  it('scores the whole essay 48 before and 78 after', () => {
    const signals = { ...NO_SIGNALS, titleParagraph: true, soWhatInConclusion: true }
    strictEqual(scoreDraft(outline(...MODEL), signals).score, 48)

    // statesClaim unioned with the local reader's answer, which sees a topic
    // claim at the head of both body paragraphs.
    const unioned = ['unknown', 'claim*+', 'evidence*+', 'evidence*+', 'conclusion*+']
    strictEqual(
      scoreDraft(outline(...unioned), { ...signals, thesisFallbackIndex: 1 }).score,
      78
    )
  })
})

/**
 * The one prose finding that reaches this file directly. The other —
 * `dropped-evidence` — never arrives as a signal at all: it vetoes `hasWarrant`
 * in `analyzeStructure` before the outline is built, so from here it is
 * indistinguishable from a model that said false. That asymmetry is deliberate;
 * see the note on ScoreSignals.conclusionRestatesThesis.
 */
describe('scoreDraft — a conclusion that restates the thesis', () => {
  const CLOSED = ['thesis', 'claim+', 'counterargument', 'significance', 'conclusion']

  it('halves a well-placed conclusion', () => {
    strictEqual(scoreDraft(outline(...CLOSED), NO_SIGNALS).components.conclusion, 10)
    strictEqual(
      scoreDraft(outline(...CLOSED), { ...NO_SIGNALS, conclusionRestatesThesis: true }).components
        .conclusion,
      5
    )
  })

  it('compounds with a misplaced one rather than replacing it', () => {
    const misplaced = ['thesis', 'conclusion', 'claim+', 'significance', 'counterargument']
    strictEqual(scoreDraft(outline(...misplaced), NO_SIGNALS).components.conclusion, 5)
    strictEqual(
      scoreDraft(outline(...misplaced), { ...NO_SIGNALS, conclusionRestatesThesis: true })
        .components.conclusion,
      2.5
    )
  })

  it('cannot invent credit for a draft with no conclusion at all', () => {
    const none = ['thesis', 'claim+', 'counterargument', 'significance', 'evidence+']
    strictEqual(
      scoreDraft(outline(...none), { ...NO_SIGNALS, conclusionRestatesThesis: true }).components
        .conclusion,
      0
    )
  })

  it('costs the draft five points and nothing else', () => {
    const plain = scoreDraft(outline(...CLOSED), NO_SIGNALS)
    const restated = scoreDraft(outline(...CLOSED), {
      ...NO_SIGNALS,
      conclusionRestatesThesis: true
    })
    strictEqual(plain.score - restated.score, 5)
    for (const key of ['thesis', 'governingClaims', 'warrant', 'counterargument', 'significance'] as const) {
      strictEqual(restated.components[key], plain.components[key], key)
    }
  })
})

describe('scoreDraft — a topic where a thesis should be', () => {
  const CLOSED = ['thesis', 'claim+', 'counterargument', 'significance', 'conclusion']

  it('halves the thesis component', () => {
    strictEqual(scoreDraft(outline(...CLOSED), NO_SIGNALS).components.thesis, 20)
    strictEqual(
      scoreDraft(outline(...CLOSED), { ...NO_SIGNALS, thesisStatesTopicOnly: true }).components
        .thesis,
      10
    )
  })

  it('compounds with a late thesis rather than replacing it', () => {
    const late = ['evidence+', 'evidence+', 'evidence+', 'thesis', 'conclusion']
    strictEqual(scoreDraft(outline(...late), NO_SIGNALS).components.thesis, 10)
    strictEqual(
      scoreDraft(outline(...late), { ...NO_SIGNALS, thesisStatesTopicOnly: true }).components.thesis,
      5
    )
  })

  it('cannot invent credit for a draft with no thesis at all', () => {
    strictEqual(
      scoreDraft(outline('evidence+', 'evidence+'), { ...NO_SIGNALS, thesisStatesTopicOnly: true })
        .components.thesis,
      0
    )
  })
})

/**
 * The complaint this answers, 2026-08-19: "Can these all be 100%? Besides
 * significance and counterargument, it just doesn't make sense."
 *
 * Four of the six components were pure presence checks, so an essay with an
 * introduction, a claim, a marker word and a last paragraph scored 20/20/20/10
 * on all four. Two of them now have a quality axis, which is what makes a
 * perfect component mean something.
 */
describe('scoreDraft — the components no longer saturate on presence alone', () => {
  const SHAPED = ['thesis', 'claim+', 'counterargument', 'significance', 'conclusion']

  it('still gives full marks to a draft that does the work', () => {
    const { components } = scoreDraft(outline(...SHAPED), NO_SIGNALS)
    strictEqual(components.thesis, 20)
    strictEqual(components.conclusion, 10)
  })

  it('drops both for the same draft written as an announcement and a restatement', () => {
    const { components, score } = scoreDraft(outline(...SHAPED), {
      ...NO_SIGNALS,
      thesisStatesTopicOnly: true,
      conclusionRestatesThesis: true
    })
    strictEqual(components.thesis, 10)
    strictEqual(components.conclusion, 5)
    strictEqual(scoreDraft(outline(...SHAPED), NO_SIGNALS).score - score, 15)
  })
})
