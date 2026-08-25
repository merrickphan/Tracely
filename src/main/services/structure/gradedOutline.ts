import type { Claim, DocumentOutline, EvidenceCoverage, StructureWeakness } from '@shared/types'
import { scoreFromComponents, type VerifiedGrade } from '@shared/gradedDraft'
import { argumentParagraphs } from '@shared/structureText'
import { findCitationDefects } from '@shared/citationShape'
import { bucketClaimsByParagraph } from '@shared/paragraphSplit'
import { computeClaimSpans } from '@shared/claimSpans'
import { sourceHashFor, STRUCTURE_SCHEMA_VERSION } from './outlineIdentity'
import { looksLikeTitle } from './roles'
import { findReasoningIssues } from './reasoningIssues'
import { reasoningWeaknesses } from './weaknesses'
import { paragraphSubject } from '@shared/paragraphNames'

/**
 * A `DocumentOutline` built from the graded read instead of from local rules.
 *
 * The report UI is unchanged — it consumes `DocumentOutline`, and so does this.
 * What changes is where the judgements came from: paragraph roles, the six
 * component sub-scores and every finding now come from one relay call reading
 * the whole draft against the owner's rubric, rather than from ten prose
 * detectors, a cohesion pass and an embedding-based tangent check.
 *
 * Three things are deliberately still local:
 *
 * - **The arithmetic.** `scoreFromComponents` sums the model's sub-scores, so
 *   an unchanged draft scores an unchanged number and every point traces to a
 *   quoted sentence. The model judges; this adds up.
 * - **Citation defects** (`shared/citationShape.ts`). Free, instant, and
 *   visible in the SHAPE of a reference with nothing read — there is no reason
 *   to pay a model to notice a placeholder author.
 * - **Claim bucketing**, so a finding and a detected claim in the same
 *   paragraph line up. Computed against the untrimmed text exactly as
 *   `analyzeStructure` does.
 *
 * The reasoning pass is the fourth thing that stays local, added 2026-08-22.
 * `reasoningIssues.ts` reads the prose for the CLAIM -> EVIDENCE -> REASONING
 * chain — evidence dropped without analysis, an absolute nothing earns, a
 * conclusion that only restates the thesis, an opening that announces a subject
 * instead of claiming something. All of it was written, tested and reachable
 * ONLY from Screen Watch, because this path replaced the rule engine wholesale;
 * a student reading the report in the editor never saw any of it. Owner: the
 * argument score "needs work ... make sure it properly flags things like a bad
 * thesis or faulty reasoning."
 *
 * It runs on the MODEL's roles and the model's thesis, not on a second local
 * classification — so the two halves of the report describe the same reading of
 * the draft, and the detectors get better labels than the heuristics ever gave
 * them. It is free, instant and adds no call.
 *
 * `cohesion` is null here on purpose. The flow between paragraphs is now the
 * model's ORGANIZATION and COHESION findings, which quote the seam rather than
 * naming a boundary by number; keeping the lexical-overlap measure beside them
 * would put two answers to one question in one report.
 */
export interface GradedOutlineInput {
  documentId: string | null
  analysisId: string | null
  text: string
  claims: Claim[]
  coverage: EvidenceCoverage
  grade: VerifiedGrade
}

export function buildGradedOutline(input: GradedOutlineInput): DocumentOutline {
  const spans = argumentParagraphs(input.text)
  const titleParagraph = spans.length > 1 && looksLikeTitle(spans[0].text)

  const located = computeClaimSpans(input.text, input.claims).map((span) => ({
    claimId: span.claim.id,
    start: span.start
  }))
  const claimsByParagraph = bucketClaimsByParagraph(spans, located)

  const paragraphs = spans.map((span, i) => {
    const graded = input.grade.paragraphs[i]
    return {
      index: span.index,
      role: graded?.role ?? ('unknown' as const),
      hasWarrant: graded?.hasWarrant ?? false,
      claimIds: claimsByParagraph.get(span.index) ?? []
    }
  })

  const { score, components } = scoreFromComponents(
    input.grade.components,
    input.grade.counterargumentApplicable
  )

  // Findings first, then the free local citation check. Order is what the
  // report renders in, and a broken reference is worth less of the reader's
  // attention than a hole in the argument.
  const weaknesses: StructureWeakness[] = input.grade.findings.map((finding) => ({
    kind: 'model-finding' as const,
    paragraphIndex: finding.paragraphIndex,
    // The graded read does not know claim ids — it was sent paragraphs, not
    // claims. A finding is tied to its paragraph and its quote, which is what
    // the report locates it by.
    claimId: null,
    message: finding.message,
    // Nothing prefills Tracer from a model finding yet: `tracerPrompt` is
    // supposed to be a question in the student's voice, and generating one is a
    // second place for a model to put words in their mouth. The finding's own
    // quote and fix are what the card shows.
    tracerPrompt: '',
    ...(finding.quote ? { quote: finding.quote } : {}),
    severity: finding.severity,
    rubricSection: finding.rubricSection,
    label: finding.label,
    ...(finding.fix ? { fix: finding.fix } : {})
  }))

  // The local reasoning pass, on the model's own roles. Every finding quotes
  // the sentence it is about, so nothing here can describe a paragraph the
  // student did not write.
  const thesisIndex = paragraphs.findIndex((p) => p.role === 'thesis')
  const reasoning = findReasoningIssues({
    paragraphs: spans.map((span, i) => ({
      index: span.index,
      text: span.text,
      role: paragraphs[i]?.role ?? 'unknown'
    })),
    thesisIndex: thesisIndex === -1 ? null : thesisIndex,
    titleParagraph
  })
  weaknesses.push(
    ...reasoningWeaknesses(reasoning, (index) =>
      paragraphSubject(
        spans.map((span, i) => ({ index: span.index, role: paragraphs[i]?.role ?? 'unknown' })),
        titleParagraph,
        index
      )
    )
  )

  for (const span of spans) {
    for (const defect of findCitationDefects(span.text)) {
      weaknesses.push({
        kind: 'malformed-citation',
        paragraphIndex: span.index,
        claimId: null,
        message: defect.message,
        tracerPrompt:
          'One of my citations is not formatted properly. What does a complete reference need in it?',
        quote: defect.text
      })
    }
  }

  return {
    documentId: input.documentId,
    analysisId: input.analysisId,
    sourceHash: sourceHashFor(input.text),
    schemaVersion: STRUCTURE_SCHEMA_VERSION,
    paragraphs,
    score,
    components,
    // A paragraph the model could not place is still an unread paragraph, and
    // the panel has to say "provisional" for the same reason it always did.
    complete: paragraphs.every((p) => p.role !== 'unknown'),
    applicable: true,
    rolesFrom: 'model',
    coverage: input.coverage,
    weaknesses,
    titleParagraph,
    cohesion: null,
    analyzedAt: new Date().toISOString()
  }
}
