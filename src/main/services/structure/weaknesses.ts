import type { ParagraphOutline, StructureWeakness, StructureWeaknessKind } from '@shared/types'

/**
 * Named weaknesses in a draft's argument.
 *
 * Every message here is built from a LOCAL TEMPLATE. None of this text comes
 * from a model, and that is a deliberate constraint rather than a cost saving:
 * the moment a weakness is phrased by a model it can propose the fix, and a
 * proposed fix in a student's own document is the line Tracely does not cross
 * (`TRACER_SYSTEM_PROMPT` refuses rewriting outright for the same reason).
 * These say what is missing and where. What to write there is the student's.
 *
 * `tracerPrompt` is what gets prefilled if they want to talk it through — a
 * question in the student's voice, so the tutor answers rather than dictates.
 */

// Rendering order. Roughly "how much of the argument this breaks": a draft with
// no thesis has a problem that outranks a missing counterargument, and the
// panel should not bury it under three warrant gaps.
const SEVERITY: StructureWeaknessKind[] = [
  'no-thesis',
  'unsupported-claim',
  'warrant-gap',
  'new-claim-in-conclusion',
  'evidence-stacking',
  'no-counterargument',
  'no-significance'
]

export interface WeaknessInput {
  paragraphs: ParagraphOutline[]
  /** Ids of detected claims for which no relevant source was found. */
  claimsWithoutEvidence: string[]
  soWhatInConclusion: boolean
}

function ordinal(index: number): string {
  const suffix = index === 1 ? 'st' : index === 2 ? 'nd' : index === 3 ? 'rd' : 'th'
  return `${index}${suffix}`
}

export function findWeaknesses({
  paragraphs,
  claimsWithoutEvidence,
  soWhatInConclusion
}: WeaknessInput): StructureWeakness[] {
  if (paragraphs.length === 0) return []

  const found: StructureWeakness[] = []
  const roles = paragraphs.map((p) => p.role)
  const unlabelled = roles.filter((role) => role === 'unknown').length

  // Whole-draft findings are suppressed while paragraphs are unlabelled. "This
  // draft has no counterargument" is a claim about paragraphs that were never
  // read, and asserting it from an incomplete role vector is how a structural
  // tool tells a student to add something they already wrote.
  const allLabelled = unlabelled === 0

  if (allLabelled && !roles.includes('thesis')) {
    found.push({
      kind: 'no-thesis',
      paragraphIndex: null,
      claimId: null,
      message:
        'No paragraph states a thesis. A reader cannot tell what this draft is arguing for, only what it is about.',
      tracerPrompt: 'My draft does not seem to have a clear thesis. How do I work out what mine should be?'
    })
  }

  for (const claimId of claimsWithoutEvidence) {
    const paragraph = paragraphs.find((p) => p.claimIds.includes(claimId))
    found.push({
      kind: 'unsupported-claim',
      paragraphIndex: paragraph?.index ?? null,
      claimId,
      message: paragraph
        ? `The claim in the ${ordinal(paragraph.index)} paragraph has no supporting source yet.`
        : 'This claim has no supporting source yet.',
      tracerPrompt: 'Tracely could not find evidence for one of my claims. How should I go about checking it?'
    })
  }

  for (const paragraph of paragraphs) {
    const owesWarrant = paragraph.role === 'claim' || paragraph.role === 'evidence'
    if (!owesWarrant || paragraph.hasWarrant) continue
    found.push({
      kind: 'warrant-gap',
      paragraphIndex: paragraph.index,
      claimId: paragraph.claimIds[0] ?? null,
      message: `The ${ordinal(paragraph.index)} paragraph presents ${
        paragraph.role === 'evidence' ? 'evidence' : 'a claim'
      } without explaining how it supports the argument.`,
      tracerPrompt: `In my ${ordinal(
        paragraph.index
      )} paragraph, how do I explain what my evidence actually shows without just restating it?`
    })
  }

  const conclusion = paragraphs.find((p) => p.role === 'conclusion')
  if (conclusion && conclusion.claimIds.length > 0) {
    found.push({
      kind: 'new-claim-in-conclusion',
      paragraphIndex: conclusion.index,
      claimId: conclusion.claimIds[0],
      message:
        'The conclusion introduces a new claim. Anything asserted here has no room left to be supported.',
      tracerPrompt: 'My conclusion makes a new claim. Where should that argument go instead?'
    })
  }

  for (let i = 1; i < paragraphs.length; i++) {
    if (paragraphs[i].role !== 'evidence' || paragraphs[i - 1].role !== 'evidence') continue
    found.push({
      kind: 'evidence-stacking',
      paragraphIndex: paragraphs[i].index,
      claimId: null,
      message: `The ${ordinal(paragraphs[i].index)} paragraph adds more evidence to the ${ordinal(
        paragraphs[i - 1].index
      )} without a claim between them. Stacked sources read as a literature review rather than an argument.`,
      tracerPrompt: `My ${ordinal(paragraphs[i].index)} and ${ordinal(
        paragraphs[i - 1].index
      )} paragraphs are both evidence. What claim should be joining them?`
    })
  }

  if (allLabelled && !roles.includes('counterargument')) {
    found.push({
      kind: 'no-counterargument',
      paragraphIndex: null,
      claimId: null,
      message:
        'Nothing in this draft engages an opposing view. An argument that never meets resistance reads as one that has not been tested.',
      tracerPrompt: 'What is the strongest objection to my argument, and how do I address it fairly?'
    })
  }

  if (allLabelled && !roles.includes('significance') && !soWhatInConclusion) {
    found.push({
      kind: 'no-significance',
      paragraphIndex: null,
      claimId: null,
      message: 'The draft never says why this matters. A reader finishes knowing what is true but not what follows from it.',
      tracerPrompt: 'My essay proves its point but never says why it matters. How do I write that without overclaiming?'
    })
  }

  // Sorted, never truncated. The panel decides how many to show and says how
  // many it is hiding — a cap applied here would be invisible to it, and
  // "3 weaknesses" reading as the whole list when it isn't is the exact
  // failure mode this tool exists to avoid.
  return found.sort((a, b) => SEVERITY.indexOf(a.kind) - SEVERITY.indexOf(b.kind))
}
