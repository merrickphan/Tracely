import { createHash } from 'node:crypto'
import { computeClaimSpans } from '@shared/claimSpans'
import type { Claim, DocumentOutline, EvidenceCoverage, ParagraphOutline } from '@shared/types'
import { bucketClaimsByParagraph, splitParagraphs } from '@shared/paragraphSplit'
import { hasSignificanceMarker, heuristicRoles } from './roles'
import { scoreDraft } from './scoreDraft'
import { findWeaknesses } from './weaknesses'

/**
 * Assembles a DocumentOutline from a document's plain text and its detected
 * claims.
 *
 * Kept deliberately thin. Every decision with a wrong answer available lives in
 * a leaf module `npm test` can load — `bucketClaimsByParagraph`, `heuristicRoles`,
 * `scoreDraft`, `findWeaknesses`. What is left here is sequencing, which is why
 * this file has no test of its own: it value-imports `@shared/claimSpans`, and
 * Node's type-stripping resolver cannot follow either the alias or the
 * extensionless relative imports this codebase uses.
 */

export const STRUCTURE_SCHEMA_VERSION = 1

/**
 * The equivalence class the analysis actually cares about: two texts with the
 * same hash split into the same paragraphs with the same words.
 *
 * Runs of spaces and tabs collapse, and runs of newlines collapse to one,
 * because `splitParagraphs` already treats any newline run as a single
 * boundary — so a blank line added between two paragraphs changes nothing and
 * should not invalidate the analysis, while a new paragraph break does.
 *
 * The caller must pass the editor's `innerText`, never its `bodyHtml`. Bolding
 * a word rewrites the HTML and leaves the text identical, and re-running a
 * relay call because someone italicised a title would be a pure waste.
 */
export function sourceHashFor(text: string): string {
  const normalized = text.replace(/[ \t]+/g, ' ').replace(/[\r\n]+/g, '\n').trim()
  return createHash('sha256').update(`structure::v${STRUCTURE_SCHEMA_VERSION}::${normalized}`).digest('hex')
}

export interface AnalyzeStructureInput {
  documentId: string | null
  /** The editor's innerText — see sourceHashFor. */
  text: string
  claims: Claim[]
  /** Detected claims for which no relevant source was found. Empty until a search has run. */
  claimsWithoutEvidence: string[]
  coverage: EvidenceCoverage
  analyzedAt: string
}

export function analyzeStructure(input: AnalyzeStructureInput): DocumentOutline {
  const spans = splitParagraphs(input.text)

  // computeClaimSpans drops claims it cannot locate in the text, and
  // bucketClaimsByParagraph drops any whose start falls between paragraphs.
  // Both are deliberate: a claim attributed to a paragraph the student did not
  // write it in corrupts that paragraph's role and every component that reads
  // it.
  const located = computeClaimSpans(input.text, input.claims).map((span) => ({
    claimId: span.claim.id,
    start: span.start
  }))
  const claimsByParagraph = bucketClaimsByParagraph(spans, located)

  const { roles, warranted } = heuristicRoles({ paragraphs: spans, claimsByParagraph })

  const paragraphs: ParagraphOutline[] = spans.map((span, i) => ({
    index: span.index,
    role: roles[i],
    hasWarrant: warranted[i],
    claimIds: claimsByParagraph.get(span.index) ?? []
  }))

  // The closing paragraph, whether or not it was identified as a conclusion —
  // under heuristic-only labelling most conclusions come back 'unknown', and
  // requiring the label first would mean the partial significance credit could
  // essentially never be earned.
  const closing = spans.find((span) => paragraphs[span.index - 1]?.role === 'conclusion') ?? spans.at(-1)
  const soWhatInConclusion = closing ? hasSignificanceMarker(closing.text) : false

  const { score, components, complete } = scoreDraft(paragraphs, { soWhatInConclusion })

  return {
    documentId: input.documentId,
    sourceHash: sourceHashFor(input.text),
    schemaVersion: STRUCTURE_SCHEMA_VERSION,
    paragraphs,
    score,
    components,
    complete,
    rolesFrom: 'heuristic',
    coverage: input.coverage,
    weaknesses: findWeaknesses({
      paragraphs,
      claimsWithoutEvidence: input.claimsWithoutEvidence,
      soWhatInConclusion
    }),
    analyzedAt: input.analyzedAt
  }
}
