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

  it('does not find "thus" inside "enthusiasm"', () => {
    // The marker list was matched with String.includes, so every one of these
    // ordinary sentences counted as a reasoning connective — worth up to 20 of
    // the 100 points, and enough to suppress the paragraph's warrant-gap.
    strictEqual(hasWarrantMarker('Turnout fell. Enthusiasm for the policy grew.'), false)
    strictEqual(hasWarrantMarker('Turnout fell. The students were enthusiastic.'), false)
    strictEqual(hasWarrantMarker('Turnout fell. He was an enthusiast of the method.'), false)
    // Still found when it is actually the word.
    strictEqual(hasWarrantMarker('Turnout fell. Thus the result was close.'), true)
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

describe('heuristicRoles — citation detection is injected, not duplicated', () => {
  // The local fallback pattern requires a bare parenthesised year, so it found
  // 0 of the 5 citations in a real MUN position paper: (Tyche Hendricks, 2024)
  // has the author inside the bracket, and ("Background to the Convention") has
  // no year at all. With the count stuck at 0 the 'evidence' role was
  // unreachable, which made warrant unearnable and evidence-stacking dead code.
  const MLA = [
    'Migration policy is contested.',
    'Migrants fear deportation and discrimination (Tyche Hendricks, 2024). ' +
      'The convention guarantees fair pay and fair trial ("Background to the Convention"). ' +
      'Objective 17 works to eliminate hate speech ("International Migration.").',
    'The gap between norms and daily life remains wide.'
  ]

  it('cannot see real citation styles with the fallback pattern', () => {
    const roles = heuristicRoles({
      paragraphs: paras(...MLA),
      claimsByParagraph: new Map()
    }).roles
    strictEqual(roles[1], 'unknown')
  })

  it('labels the same paragraph evidence when given a real detector', () => {
    const roles = heuristicRoles({
      paragraphs: paras(...MLA),
      claimsByParagraph: new Map(),
      hasCitation: (sentence) => /\(["“]?[A-Z]/.test(sentence)
    }).roles
    strictEqual(roles[1], 'evidence')
  })

  it('counts sentences, not matches, so one sentence citing twice is not a run', () => {
    const roles = heuristicRoles({
      paragraphs: paras(
        'Opening.',
        'One sentence citing two papers (Smith, 2020; Jones, 2021).',
        'Closing.'
      ),
      claimsByParagraph: new Map(),
      hasCitation: (sentence) => /\(["“]?[A-Z]/.test(sentence)
    }).roles
    strictEqual(roles[1], 'unknown')
  })
})

describe('hasWarrantMarker — causal connectives, not just signposts', () => {
  // A nine-sentence position paper reasoning causally throughout scored 0 of 20
  // for warrant because it never wrote the word "therefore".
  const warranting = [
    'Migrants avoid care. They fear speaking out due to risks to their livelihood.',
    'Costs rose. The increase stems from a shortage of housing near transit.',
    'Turnout fell. The drop is driven by the new registration deadline.',
    'Emissions dropped. The change results in cleaner air downwind.'
  ]
  for (const text of warranting) {
    it(`accepts: ${text.slice(text.indexOf('. ') + 2, text.indexOf('. ') + 44)}…`, () => {
      strictEqual(hasWarrantMarker(text), true)
    })
  }

  it('still rejects a bare temporal "as", which is not causal', () => {
    strictEqual(hasWarrantMarker('Costs rose. As many as 20% of tenants moved away.'), false)
  })
})
