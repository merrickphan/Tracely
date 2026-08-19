import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findWeaknesses, type WeaknessInput } from './weaknesses.ts'

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

/** `'claim+'` carries a warrant; `'claim#c1'` carries claim id c1. */
function outline(...specs: string[]): WeaknessInput['paragraphs'] {
  return specs.map((spec, i) => {
    const [head, claimId] = spec.split('#')
    return {
      index: i + 1,
      role: head.replace(/\+$/, '') as Role,
      hasWarrant: head.endsWith('+'),
      claimIds: claimId ? [claimId] : []
    }
  })
}

function kinds(specs: string[], overrides: Partial<WeaknessInput> = {}): string[] {
  return findWeaknesses({
    paragraphs: outline(...specs),
    claimsWithoutEvidence: [],
    soWhatInConclusion: false,
    ...overrides
  }).map((w) => w.kind)
}

const COMPLETE = ['thesis', 'claim+', 'counterargument', 'significance', 'conclusion']

describe('findWeaknesses — warrant gaps', () => {
  it('flags an unwarranted claim paragraph at its own index', () => {
    const found = findWeaknesses({
      paragraphs: outline('thesis', 'claim', 'counterargument', 'significance', 'conclusion'),
      claimsWithoutEvidence: [],
      soWhatInConclusion: false
    })
    const gap = found.find((w) => w.kind === 'warrant-gap')
    strictEqual(gap?.paragraphIndex, 2)
  })

  it('does not flag a warranted paragraph', () => {
    strictEqual(kinds(COMPLETE).includes('warrant-gap'), false)
  })

  it('does not ask a thesis or conclusion to carry a warrant', () => {
    strictEqual(kinds(['thesis', 'claim+', 'counterargument', 'significance', 'conclusion']).includes('warrant-gap'), false)
  })

  it('flags every unwarranted paragraph, not just the first', () => {
    const found = kinds(['thesis', 'claim', 'evidence', 'counterargument', 'significance', 'conclusion'])
    strictEqual(found.filter((k) => k === 'warrant-gap').length, 2)
  })
})

describe('findWeaknesses — structural gaps', () => {
  it('flags a missing thesis', () => {
    strictEqual(kinds(['claim+', 'counterargument', 'significance', 'conclusion']).includes('no-thesis'), true)
  })

  /**
   * The inverse of the test that used to be here.
   *
   * The rubric is explicit: "Do not require counterarguments for every essay;
   * judge based on the prompt and genre." Tracely is never shown the prompt, so
   * it cannot make that judgement — and a tool that cannot judge must not
   * require. See shared/rubric.ts.
   */
  it('never asserts that a draft is missing a counterargument', () => {
    const found = kinds(['thesis', 'claim+', 'significance', 'conclusion'])
    strictEqual(
      found.some((k) => k.includes('counterargument')),
      false
    )
  })

  it('flags a missing significance', () => {
    strictEqual(kinds(['thesis', 'claim+', 'counterargument', 'conclusion']).includes('no-significance'), true)
  })

  it('accepts a so-what marker in the conclusion in place of a significance paragraph', () => {
    const found = kinds(['thesis', 'claim+', 'counterargument', 'conclusion'], {
      soWhatInConclusion: true
    })
    strictEqual(found.includes('no-significance'), false)
  })

  it('finds nothing wrong with a complete draft', () => {
    deepStrictEqual(kinds(COMPLETE), [])
  })
})

describe('findWeaknesses — suppressed while paragraphs are unlabelled', () => {
  // Asserting "this draft has no counterargument" from a role vector that
  // never read half the paragraphs is how a structural tool tells a student to
  // add something they already wrote.
  it('withholds whole-draft findings when any paragraph is unknown', () => {
    const found = kinds(['thesis', 'unknown', 'unknown'])
    strictEqual(found.includes('no-counterargument'), false)
    strictEqual(found.includes('no-significance'), false)
    strictEqual(found.includes('no-thesis'), false)
  })

  it('still reports per-paragraph findings for the paragraphs it did read', () => {
    const found = findWeaknesses({
      paragraphs: outline('thesis', 'claim', 'unknown'),
      claimsWithoutEvidence: [],
      soWhatInConclusion: false
    })
    strictEqual(found.length, 1)
    strictEqual(found[0].kind, 'warrant-gap')
    strictEqual(found[0].paragraphIndex, 2)
  })
})

describe('findWeaknesses — evidence stacking and misplaced claims', () => {
  it('flags two consecutive evidence paragraphs at the second one', () => {
    const found = findWeaknesses({
      paragraphs: outline('thesis', 'evidence+', 'evidence+', 'counterargument', 'significance', 'conclusion'),
      claimsWithoutEvidence: [],
      soWhatInConclusion: false
    })
    const stack = found.find((w) => w.kind === 'evidence-stacking')
    strictEqual(stack?.paragraphIndex, 3)
  })

  it('does not flag evidence separated by a claim', () => {
    const specs = ['thesis', 'evidence+', 'claim+', 'evidence+', 'counterargument', 'significance', 'conclusion']
    strictEqual(kinds(specs).includes('evidence-stacking'), false)
  })

  it('flags a new claim detected inside the conclusion', () => {
    const found = findWeaknesses({
      paragraphs: outline('thesis', 'claim+', 'counterargument', 'significance', 'conclusion#c9'),
      claimsWithoutEvidence: [],
      soWhatInConclusion: false
    })
    const late = found.find((w) => w.kind === 'new-claim-in-conclusion')
    strictEqual(late?.paragraphIndex, 5)
    strictEqual(late?.claimId, 'c9')
  })
})

describe('findWeaknesses — unsupported claims', () => {
  it('locates the paragraph an unsupported claim sits in', () => {
    const found = findWeaknesses({
      paragraphs: outline('thesis', 'claim+#c1', 'counterargument', 'significance', 'conclusion'),
      claimsWithoutEvidence: ['c1'],
      soWhatInConclusion: false
    })
    const weak = found.find((w) => w.kind === 'unsupported-claim')
    strictEqual(weak?.paragraphIndex, 2)
    strictEqual(weak?.claimId, 'c1')
  })

  it('still reports a claim it cannot place, with a null index', () => {
    const found = findWeaknesses({
      paragraphs: outline(...COMPLETE),
      claimsWithoutEvidence: ['orphan'],
      soWhatInConclusion: false
    })
    const weak = found.find((w) => w.kind === 'unsupported-claim')
    strictEqual(weak?.paragraphIndex, null)
    strictEqual(weak?.claimId, 'orphan')
  })
})

describe('findWeaknesses — output contract', () => {
  it('returns nothing for an empty document', () => {
    deepStrictEqual(kinds([]), [])
  })

  it('orders findings by severity, not by paragraph', () => {
    const found = kinds(['claim', 'evidence', 'evidence'])
    strictEqual(found[0], 'no-thesis')
    strictEqual(found.indexOf('warrant-gap') < found.indexOf('evidence-stacking'), true)
  })

  it('gives every finding a non-empty message and tracer prompt', () => {
    const found = findWeaknesses({
      paragraphs: outline('claim', 'evidence', 'evidence'),
      claimsWithoutEvidence: ['c1'],
      soWhatInConclusion: false
    })
    strictEqual(found.length > 0, true)
    for (const weakness of found) {
      strictEqual(weakness.message.trim().length > 0, true)
      strictEqual(weakness.tracerPrompt.trim().length > 0, true)
      // The prompt is a question in the student's voice, so the tutor answers
      // rather than dictating a replacement paragraph.
      strictEqual(weakness.tracerPrompt.includes('?'), true)
    }
  })
})

describe('findWeaknesses — findings read off the prose', () => {
  const reasoning = (kind: string, paragraphIndex: number | null, quote = 'the flagged words') =>
    ({ kind, paragraphIndex, quote }) as never

  it('carries the quote through to the weakness', () => {
    const [found] = findWeaknesses({
      paragraphs: outline(...COMPLETE),
      claimsWithoutEvidence: [],
      soWhatInConclusion: false,
      reasoning: [reasoning('overreaching-claim', 2, 'Everyone recognised the shift.')]
    }).filter((w) => w.kind === 'overreaching-claim')
    strictEqual(found.quote, 'Everyone recognised the shift.')
    strictEqual(found.paragraphIndex, 2)
    strictEqual(found.claimId, null)
  })

  it('names the paragraph in the message', () => {
    const [found] = findWeaknesses({
      paragraphs: outline(...COMPLETE),
      claimsWithoutEvidence: [],
      soWhatInConclusion: false,
      reasoning: [reasoning('dropped-evidence', 3)]
    }).filter((w) => w.kind === 'dropped-evidence')
    // The name every panel heads that paragraph with — see
    // shared/paragraphNames.ts. COMPLETE opens on a thesis, so array position
    // 2 is the second BODY paragraph.
    strictEqual(found.message.startsWith('Paragraph 2 '), true, found.message)
  })

  // The bug this naming exists to fix. A titled essay shifts every array
  // position by one, and the message used to number the array while the card
  // above it numbered the body — so a card headed "Paragraph 11" carried a
  // finding about "the 12th paragraph".
  it('names the paragraph the way the panel heading does, on a titled essay', () => {
    const [found] = findWeaknesses({
      paragraphs: outline('unknown', ...COMPLETE),
      titleParagraph: true,
      claimsWithoutEvidence: [],
      soWhatInConclusion: false,
      reasoning: [reasoning('dropped-evidence', 4)]
    }).filter((w) => w.kind === 'dropped-evidence')
    strictEqual(found.message.startsWith('Paragraph 2 '), true, found.message)
    strictEqual(/\d+(?:st|nd|rd|th) paragraph/.test(found.message), false, found.message)
  })

  // An ordinal cannot say this at all, which is half the reason it went.
  it('calls the conclusion the conclusion', () => {
    const [found] = findWeaknesses({
      paragraphs: outline(...COMPLETE),
      claimsWithoutEvidence: [],
      soWhatInConclusion: false,
      reasoning: [reasoning('unclear-reference', COMPLETE.length)]
    }).filter((w) => w.kind === 'unclear-reference')
    strictEqual(found.message.startsWith('The conclusion '), true, found.message)
  })

  // The two modules describe the same failure from different evidence, and a
  // report that prints both about one paragraph reads as two problems.
  it('drops the warrant gap where dropped evidence already quotes the sentence', () => {
    const found = kinds(['thesis', 'claim', 'evidence', 'counterargument', 'significance', 'conclusion'], {
      reasoning: [reasoning('dropped-evidence', 3)]
    })
    strictEqual(found.filter((k) => k === 'warrant-gap').length, 1)
    strictEqual(found.includes('dropped-evidence'), true)
  })

  it('keeps a warrant gap in a paragraph the prose rules said nothing about', () => {
    const found = kinds(['thesis', 'claim', 'counterargument', 'significance', 'conclusion'], {
      reasoning: [reasoning('dropped-evidence', 4)]
    })
    strictEqual(found.includes('warrant-gap'), true)
  })

  // Unlike every whole-draft finding, these are not gated on `allLabelled` —
  // they quote text that is demonstrably there. See WeaknessInput.reasoning.
  it('reports them even when the draft could not be fully labelled', () => {
    const found = kinds(['unknown', 'unknown', 'unknown'], {
      reasoning: [reasoning('generic-opening', 1)]
    })
    strictEqual(found.includes('generic-opening'), true)
    strictEqual(found.includes('no-counterargument'), false)
  })
})

describe('findWeaknesses — reasoning faults the classifier named', () => {
  const fault = (paragraphIndex: number, kind: string) => ({ paragraphIndex, kind }) as never

  it('raises the named fault with its own message', () => {
    const [found] = findWeaknesses({
      paragraphs: outline(...COMPLETE),
      claimsWithoutEvidence: [],
      soWhatInConclusion: false,
      reasoningFaults: [fault(2, 'sequence-as-cause')]
    }).filter((w) => w.kind === 'sequence-as-cause')
    strictEqual(found.paragraphIndex, 2)
    strictEqual(found.message.startsWith('Paragraph 1 '), true, found.message)
    // The message must say what the fault IS, not repeat its name — "circular
    // reasoning" is a term many writers have heard and few can act on.
    strictEqual(/order or correlation/.test(found.message), true)
  })

  // Two resolutions of one complaint. Printing both reads as two problems and
  // buries the one that actually says something.
  it('replaces the generic warrant gap on the same paragraph', () => {
    const specs = ['thesis', 'claim', 'counterargument', 'significance', 'conclusion']
    const found = kinds(specs, { reasoningFaults: [fault(2, 'circular-reasoning')] })
    strictEqual(found.includes('circular-reasoning'), true)
    strictEqual(found.includes('warrant-gap'), false)
  })

  it('keeps a warrant gap on a paragraph with no named fault', () => {
    const specs = ['thesis', 'claim', 'evidence', 'counterargument', 'significance', 'conclusion']
    const found = kinds(specs, { reasoningFaults: [fault(2, 'logical-leap')] })
    strictEqual(found.includes('logical-leap'), true)
    // Paragraph 3 is still unwarranted and unnamed.
    strictEqual(found.includes('warrant-gap'), true)
  })

  it('says nothing when the classifier named none', () => {
    strictEqual(kinds(COMPLETE, { reasoningFaults: [] }).some((k) => k === 'logical-leap'), false)
  })
})
