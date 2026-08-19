import type { ParagraphOutline, StructureWeakness, StructureWeaknessKind } from '@shared/types'
import type { ReasoningFinding } from './reasoningIssues.ts'

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
//
// The reasoning findings are interleaved rather than appended as a block, on
// the same principle: `dropped-evidence` is the same failure `warrant-gap`
// names, caught from the prose instead of from a label, so it sits beside it.
// `unsupported-emphasis` and `generic-opening` sort last because they are the
// two a strong draft can carry without being much worse for it.
const SEVERITY: StructureWeaknessKind[] = [
  'no-thesis',
  'topic-not-thesis',
  'unsupported-claim',
  // Above every reasoning finding: a reference a reader cannot follow is the
  // one defect here that costs marks on its own, whatever the argument does.
  'malformed-citation',
  'summary-without-point',
  'dropped-evidence',
  'warrant-gap',
  'overreaching-claim',
  'new-claim-in-conclusion',
  'evidence-stacking',
  'no-counterargument',
  'no-significance',
  'restated-conclusion',
  'undeveloped-repetition',
  'unclear-reference',
  'unsupported-emphasis',
  'generic-opening'
]

/**
 * The template for each finding read off the prose.
 *
 * Same rule as every message in this file: say what is wrong and where, never
 * what to write instead. Each one ends by naming the test the writer can run,
 * because these are findings about habits — an "always" removed from one
 * sentence and left in four others is a fix that did not happen.
 *
 * The `quote` is carried separately rather than pasted into the message, so a
 * surface with no room for it (the widget's paragraph rows) drops the words
 * instead of truncating the sentence explaining them.
 */
const REASONING_TEMPLATE: Record<
  ReasoningFinding['kind'],
  { message: (where: string) => string; tracerPrompt: string }
> = {
  'dropped-evidence': {
    message: (where) =>
      `The ${where} ends on its evidence. A quotation or citation in the final sentence leaves the reader to work out what it proved.`,
    tracerPrompt:
      'One of my paragraphs ends on a quotation. What should I be saying after it that I am not saying now?'
  },
  'overreaching-claim': {
    message: (where) =>
      `The ${where} states something absolutely — "always", "everyone", "proves". A claim with no exceptions is one a single counter-example defeats.`,
    tracerPrompt:
      'I have used absolute words like "always" and "everyone" in my draft. How do I narrow those without sounding like I am hedging everything?'
  },
  'unsupported-emphasis': {
    message: (where) =>
      `The ${where} asserts emphasis rather than earning it. "Obviously" and "massive" tell the reader the conclusion instead of arguing for it.`,
    tracerPrompt:
      'I lean on words like "clearly" and "massive" in my essay. What should I write instead of the emphasis?'
  },
  'unclear-reference': {
    message: (where) =>
      `The ${where} opens with "This" pointing back at the whole paragraph before it. The reader has to guess which part is meant.`,
    tracerPrompt:
      'My paragraphs keep starting with "This shows". How do I open them so the reader knows what I am referring to?'
  },
  'restated-conclusion': {
    message: () =>
      'The conclusion repeats the thesis in the same words rather than saying what the argument established. A reader finishes where they started.',
    tracerPrompt:
      'My conclusion just restates my thesis. What should a conclusion do that the introduction has not already done?'
  },
  'undeveloped-repetition': {
    message: (where) =>
      `Two sentences in the ${where} make the same point in different words. The second one restates rather than adding a layer.`,
    tracerPrompt:
      'I keep repeating myself in a paragraph instead of developing the point. How do I tell the difference?'
  },
  'topic-not-thesis': {
    message: () =>
      'The opening announces a subject rather than claiming anything about it. A reader cannot tell what this draft argues, only what it is about.',
    tracerPrompt:
      'My introduction says what my essay is about instead of arguing something. How do I turn a topic into a thesis?'
  },
  'summary-without-point': {
    message: (where) =>
      `The ${where} reports what its sources say and never says what any of it establishes. Nothing in it connects the evidence to the argument.`,
    tracerPrompt:
      'One of my paragraphs just summarises my sources. What should I be adding so it argues something?'
  },
  'generic-opening': {
    message: () =>
      'The draft opens on a line that would fit any essay on any subject. The first sentence is doing no work for this argument.',
    tracerPrompt:
      'My introduction starts with a generic hook. What should the opening sentence of an argumentative essay actually do?'
  }
}

export interface WeaknessInput {
  paragraphs: ParagraphOutline[]
  /** Ids of detected claims for which no relevant source was found. */
  claimsWithoutEvidence: string[]
  soWhatInConclusion: boolean
  /**
   * Whether paragraph 1 is the essay's title rather than a paragraph of the
   * argument. It is labelled 'unknown' — correctly, it states no claim — and
   * without this it counted as an unread paragraph and suppressed every
   * whole-draft finding. A student who titled their work got a score and no
   * feedback at all, including no "this draft has no counterargument", which is
   * the most useful thing this module says.
   */
  titleParagraph?: boolean
  /**
   * The local reader found a thesis even though the role vector names none.
   *
   * Same signal `scoreDraft` takes as `thesisFallbackIndex`, and it must be
   * honoured in both places or the report contradicts itself: crediting the
   * thesis in the score while printing "No paragraph states a thesis" beside it
   * is worse than either answer alone.
   */
  thesisFound?: boolean
  /**
   * Findings read off the prose — see `reasoningIssues.ts`.
   *
   * Deliberately NOT gated on `allLabelled`, unlike every whole-draft finding
   * above it. The gate exists because "this draft has no counterargument" is an
   * assertion about paragraphs nothing read; these are assertions about words
   * that are demonstrably there, quoted back to the writer, and suppressing
   * them because a model returned 'unknown' for paragraph 6 would withhold the
   * only feedback that does not depend on the labelling at all.
   */
  reasoning?: ReasoningFinding[]
  /**
   * The closing paragraph is built out of the draft above it — see
   * `conclusionDrawsOnBody`. Suppresses `new-claim-in-conclusion`.
   *
   * Defaults to FALSE so a caller that does not pass it keeps the old
   * behaviour, which is the wrong default for the app and the right one for
   * this module: silently excusing every conclusion because a caller forgot to
   * measure would delete the finding rather than narrow it.
   */
  conclusionDrawsOnBody?: boolean
  /**
   * Defects in the shape of a reference — `shared/citationShape.ts`.
   *
   * Carried as finished messages rather than as kinds, because unlike every
   * other weakness here the wording differs per defect ("this year has not
   * happened yet" and "the author is a placeholder" are not variants of one
   * sentence). The module still owns the text, and it is still a local
   * template: no model wrote any of it.
   */
  citationDefects?: Array<{ paragraphIndex: number; message: string; quote: string }>
}

function ordinal(index: number): string {
  const suffix = index === 1 ? 'st' : index === 2 ? 'nd' : index === 3 ? 'rd' : 'th'
  return `${index}${suffix}`
}

export function findWeaknesses({
  paragraphs,
  claimsWithoutEvidence,
  soWhatInConclusion,
  titleParagraph = false,
  thesisFound = false,
  reasoning = [],
  conclusionDrawsOnBody = false,
  citationDefects = []
}: WeaknessInput): StructureWeakness[] {
  if (paragraphs.length === 0) return []

  const found: StructureWeakness[] = []
  const roles = paragraphs.map((p) => p.role)
  // The title is not an unread paragraph — see `titleParagraph`.
  const unlabelled = roles.filter((role, i) => role === 'unknown' && !(titleParagraph && i === 0)).length

  // Whole-draft findings are suppressed while paragraphs are unlabelled. "This
  // draft has no counterargument" is a claim about paragraphs that were never
  // read, and asserting it from an incomplete role vector is how a structural
  // tool tells a student to add something they already wrote.
  const allLabelled = unlabelled === 0

  if (allLabelled && !roles.includes('thesis') && !thesisFound) {
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

  // `conclusionDrawsOnBody` is the gate, and it is why this is now rare. The
  // rule used to fire on ANY claim in the closing paragraph, which flags the
  // move a conclusion exists to make: a claim assembled from evidence the body
  // has already presented is supported by everything above it, and telling a
  // student to cut it is telling them to end on a summary. Only a claim made of
  // material the draft never introduced is the smuggling this was written for.
  const conclusion = paragraphs.find((p) => p.role === 'conclusion')
  if (conclusion && conclusion.claimIds.length > 0 && !conclusionDrawsOnBody) {
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

  // `dropped-evidence` and `warrant-gap` are the same complaint about the same
  // paragraph — one read off the prose, one off the label — and a report that
  // says both twice about the fourth paragraph reads as two problems. The
  // quoted one wins, because a writer sent to a sentence they can see beats one
  // sent to a paragraph and told something is missing from it.
  const droppedAt = new Set(
    reasoning.filter((f) => f.kind === 'dropped-evidence').map((f) => f.paragraphIndex)
  )
  for (let i = found.length - 1; i >= 0; i--) {
    if (found[i].kind === 'warrant-gap' && droppedAt.has(found[i].paragraphIndex)) found.splice(i, 1)
  }

  for (const defect of citationDefects) {
    found.push({
      kind: 'malformed-citation',
      paragraphIndex: defect.paragraphIndex,
      claimId: null,
      message: defect.message,
      tracerPrompt:
        'One of my citations is not formatted properly. What does a complete reference need in it?',
      quote: defect.quote
    })
  }

  for (const finding of reasoning) {
    const template = REASONING_TEMPLATE[finding.kind]
    found.push({
      kind: finding.kind,
      paragraphIndex: finding.paragraphIndex,
      claimId: null,
      message: template.message(
        finding.paragraphIndex === null ? 'draft' : `${ordinal(finding.paragraphIndex)} paragraph`
      ),
      tracerPrompt: template.tracerPrompt,
      quote: finding.quote
    })
  }

  // Sorted, never truncated. The panel decides how many to show and says how
  // many it is hiding — a cap applied here would be invisible to it, and
  // "3 weaknesses" reading as the whole list when it isn't is the exact
  // failure mode this tool exists to avoid.
  return found.sort((a, b) => SEVERITY.indexOf(a.kind) - SEVERITY.indexOf(b.kind))
}
