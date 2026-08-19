import { describe, it } from 'node:test'
import { deepStrictEqual, strictEqual, ok } from 'node:assert'
import {
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
