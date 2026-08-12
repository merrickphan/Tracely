import type { ClaimType, CritiqueVerdict } from '@shared/types'

/**
 * What is actually wrong with a claim — decided once, in main, and sent to the
 * overlay so the underline and the card cannot disagree.
 *
 * They used to. The underline was coloured by `BUCKET_COLOR[bucketFor(claimType)]`
 * — the KIND OF SENTENCE, not the problem — while the popover derived the
 * problem separately in the renderer from evidence and critique. So the mark
 * said "this is a factual claim" (and said it in orange for every factual claim
 * in the document, whatever its state), and only opening the card told you
 * whether the issue was a missing citation, thin evidence, or reasoning that
 * does not follow. Underlining is the part of Screen Watch people actually
 * read; it was carrying the least useful of the two signals.
 *
 * A pure function of state that main already has, so it is one source of truth
 * for the colour, the card's title, and the widget's ordering.
 */
export type ScreenWatchProblemKind =
  /** Evidence search has not come back yet. Nothing is known. */
  | 'searching'
  /** The critique found the reasoning does not follow from the evidence. */
  | 'weak-reasoning'
  /** A number nothing in the literature carries. */
  | 'unverified-statistic'
  /** Searched, and nothing relevant came back at all. */
  | 'no-sources'
  /** Sources exist but score poorly for supporting this specific claim. */
  | 'weak-evidence'
  /** Sources qualify the claim rather than confirming it. */
  | 'partial-evidence'
  /** Well supported, but the sentence is unattributed. */
  | 'missing-citation'
  /**
   * The writer attributed it, and the literature does not back what they
   * attributed. The most alarming state a claim can be in — a wrong citation
   * is worse than a missing one, because the reader has no reason to check it.
   */
  | 'cited-unverified'

export interface ProblemKindInput {
  claimType: ClaimType
  /** The writer's own citation in this sentence — see inlineCitation.ts. */
  hasInlineCitation: boolean
  /** Null until the background search resolves. */
  evidence: { score: number; count: number } | null
  critiqueVerdict: CritiqueVerdict | null
}

const WEAK_VERDICTS: CritiqueVerdict[] = ['weak', 'unsupported', 'contradicted']

/** The 70/40 bands used everywhere else in the product. */
const STRONG = 70
const MIXED = 40

export function problemKindFor({
  claimType,
  hasInlineCitation,
  evidence,
  critiqueVerdict
}: ProblemKindInput): ScreenWatchProblemKind {
  // Reasoning outranks evidence deliberately. A claim can be perfectly well
  // sourced and still not follow from what those sources say, and that is the
  // more interesting failure — it is also the one the writer cannot see by
  // looking at their own citation list.
  if (critiqueVerdict && WEAK_VERDICTS.includes(critiqueVerdict)) return 'weak-reasoning'

  if (!evidence) return 'searching'

  // Checked before the plain evidence bands, because "you cited this and the
  // literature does not carry it" is a different and worse problem from "this
  // is thinly supported" — and the copy for the latter never mentions the
  // citation at all, which is how a possible miscitation used to read as a
  // routine weak-evidence warning.
  if (hasInlineCitation && (evidence.count === 0 || evidence.score < MIXED)) {
    return 'cited-unverified'
  }

  if (evidence.count === 0) {
    // A number is a different kind of problem from an assertion: it is checkable
    // against a specific figure, and being unable to find it is a stronger
    // signal than failing to find support for a general statement.
    return claimType === 'statistic' ? 'unverified-statistic' : 'no-sources'
  }

  if (evidence.score < MIXED) return 'weak-evidence'
  if (evidence.score < STRONG) return 'partial-evidence'

  // Strong, and either uncited (say so) or cited — in which case it is
  // filtered out upstream as settled and never reaches here at all.
  return 'missing-citation'
}

/**
 * Display order, worst first.
 *
 * The widget lists claims by detection confidence, which says how sure Tracely
 * is that a sentence IS a claim — not how much trouble it is in. Sorting the
 * panel by this instead puts the reasoning failure above the tidy claim that
 * merely wants a citation.
 */
const SEVERITY: ScreenWatchProblemKind[] = [
  // Above weak reasoning: a claim whose own citation does not support it is
  // the one error a reader has no prompt to go and check.
  'cited-unverified',
  'weak-reasoning',
  'unverified-statistic',
  'no-sources',
  'weak-evidence',
  'partial-evidence',
  'missing-citation',
  'searching'
]

export function problemSeverity(kind: ScreenWatchProblemKind): number {
  return SEVERITY.indexOf(kind)
}
