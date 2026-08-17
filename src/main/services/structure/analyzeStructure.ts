import { createHash } from 'node:crypto'
import { computeClaimSpans } from '@shared/claimSpans'
import type {
  Claim,
  DocumentOutline,
  EvidenceCoverage,
  ParagraphOutline,
  ParagraphRole
} from '@shared/types'
import { bucketClaimsByParagraph, splitParagraphs } from '@shared/paragraphSplit'
import { hasInlineCitation } from '@shared/inlineCitation'
import { withoutWorksCited } from '@shared/worksCited'
import { measureCohesion } from './cohesion'
import { hasClosingSignificance, heuristicRoles, looksLikeTitle } from './roles'
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

// v2 adds `cohesion`. Bumped rather than left at 1 so stored outlines from
// before it are recomputed instead of restored with the field missing —
// `getStoredOutline` filters on this, and the alternative is a report that
// shows no flow score for every document opened after an update.
export const STRUCTURE_SCHEMA_VERSION = 2

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
  analysisId: string | null
  /** The editor's innerText — see sourceHashFor. */
  text: string
  claims: Claim[]
  /** Detected claims for which no relevant source was found. Empty until a search has run. */
  claimsWithoutEvidence: string[]
  coverage: EvidenceCoverage
  analyzedAt: string
  /**
   * Roles from the relay classifier, when it ran. Absent falls back to the
   * local heuristics, and `rolesFrom` records which was used so the panel can
   * say so rather than presenting both as the same kind of answer.
   */
  classified?: { roles: ParagraphRole[]; warranted: boolean[] } | null
}

export function analyzeStructure(input: AnalyzeStructureInput): DocumentOutline {
  // The reference list is not an argument, and reading it as one breaks the
  // score twice over: `heuristicRoles` labels its lines 'unknown', which sets
  // `complete: false` and makes `findWeaknesses` withhold every whole-draft
  // finding — and the conclusion is found as the LAST paragraph, which in a
  // document with a works-cited section is a citation. So a draft got quietly
  // worse the moment the writer accepted one.
  //
  // A suffix trim (see withoutWorksCited), so the claim spans below — computed
  // against the untrimmed text on purpose — still line up with these
  // paragraphs. Claims that fall inside the list simply bucket past the last
  // paragraph and are dropped, which is the same thing bucketClaimsByParagraph
  // already does for a claim between paragraphs.
  const spans = splitParagraphs(withoutWorksCited(input.text))

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

  // The classifier's answer is used whole or not at all. Merging it with the
  // heuristics per paragraph — say, letting a heuristic fill a paragraph the
  // model returned 'unknown' for — would produce a role vector from two
  // sources with different standards for what justifies a label, and
  // `rolesFrom` could no longer describe it truthfully.
  // `hasCitation` is injected because roles.ts must stay a leaf module that
  // `npm test` can load — it cannot value-import the shared detector itself,
  // and its own fallback pattern finds none of the MLA or author-and-year
  // forms a real paper uses.
  const { roles, warranted } =
    input.classified ??
    heuristicRoles({ paragraphs: spans, claimsByParagraph, hasCitation: hasInlineCitation })

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
  // hasClosingSignificance, not hasSignificanceMarker: this is the CLOSING
  // paragraph, where "the legacy she left behind" is answering "so what?" and
  // not merely narrating. See the note on CLOSING_SIGNIFICANCE_MARKERS for why
  // the wider list is confined to this one position.
  const soWhatInConclusion = closing ? hasClosingSignificance(closing.text) : false

  // A titled essay puts its title in paragraph 1. It is labelled 'unknown' by
  // rights and must not be counted as a paragraph nothing could read — see
  // ScoreSignals.titleParagraph.
  const titleParagraph = spans.length > 1 && looksLikeTitle(spans[0].text)

  const { score, components, complete, applicable } = scoreDraft(paragraphs, {
    soWhatInConclusion,
    titleParagraph
  })

  return {
    documentId: input.documentId,
    analysisId: input.analysisId,
    sourceHash: sourceHashFor(input.text),
    schemaVersion: STRUCTURE_SCHEMA_VERSION,
    paragraphs,
    score,
    components,
    complete,
    applicable,
    rolesFrom: input.classified ? 'model' : 'heuristic',
    coverage: input.coverage,
    weaknesses: findWeaknesses({
      paragraphs,
      claimsWithoutEvidence: input.claimsWithoutEvidence,
      soWhatInConclusion,
      titleParagraph
    }),
    // Measured over the same spans the roles were computed from, so a boundary
    // finding and the role labels either side of it can never describe
    // different splits of the text.
    cohesion: measureCohesion(
      spans.map((span, i) => ({ index: span.index, role: paragraphs[i].role, text: span.text }))
    ),
    analyzedAt: input.analyzedAt
  }
}
