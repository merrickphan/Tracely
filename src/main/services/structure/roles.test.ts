import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasSignificanceMarker, hasWarrantMarker, heuristicRoles } from './roles.ts'

/** Minimal ParagraphSpan builder — only `index` and `text` are read. */
function paras(...texts: string[]): Array<{ index: number; start: number; end: number; text: string }> {
  return texts.map((text, i) => ({ index: i + 1, start: 0, end: text.length, text }))
}

function rolesOf(texts: string[], claimParagraphs: number[] = []): string[] {
  const claimsByParagraph = new Map<number, string[]>(claimParagraphs.map((i) => [i, [`c${i}`]]))
  return heuristicRoles({ paragraphs: paras(...texts), claimsByParagraph }).roles
}

describe('hasWarrantMarker', () => {
  it('accepts a connective in a later sentence', () => {
    strictEqual(hasWarrantMarker('Turnout fell by nine points. Therefore the result was close.'), true)
  })

  it('rejects a connective in the first sentence', () => {
    // "Because X, Y" is the writer stating a claim, not explaining evidence
    // they have already presented. This is the rule that stops every
    // Because-opener scoring full marks for reasoning it never did.
    strictEqual(hasWarrantMarker('Because turnout fell, the result was close.'), false)
  })

  it('rejects a single sentence however it is phrased', () => {
    strictEqual(hasWarrantMarker('This shows the policy worked.'), false)
  })

  it('rejects a paragraph with no connective at all', () => {
    strictEqual(hasWarrantMarker('Turnout fell by nine points. The result was close.'), false)
  })

  it('handles a curly closing quote before the boundary', () => {
    strictEqual(hasWarrantMarker('He called it “a failure.” This suggests the plan was flawed.'), true)
  })

  it('is case insensitive', () => {
    strictEqual(hasWarrantMarker('Turnout fell. THEREFORE the result was close.'), true)
  })
})

describe('hasSignificanceMarker', () => {
  it('finds a so-what phrase anywhere in the paragraph', () => {
    strictEqual(hasSignificanceMarker('This matters because turnout decides the seat.'), true)
  })

  it('is false for a plain restatement', () => {
    strictEqual(hasSignificanceMarker('In short, turnout fell and the result was close.'), false)
  })
})

describe('heuristicRoles — precedence', () => {
  it('labels an opening paragraph that asserts something as the thesis', () => {
    strictEqual(rolesOf(['Remote work lowers productivity.', 'Body.'], [1])[0], 'thesis')
  })

  it('leaves an opening paragraph with no claim unknown', () => {
    // A hook or scene-setting opener is indistinguishable from a missing
    // thesis at this level, so the heuristic declines to answer instead of
    // inventing either verdict.
    strictEqual(rolesOf(['Picture a quiet office in 2019.', 'Body.'])[0], 'unknown')
  })

  it('labels a claim-bearing body paragraph as a claim', () => {
    strictEqual(rolesOf(['Intro.', 'Output per hour fell by 12 percent.', 'End.'], [2])[1], 'claim')
  })

  it('lets an explicit conclusion marker win over position', () => {
    const roles = rolesOf(['Intro.', 'In conclusion, the evidence is mixed.', 'A trailing note.'], [1])
    strictEqual(roles[1], 'conclusion')
  })

  it('does NOT label the last paragraph a conclusion just for being last', () => {
    // A draft that stops mid-argument would otherwise collect a free 10 points
    // for a conclusion it does not have.
    const roles = rolesOf(['Intro.', 'Body.', 'And another body point entirely.'])
    strictEqual(roles[2], 'unknown')
  })

  it('detects a counterargument only at the paragraph opening', () => {
    strictEqual(rolesOf(['Intro.', 'However, critics argue the sample was small.'])[1], 'counterargument')
    // Mid-paragraph "however" is an ordinary contrast between the writer's own
    // points; matching it anywhere labelled nearly every paragraph.
    strictEqual(
      rolesOf(['Intro.', 'The sample was large and well drawn. However, it was old.'])[1],
      'unknown'
    )
  })

  it('ignores a marker word used mid-sentence', () => {
    // The markers are sentence-openers announcing a turn in the argument. As a
    // substring search over the opening 60 characters, ordinary prose that
    // merely contains one was labelled as though it signposted something.
    strictEqual(
      rolesOf(['Intro.', 'The results were positive overall, and the trend held.'], [2])[1],
      'claim'
    )
    strictEqual(
      rolesOf(['Intro.', 'The evidence, however, is not decisive on this point.'], [2])[1],
      'claim'
    )
  })

  it('still allows a marker behind an opening quote or conjunction', () => {
    strictEqual(rolesOf(['Intro.', 'But in conclusion, the policy failed.'])[1], 'conclusion')
    strictEqual(rolesOf(['Intro.', '“However, the sample was small,” they wrote.'])[1], 'counterargument')
  })

  it('does not let one marker match a longer one by prefix', () => {
    // 'in sum' must not fire on 'in summary' by whichever entry is reached
    // first — both are conclusion markers, but the boundary is what stops the
    // same trick mislabelling 'granted' from 'grantedly'.
    strictEqual(rolesOf(['Intro.', 'Grantedly odd phrasing aside, the data holds.'], [2])[1], 'claim')
  })

  it('labels a significance paragraph from its marker', () => {
    strictEqual(rolesOf(['Intro.', 'This matters because hiring policy follows it.'])[1], 'significance')
  })
})

describe('heuristicRoles — output shape', () => {
  it('returns one role and one warrant flag per paragraph', () => {
    const result = heuristicRoles({
      paragraphs: paras('One.', 'Two.', 'Three.'),
      claimsByParagraph: new Map()
    })
    strictEqual(result.roles.length, 3)
    strictEqual(result.warranted.length, 3)
  })

  it('returns all unknown for prose with no signals and no claims', () => {
    deepStrictEqual(rolesOf(['Some prose.', 'More prose.', 'Further prose.']), [
      'unknown',
      'unknown',
      'unknown'
    ])
  })

  it('handles an empty document', () => {
    const result = heuristicRoles({ paragraphs: [], claimsByParagraph: new Map() })
    deepStrictEqual(result.roles, [])
    deepStrictEqual(result.warranted, [])
  })
})
