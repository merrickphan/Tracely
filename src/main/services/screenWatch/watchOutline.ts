import type { Claim, DocumentOutline } from '@shared/types'
import type { ScreenWatchStructure } from '@shared/ipc-contract'
import { splitParagraphs } from '@shared/paragraphSplit'
import { draftStats } from './draftStats'
import { analyzeStructure } from '../structure/analyzeStructure'
import { claimsWithoutEvidence, computeEvidenceCoverage } from '../structure/evidenceCoverage'
import { describeFit, structureFit } from './structureFit'
import { logScreenWatch } from './debugLog'

/**
 * The structural read of a document being watched in another application.
 *
 * The same engine the in-app Structure rail uses, pointed at UI Automation's
 * text instead of the editor's. Everything here is local — paragraph splitting,
 * role heuristics, the rubric, the weakness rules — so unlike critique this can
 * run automatically without spending anything, the same reasoning that lets
 * `triggerEvidenceSearch` auto-run against the free academic APIs.
 *
 * Nothing is persisted. `analyzeStructure` takes `documentId`/`analysisId` as
 * nullable precisely so an ephemeral caller like this one can use it, and
 * `saveOutline` is never involved.
 */

/** Enough of a paragraph to recognise it in a 364px-wide row. */
const PREVIEW_CHARS = 90

/**
 * Defensive ceiling mirroring MAX_TEXT_CHARS in ipc/structureHandlers.ts. That
 * path has a zod schema in front of it; this one has no gate at all, and UIA
 * returns the whole document rather than the visible part.
 */
const MAX_TEXT_CHARS = 400_000

/**
 * First line of each paragraph, index-aligned to 1-based `ParagraphOutline.index`.
 *
 * Truncation is by code point, not by UTF-16 unit, so a slice can never land
 * inside a surrogate pair and emit a lone half — which renders as a replacement
 * glyph in the overlay and looks like a corrupted read of the user's document.
 */
export function paragraphPreviews(texts: string[], maxChars = PREVIEW_CHARS): string[] {
  return texts.map((text) => {
    const collapsed = text.replace(/\s+/g, ' ').trim()
    const points = Array.from(collapsed)
    return points.length <= maxChars ? collapsed : `${points.slice(0, maxChars).join('')}…`
  })
}

export interface WatchOutlineInput {
  /**
   * The text the claims were detected against — NOT the current UIA snapshot.
   *
   * Every paragraph index, role and weakness is a joint function of the text
   * and the claims found in it. Analyzing live text while bucketing claims
   * detected from older text lets a claim relocate into a different paragraph
   * and flips its role underneath the score. Using the analyzed text also damps
   * the whole feature for free: it changes at most once per detection, which is
   * already rate-limited to one per MIN_ANALYSIS_INTERVAL_MS past an 80-char
   * delta, so the score reads as a fresh reading rather than a live meter.
   */
  analyzedText: string
  /** Claims with their evidence scores already folded in — see withEvidenceScores. */
  claims: Claim[]
  analyzedAt: string
}

/**
 * Returns null when the extracted text cannot be trusted to have real paragraph
 * boundaries, or when the draft is too short for the rubric to have an opinion.
 * The overlay then shows nothing at all, which is the honest output — see
 * structureFit.ts for why silence is the right failure direction here.
 */
export function computeWatchOutline({
  analyzedText,
  claims,
  analyzedAt
}: WatchOutlineInput): ScreenWatchStructure | null {
  const text = analyzedText.length > MAX_TEXT_CHARS ? analyzedText.slice(0, MAX_TEXT_CHARS) : analyzedText
  const spans = splitParagraphs(text)

  const fit = structureFit({ paragraphs: spans.map((s) => s.text), textLength: text.length })
  if (fit !== 'ok') {
    logScreenWatch(`structure: no reading — ${describeFit(fit)} (${spans.length} paragraph(s))`)
    return null
  }

  const coverage = computeEvidenceCoverage(claims)
  const outline: DocumentOutline = analyzeStructure({
    documentId: null,
    analysisId: null,
    text,
    claims,
    claimsWithoutEvidence: claimsWithoutEvidence(claims),
    coverage,
    analyzedAt
  })

  // Same failure direction as `fit` above, for a reason `structureFit` cannot
  // see: it judges whether the EXTRACTED TEXT is trustworthy, while this asks
  // whether the rubric can measure a draft this short at all. A one- or
  // two-paragraph draft has an empty body slice, so four of six components are
  // unreachable and the ceiling is 20/100 — an F for a paragraph that may be
  // excellent. No chip is the honest output; see MIN_PARAGRAPHS_FOR_RUBRIC.
  if (!outline.applicable) {
    logScreenWatch(`structure: no reading — draft too short to score (${spans.length} paragraph(s))`)
    return null
  }

  return {
    score: outline.score,
    complete: outline.complete,
    components: outline.components,
    coverage: outline.coverage,
    weaknesses: outline.weaknesses,
    paragraphs: outline.paragraphs,
    previews: paragraphPreviews(spans.map((s) => s.text)),
    // Over `text`, not `analyzedText`: the truncated copy is what every other
    // figure here was computed from, and a word count that disagreed with the
    // paragraphs beside it would be the more confusing kind of wrong.
    stats: draftStats(text)
  }
}
