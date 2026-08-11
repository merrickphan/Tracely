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

  it('detects "<someone> argue" with a noun in between', () => {
    // The miss that motivated the pattern: the marker list held 'some argue',
    // the draft said "Some instructors argue", nothing matched — and the panel
    // then asserted the draft had no counterargument at all.
    strictEqual(
      rolesOf(['Intro.', 'Some instructors argue that a ban punishes students with disabilities.'])[1],
      'counterargument'
    )
    strictEqual(
      rolesOf(['Intro.', 'Critics of the policy contend that the data is thin.'])[1],
      'counterargument'
    )
    strictEqual(
      rolesOf(['Intro.', 'Many researchers have objected to this framing.'])[1],
      'counterargument'
    )
  })

  it('does not read an ordinary claim as a counterargument', () => {
    // "argue" alone is not the move — the subject has to be someone other than
    // the writer, which is what the leading pronoun/noun group encodes.
    strictEqual(rolesOf(['Intro.', 'I argue that laptops harm attention.'], [2])[1], 'claim')
    // The pattern must not reach across a sentence boundary to find its verb.
    strictEqual(
      rolesOf(['Intro.', 'Some students take notes by hand. Others argue for laptops.'], [2])[1],
      'claim'
    )
  })

  it('labels a run of attributions as evidence, not as a claim', () => {
    // Without this, roleFor could never return 'evidence' at all, and
    // evidence-stacking in weaknesses.ts was unreachable.
    strictEqual(
      rolesOf(
        [
          'Intro.',
          'Mueller and Oppenheimer (2014) found lower conceptual scores. Carter et al. found similar effects.'
        ],
        [2]
      )[1],
      'evidence'
    )
  })

  it('leaves a claim paragraph carrying one citation as a claim', () => {
    // One attribution is a claim citing its source. Two or more is a run of
    // evidence — the distinction evidence-stacking depends on.
    strictEqual(
      rolesOf(['Intro.', 'Laptops lower grades, as Mueller and Oppenheimer (2014) showed.'], [2])[1],
      'claim'
    )
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
