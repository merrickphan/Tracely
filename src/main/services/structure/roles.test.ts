import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasClosingSignificance,
  hasSignificanceMarker,
  hasWarrantMarker,
  heuristicRoles,
  looksLikeClosing,
  looksLikeThesis,
  looksLikeTitle,
  looksLikeTopicClaim
} from './roles.ts'

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
    // Mid-draft, where a stakes paragraph is a stakes paragraph.
    strictEqual(
      rolesOf(['Intro.', 'This matters because hiring policy follows it.', 'Some ending.'])[1],
      'significance'
    )
  })

  it('calls the FINAL paragraph a conclusion even when it states the stakes', () => {
    // The two are routinely the same paragraph and only one role can be
    // carried, so the closing position decides. Nothing is lost by this:
    // scoreDraft credits significance from the marker wherever it appears
    // (ScoreSignals.significanceAnywhere), so the essay keeps both components.
    strictEqual(rolesOf(['Intro.', 'This matters because hiring policy follows it.'])[1], 'conclusion')
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

// ---------------------------------------------------------------------------
// The four heuristics added after a competent 4-paragraph essay scored 20/100.
//
// Its whole loss traced to labelling: the conclusion opened with a quotation
// rather than "In conclusion", its "so what" was phrased as legacy rather than
// as implications, and its topic sentences were evaluative — which is exactly
// the kind of sentence claim detection has every reason to pass over, since it
// cannot be checked against a source. The component measuring whether body
// paragraphs are governed by claims was keyed to fact-detection, so the better
// the topic sentence, the less likely it was to count.
// ---------------------------------------------------------------------------

describe('looksLikeClosing', () => {
  it('accepts a conclusion that opens on a quotation and then looks back', () => {
    strictEqual(
      looksLikeClosing(
        '"As you grow older, you will discover that you have two hands." The legacy she left behind resides in film, but she was more than just a pretty face.'
      ),
      true
    )
  })

  it('still accepts the announced form', () => {
    strictEqual(looksLikeClosing('In conclusion, the policy failed on its own terms.'), true)
  })

  // The reason position alone was never enough, and still is not.
  it('rejects a draft that simply stops mid-argument', () => {
    strictEqual(
      looksLikeClosing('The second factor is housing supply. Permits fell by a third between 2019 and 2023.'),
      false
    )
  })

  // These four words were in the marker list for one draft. Each of them alone
  // would have bought a body paragraph ten points.
  it('is not triggered by ordinary words that merely sound retrospective', () => {
    strictEqual(looksLikeClosing('Critics still argue the measure was premature.'), false)
    strictEqual(looksLikeClosing('Today the plant employs four hundred people.'), false)
    strictEqual(looksLikeClosing('He died before the results were published.'), false)
  })
})

describe('hasClosingSignificance', () => {
  it('reads legacy vocabulary as answering "so what?"', () => {
    strictEqual(hasClosingSignificance('The legacy she left behind reshaped how the charity works.'), true)
    strictEqual(hasClosingSignificance('Her name lives on in the fund that carries it.'), true)
  })

  it('still accepts the social-science register', () => {
    strictEqual(hasClosingSignificance('The implications for turnout are considerable.'), true)
  })

  it('does not widen the ROLE-assigning list', () => {
    // Same sentence, different question. Mid-essay this is narration, and
    // hasSignificanceMarker is what roleFor consults — so a body paragraph
    // mentioning a legacy keeps its claim credit instead of being relabelled.
    strictEqual(hasSignificanceMarker('The legacy she left behind reshaped how the charity works.'), false)
  })
})

describe('looksLikeThesis', () => {
  it('accepts a concessive thesis stated as the last sentence of the intro', () => {
    strictEqual(
      looksLikeThesis(
        "Whilst helping others is typically a moral obligation, Hepburn's early struggles sparked a passion that set her apart from celebrities in her time."
      ),
      true
    )
  })

  it('accepts a not-only/but frame', () => {
    strictEqual(looksLikeThesis('The reform was not only late but actively counterproductive.'), true)
  })

  it('rejects a narrative sentence that happens to be long', () => {
    strictEqual(
      looksLikeThesis('She was born to an English father and a Dutch mother in Brussels, Belgium, in 1929.'),
      false
    )
  })
})

describe('looksLikeTopicClaim', () => {
  const noCitations = () => false

  it('accepts an evaluative topic sentence that no fact-check could verify', () => {
    strictEqual(looksLikeTopicClaim('Audrey Hepburn was always naturally inclined to help others.', noCitations), true)
  })

  it('rejects a first sentence that is an attribution', () => {
    strictEqual(
      looksLikeTopicClaim('Smith (2020) was among the first to measure the effect.', (s) => /\(\d{4}\)/.test(s)),
      false
    )
  })

  it('rejects a fragment too short to be governing anything', () => {
    strictEqual(looksLikeTopicClaim('It was late.', noCitations), false)
  })
})

describe('looksLikeTitle', () => {
  // A titled essay puts its title in paragraph 1 and its introduction in
  // paragraph 2, so every position rule read one paragraph too early and the
  // thesis component became unreachable. This essay scored 48 as written and
  // 78 hand-split without its title.
  it('accepts a real essay title', () => {
    strictEqual(looksLikeTitle('More Than a Pretty Face: Audrey Hepburn'), true)
  })

  it('rejects an opening line that ends in a full stop, however short', () => {
    strictEqual(looksLikeTitle('In conclusion.'), false)
    strictEqual(looksLikeTitle('The policy failed.'), false)
  })

  it('rejects a full opening sentence that merely lacks a terminator', () => {
    strictEqual(
      looksLikeTitle(
        'Renewable energy sources now account for nearly a third of global electricity generation and continue to grow'
      ),
      false
    )
  })
})

describe('a titled essay is labelled as though the title were not there', () => {
  it('puts the thesis in paragraph 2 and does not spend it on the title', () => {
    const roles = heuristicRoles({
      paragraphs: paras(
        'More Than a Pretty Face: Audrey Hepburn',
        'She was born in Brussels in 1929. Whilst helping others is a moral obligation, her early struggles sparked a passion that set her apart from her peers.',
        'Hepburn was always naturally inclined to help others. She raised money for the resistance because she had seen the cost of occupation.',
        'The legacy she left behind lives on in the fund that carries her name.'
      ),
      claimsByParagraph: new Map()
    }).roles
    deepStrictEqual(roles, ['unknown', 'thesis', 'claim', 'conclusion'])
  })

  it('still reads an untitled essay from paragraph 1', () => {
    const roles = heuristicRoles({
      paragraphs: paras(
        'Whilst the transition is often framed as inevitable, its pace was set by policy rather than technology, which sets this decade apart.',
        'Storage was always the binding constraint. Costs fell because manufacturing scaled.',
        'In conclusion, the decade will be measured by what was built.'
      ),
      claimsByParagraph: new Map()
    }).roles
    deepStrictEqual(roles, ['thesis', 'claim', 'conclusion'])
  })
})

describe('heuristicRoles — statesClaim', () => {
  function statesClaimOf(texts: string[], claimParagraphs: number[] = []): boolean[] {
    const claimsByParagraph = new Map<number, string[]>(claimParagraphs.map((i) => [i, [`c${i}`]]))
    return heuristicRoles({ paragraphs: paras(...texts), claimsByParagraph }).statesClaim
  }

  /**
   * The heuristic half of the same bug. `roleFor` checks its citation branch
   * before its claim branch — deliberately, so `evidence-stacking` is
   * reachable — so a paragraph carrying two attributions never got as far as
   * looksLikeTopicClaim and its opening assertion went unread. Asking the
   * question separately reads it.
   */
  it('is true for a citation-heavy paragraph that opens with a topic claim', () => {
    const text =
      'Hepburn was remembered far more for the decades after her films than for the films themselves. ' +
      'Smith (2019) traces that shift across three decades of coverage. ' +
      'Jones (2021) follows the same arc through the UNICEF archives.'
    const result = heuristicRoles({
      paragraphs: paras('Intro.', text, 'In conclusion, it mattered.'),
      claimsByParagraph: new Map(),
      // The real detector, near enough — the default fallback misses
      // author-and-year entirely, which is why analyzeStructure injects one.
      hasCitation: (s) => /\(\d{4}\)/.test(s)
    })
    strictEqual(result.roles[1], 'evidence', 'the role should be unchanged')
    strictEqual(result.statesClaim[1], true)
  })

  it('is true wherever a claim was detected', () => {
    deepStrictEqual(statesClaimOf(['One.', 'Two.', 'Three.'], [2]), [false, true, false])
  })

  it('is false for a paragraph that asserts nothing', () => {
    deepStrictEqual(statesClaimOf(['She arrived in 1953, then left again.']), [false])
  })
})
