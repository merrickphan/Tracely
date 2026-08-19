import { describe, it } from 'node:test'
import { deepStrictEqual, strictEqual, ok } from 'node:assert'
import {
  conclusionDrawsOnBody,
  conclusionRestatesThesis,
  droppedEvidenceParagraphs,
  findReasoningIssues,
  type ReasoningIssueKind,
  type ReasoningParagraph
} from './reasoningIssues.ts'
import type { ParagraphRole } from '../../../shared/types.ts'

/**
 * The negative cases matter more than the positive ones here.
 *
 * Every rule in this module fires on a student's own sentence and tells them it
 * is weak reasoning. A false positive is not a missed feature, it is the tool
 * being wrong about the thing it exists to judge — so each detector below is
 * tested against the ordinary English that a careless version of it would flag,
 * and those cases outnumber the hits deliberately.
 */

const para = (text: string, role: ParagraphRole = 'evidence'): ReasoningParagraph => ({
  index: 0,
  text,
  role
})

/** Paragraphs numbered 1..n, so `paragraphIndex` in a finding is readable. */
function run(
  paragraphs: ReasoningParagraph[],
  options: { thesisIndex?: number | null; titleParagraph?: boolean } = {}
): ReasoningIssueKind[] {
  return findReasoningIssues({
    paragraphs: paragraphs.map((p, i) => ({ ...p, index: i + 1 })),
    thesisIndex: options.thesisIndex ?? null,
    titleParagraph: options.titleParagraph
  }).map((f) => f.kind)
}

function findingsFor(
  paragraphs: ReasoningParagraph[],
  options: { thesisIndex?: number | null; titleParagraph?: boolean } = {}
) {
  return findReasoningIssues({
    paragraphs: paragraphs.map((p, i) => ({ ...p, index: i + 1 })),
    thesisIndex: options.thesisIndex ?? null,
    titleParagraph: options.titleParagraph
  })
}

// A neutral filler paragraph for the slots a test does not care about. Long
// enough to be a real paragraph, and carefully free of anything any rule fires
// on — if this ever starts producing findings, a rule has grown too wide.
const FILLER =
  'The studio released the film in the spring of that year. Reviewers responded to the performance rather than to the script. Box office receipts recovered slowly over the following months.'

describe('findReasoningIssues — dropped evidence', () => {
  it('flags a paragraph whose last sentence is the citation', () => {
    const kinds = run([
      para('Rationing shaped her early years.'),
      para(
        'Her wartime childhood left lasting marks on her health. Sustained malnutrition during the occupation produced anaemia and respiratory illness (Walker, 2010).',
        'evidence'
      )
    ])
    ok(kinds.includes('dropped-evidence'))
  })

  it('flags a paragraph ending on a substantial quotation', () => {
    const kinds = run([
      para(FILLER),
      para(
        'She described the period in her own terms. She later said "we ate tulip bulbs and green bread made from peas".',
        'evidence'
      )
    ])
    ok(kinds.includes('dropped-evidence'))
  })

  it('does not flag a paragraph that explains the evidence after citing it', () => {
    const kinds = run([
      para(FILLER),
      para(
        'Her wartime childhood left lasting marks on her health. Sustained malnutrition produced anaemia (Walker, 2010). That physical fragility is what later made her presence on screen read as delicacy rather than glamour.',
        'evidence'
      )
    ])
    ok(!kinds.includes('dropped-evidence'))
  })

  it('does not flag a one-sentence paragraph', () => {
    const kinds = run([para(FILLER), para('Malnutrition produced lasting anaemia (Walker, 2010).', 'evidence')])
    ok(!kinds.includes('dropped-evidence'))
  })

  it('does not flag a conclusion or a counterargument that closes on a source', () => {
    for (const role of ['conclusion', 'counterargument'] as ParagraphRole[]) {
      const kinds = run([
        para(FILLER),
        para(
          'Her charity work outlasted the films. It is the part of the record most often set aside (Walker, 2010).',
          role
        )
      ])
      ok(!kinds.includes('dropped-evidence'), role)
    }
  })

  it('does not read an ordinary parenthetical as a citation', () => {
    const kinds = run([
      para(FILLER),
      para(
        'She worked through the last decade of her life. She travelled to twenty countries in five years (an itinerary few would attempt).',
        'evidence'
      )
    ])
    // A bare parenthetical with no year and no page reference is prose, not a
    // reference — this is the case that decides whether the rule is usable.
    ok(!kinds.includes('dropped-evidence'))
  })
})

describe('findReasoningIssues — overreaching claims', () => {
  it('flags absolutes the argument cannot earn', () => {
    for (const sentence of [
      'Celebrity advocacy always produces measurable donations.',
      'Everyone recognised her by the end of the decade.',
      'The record proves that her later work mattered more.',
      'All people respond to that kind of appeal.'
    ]) {
      ok(run([para(FILLER), para(`Her later career changed the pattern. ${sentence}`)]).includes('overreaching-claim'), sentence)
    }
  })

  it('does not flag an absolute the writer already hedged', () => {
    for (const sentence of [
      'Celebrity advocacy does not always produce measurable donations.',
      'Almost everyone recognised her by the end of the decade.',
      'The archive rarely proves anything so directly.'
    ]) {
      ok(!run([para(FILLER), para(`Her later career changed the pattern. ${sentence}`)]).includes('overreaching-claim'), sentence)
    }
  })

  it('does not flag "all" or "every" in ordinary use', () => {
    const kinds = run([
      para(FILLER),
      para('She visited every country on the itinerary. All of the evidence points the same way.')
    ])
    ok(!kinds.includes('overreaching-claim'))
  })

  it('does not flag an absolute inside a quotation — those are the source\'s words', () => {
    const kinds = run([
      para(FILLER),
      para(
        'She was asked about the pattern directly. "I have always believed that people help when they are shown how," she told the interviewer, and the phrasing stuck.'
      )
    ])
    ok(!kinds.includes('overreaching-claim'))
  })

  it('reports one finding per paragraph however many absolutes it holds', () => {
    const found = findingsFor([
      para(FILLER),
      para('She always went. Everyone knew. It proves the point entirely. She never stopped.')
    ]).filter((f) => f.kind === 'overreaching-claim')
    strictEqual(found.length, 1)
  })
})

describe('findReasoningIssues — emphasis without argument', () => {
  it('flags a judgement asserted instead of argued', () => {
    for (const sentence of [
      'Obviously the second campaign mattered more.',
      'The effect on donations was massive.',
      'Her influence was undeniably the larger of the two.'
    ]) {
      ok(run([para(FILLER), para(`The two campaigns differed. ${sentence}`)]).includes('unsupported-emphasis'), sentence)
    }
  })

  it('does not flag ordinary description', () => {
    const kinds = run([
      para(FILLER),
      para('The campaign raised a large sum. Donations rose by a third over two years, which the report attributes to the tour.')
    ])
    ok(!kinds.includes('unsupported-emphasis'))
  })
})

describe('findReasoningIssues — unclear reference', () => {
  it('flags a paragraph opening on a bare demonstrative', () => {
    const kinds = run([para(FILLER), para('This shows that the campaign changed public attitudes. ' + FILLER)])
    ok(kinds.includes('unclear-reference'))
  })

  it('does not flag a demonstrative that names what it points at', () => {
    const kinds = run([
      para(FILLER),
      para('This shift in donation patterns shows that the campaign changed public attitudes. ' + FILLER)
    ])
    ok(!kinds.includes('unclear-reference'))
  })

  it('does not flag one mid-paragraph, where the antecedent is the sentence before', () => {
    const kinds = run([
      para(FILLER),
      para('Donations rose by a third in two years. This shows the tour reached an audience the mailings had not.')
    ])
    ok(!kinds.includes('unclear-reference'))
  })

  it('does not flag the first paragraph, which has nothing behind it', () => {
    const kinds = run([para('This shows the pattern held. ' + FILLER), para(FILLER)])
    ok(!kinds.includes('unclear-reference'))
  })
})

describe('findReasoningIssues — restated conclusion', () => {
  const thesis =
    'Hepburn is remembered as a film star, but her humanitarian work reshaped how celebrity advocacy operates, and that legacy outlasted her performances.'

  it('flags a conclusion that reuses the thesis vocabulary', () => {
    const kinds = run(
      [
        para(thesis, 'thesis'),
        para(FILLER, 'evidence'),
        para(
          'Hepburn is remembered as a film star, but her humanitarian work reshaped celebrity advocacy, and that legacy outlasted her performances.',
          'conclusion'
        )
      ],
      { thesisIndex: 0 }
    )
    ok(kinds.includes('restated-conclusion'))
  })

  it('does not flag a conclusion that synthesises', () => {
    const kinds = run(
      [
        para(thesis, 'thesis'),
        para(FILLER, 'evidence'),
        para(
          'Taken together, the field visits and the fundraising records describe an institution learning to use recognition as infrastructure rather than decoration, a shift later organisations copied without naming its source.',
          'conclusion'
        )
      ],
      { thesisIndex: 0 }
    )
    ok(!kinds.includes('restated-conclusion'))
  })

  it('says nothing when no thesis was located — there is nothing to restate', () => {
    const kinds = run(
      [para(thesis, 'claim'), para(FILLER, 'evidence'), para(thesis, 'conclusion')],
      { thesisIndex: null }
    )
    ok(!kinds.includes('restated-conclusion'))
  })

  it('says nothing about a conclusion too short to measure', () => {
    const kinds = run([para(thesis, 'thesis'), para(FILLER, 'evidence'), para('That is the legacy.', 'conclusion')], {
      thesisIndex: 0
    })
    ok(!kinds.includes('restated-conclusion'))
  })
})

describe('findReasoningIssues — undeveloped repetition', () => {
  it('flags a sentence that restates the one before it', () => {
    const kinds = run([
      para(FILLER),
      para(
        'The fundraising tour reached audiences the mailing campaign had never contacted. Audiences the mailing campaign never contacted were reached by the fundraising tour.'
      )
    ])
    ok(kinds.includes('undeveloped-repetition'))
  })

  it('does not flag a sentence that adds a layer to the same subject', () => {
    const kinds = run([
      para(FILLER),
      para(
        'The fundraising tour reached audiences the mailing campaign had never contacted. Those audiences gave in smaller amounts but returned in later years, which is what made the totals hold.'
      )
    ])
    ok(!kinds.includes('undeveloped-repetition'))
  })
})

describe('findReasoningIssues — generic opening', () => {
  it('flags the openings that could introduce any essay', () => {
    for (const opener of [
      'Since the beginning of time, people have looked to public figures for guidance.',
      "Webster's dictionary defines charity as the voluntary giving of help.",
      "In today's society, celebrity carries a weight it did not once carry."
    ]) {
      ok(run([para(`${opener} ${FILLER}`, 'thesis'), para(FILLER)]).includes('generic-opening'), opener)
    }
  })

  it('does not flag a specific opening', () => {
    const kinds = run([
      para('In 1988 Hepburn accepted an appointment that would occupy the rest of her life. ' + FILLER, 'thesis'),
      para(FILLER)
    ])
    ok(!kinds.includes('generic-opening'))
  })

  it('skips the title paragraph and reads the one after it', () => {
    const kinds = run(
      [
        para('Audrey Hepburn and the Shape of Celebrity Advocacy', 'unknown'),
        para('Since the beginning of time, people have looked to public figures. ' + FILLER, 'thesis')
      ],
      { titleParagraph: true }
    )
    ok(kinds.includes('generic-opening'))
  })
})

describe('findReasoningIssues — shape', () => {
  it('returns nothing for an empty draft', () => {
    deepStrictEqual(findReasoningIssues({ paragraphs: [], thesisIndex: null }), [])
  })

  it('leaves clean academic prose alone', () => {
    deepStrictEqual(
      run([
        para(FILLER, 'thesis'),
        para(
          'Donations rose by a third over the two years of the tour (Walker, 2010). That increase came from first-time givers rather than from larger gifts by existing donors, which is what made it durable.',
          'evidence'
        ),
        para(FILLER, 'conclusion')
      ]),
      []
    )
  })

  it('quotes the writer\'s own words on every finding', () => {
    const findings = findingsFor([
      para(FILLER),
      para('Her later career changed the pattern. Everyone recognised the shift by then.')
    ])
    ok(findings.length > 0)
    for (const finding of findings) {
      ok(finding.quote.length > 0, finding.kind)
      ok(finding.quote.length <= 91, `${finding.kind}: ${finding.quote.length}`)
    }
  })

  it('names the paragraph a finding is about, 1-based', () => {
    const findings = findingsFor([
      para(FILLER),
      para(FILLER),
      para('Her later career changed. Everyone recognised the shift.')
    ])
    strictEqual(findings[0].paragraphIndex, 3)
  })
})

describe('the two findings that reach the score', () => {
  it('droppedEvidenceParagraphs collects only that kind', () => {
    const findings = findingsFor([
      para(FILLER),
      para('Her health suffered. Malnutrition produced anaemia (Walker, 2010).', 'evidence'),
      para('Her later career changed. Everyone recognised the shift.', 'claim')
    ])
    deepStrictEqual([...droppedEvidenceParagraphs(findings)], [2])
  })

  it('conclusionRestatesThesis is false for a draft with no such finding', () => {
    strictEqual(conclusionRestatesThesis(findingsFor([para(FILLER), para(FILLER)])), false)
  })
})

describe('findReasoningIssues — a topic where a thesis should be', () => {
  it('flags an opening that announces a subject', () => {
    for (const opener of [
      'This essay will discuss the causes of the Dutch famine.',
      'In this paper, I will examine how celebrity advocacy developed.',
      'The purpose of this essay is to look at wartime relief work.',
      'Celebrity humanitarianism is an important topic.',
      'There are many reasons why the campaign succeeded.'
    ]) {
      ok(run([para(`${opener} ${FILLER}`, 'thesis'), para(FILLER)], { thesisIndex: 0 }).includes('topic-not-thesis'), opener)
    }
  })

  it('does not flag an opening that asserts a position', () => {
    for (const opener of [
      'Hepburn\u2019s humanitarian work reshaped how celebrity advocacy operates.',
      'The famine of 1944 did more to shape her later politics than her film career did.',
      'Wartime relief work explains a shift that her biographers have read as temperament.'
    ]) {
      ok(!run([para(`${opener} ${FILLER}`, 'thesis'), para(FILLER)], { thesisIndex: 0 }).includes('topic-not-thesis'), opener)
    }
  })

  it('reads the first real paragraph when nothing located a thesis', () => {
    ok(
      run([para('This essay will discuss the famine. ' + FILLER, 'unknown'), para(FILLER)], {
        thesisIndex: null
      }).includes('topic-not-thesis')
    )
  })
})

describe('findReasoningIssues — summary without a point', () => {
  it('flags a paragraph that reports sources and concludes nothing', () => {
    const kinds = run([
      para(FILLER, 'thesis'),
      para(
        'Walker describes the winter of 1944 (Walker, 2010). Paris records the same shortages in her own account (Paris, 1996). Spoto puts the daily ration at four hundred calories (Spoto, 2006).',
        'evidence'
      )
    ])
    ok(kinds.includes('summary-without-point'))
  })

  it('does not flag a paragraph that says what the sources establish', () => {
    const kinds = run([
      para(FILLER, 'thesis'),
      para(
        'Walker describes the winter of 1944 (Walker, 2010). Paris records the same shortages (Paris, 1996). The agreement between two biographers working from different archives is what makes the figure usable rather than anecdotal.',
        'evidence'
      )
    ])
    ok(!kinds.includes('summary-without-point'))
  })

  it('does not flag a paragraph with only one source', () => {
    const kinds = run([
      para(FILLER, 'thesis'),
      para(
        'Walker describes the winter of 1944 (Walker, 2010). The shortages lasted until the spring. Relief convoys reached the west of the country in May.',
        'evidence'
      )
    ])
    ok(!kinds.includes('summary-without-point'))
  })

  it('does not ask a counterargument to conclude — relaying a position is its job', () => {
    const kinds = run([
      para(FILLER, 'thesis'),
      para(
        'Walker reads the appointment as publicity (Walker, 2010). Paris takes the same view of the early tours (Paris, 1996). Both point to the timing of the first press conference.',
        'counterargument'
      )
    ])
    ok(!kinds.includes('summary-without-point'))
  })
})

describe('conclusionDrawsOnBody — the finding it exists to stop', () => {
  it('is true for a conclusion assembled from the body', () => {
    ok(
      conclusionDrawsOnBody([
        { index: 1, role: 'thesis', text: 'Her humanitarian work reshaped celebrity advocacy.' },
        {
          index: 2,
          role: 'evidence',
          text: 'The fundraising records show donations rising by a third across the two years of the tour, driven by first-time givers rather than by larger gifts.'
        },
        {
          index: 3,
          role: 'conclusion',
          text: 'Taken together, the fundraising records and the tour donations describe first-time givers reshaping how advocacy work was funded.'
        }
      ])
    )
  })

  it('is false for a conclusion that introduces a subject the draft never raised', () => {
    strictEqual(
      conclusionDrawsOnBody([
        { index: 1, role: 'thesis', text: 'Her humanitarian work reshaped celebrity advocacy.' },
        {
          index: 2,
          role: 'evidence',
          text: 'The fundraising records show donations rising by a third across the two years of the tour.'
        },
        {
          index: 3,
          role: 'conclusion',
          text: 'Modern streaming platforms have transformed contemporary political organising through algorithmic recommendation and micro-targeted advertising budgets.'
        }
      ]),
      false
    )
  })

  it('is false when there is no conclusion to measure', () => {
    strictEqual(conclusionDrawsOnBody([{ index: 1, role: 'thesis', text: FILLER }]), false)
  })
})

/**
 * The rubric's PRECISION section, and its own worked example:
 * "Example of weak reasoning: 'Technology has changed society significantly.'"
 */
describe('findReasoningIssues — vague significance', () => {
  it('flags the rubric\u2019s own example', () => {
    ok(
      run([para(FILLER), para('Technology has changed society significantly. ' + FILLER)]).includes(
        'vague-significance'
      )
    )
  })

  it('flags the same shape in other clothes', () => {
    for (const sentence of [
      'Social media has affected culture dramatically.',
      'The internet transformed the world for the better.',
      'Technology has improved people\u2019s lives in countless ways.'
    ]) {
      ok(run([para(FILLER), para(`${sentence} ${FILLER}`)]).includes('vague-significance'), sentence)
    }
  })

  // All three conditions are needed, and each negative here is a sentence a
  // one-condition rule would flag.
  it('does not flag a specific claim about the same subjects', () => {
    for (const sentence of [
      'Technology changed how surgeons train for keyhole procedures.',
      'Social media changed the way the campaign raised money.',
      'The war significantly delayed her return to Arnhem.',
      'Society was slower to accept the appointment than the press was.'
    ]) {
      ok(!run([para(FILLER), para(`${sentence} ${FILLER}`)]).includes('vague-significance'), sentence)
    }
  })

  // A number is the work the finding would ask for, so it exempts the sentence
  // whatever adverbs sit around it.
  it('does not flag a claim that carries a measurement', () => {
    ok(
      !run([
        para(FILLER),
        para('Social media use rose 23% over the decade and changed how teenagers sleep significantly. ' + FILLER)
      ]).includes('vague-significance')
    )
  })

  it('does not flag a quotation that happens to be vague', () => {
    ok(
      !run([
        para(FILLER),
        para('She was asked about the shift. "Technology has changed society significantly," she said, and moved on. ' + FILLER)
      ]).includes('vague-significance')
    )
  })
})
