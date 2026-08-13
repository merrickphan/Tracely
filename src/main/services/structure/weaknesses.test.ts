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

  it('flags a missing counterargument', () => {
    strictEqual(kinds(['thesis', 'claim+', 'significance', 'conclusion']).includes('no-counterargument'), true)
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
