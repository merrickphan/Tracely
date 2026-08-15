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
  /**
   * The critique's fact-check said a specific assertion in the sentence is
   * wrong — a different finding from weak reasoning, and a worse one.
   *
   * CRITIQUE_SYSTEM_PROMPT reserves the `contradicted` verdict for "the claim
   * asserts a specific fact you're confident is factually wrong", and instructs
   * the model to fall through to the rigor pass whenever it is merely unsure.
   * Folding it in with 'weak-reasoning' printed "Weak reasoning" over the one
   * verdict that is not about reasoning at all, and ranked the most serious
   * thing this product can say below a citation problem.
   */
  | 'contradicted-claim'
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

/** Reasoning that does not follow. 'contradicted' is deliberately NOT here. */
const WEAK_VERDICTS: CritiqueVerdict[] = ['weak', 'unsupported']

/** The 70/40 bands used everywhere else in the product. */
const STRONG = 70
const MIXED = 40

/**
 * EVERY problem this claim has, worst first.
 *
 * A sentence can be in more than one kind of trouble at once, and the two most
 * common pairs are the two most worth knowing about: reasoning that does not
 * follow from evidence that is also thin, and a cited statistic that nothing
 * carries. Returning a single kind meant fixing the one shown revealed a second
 * problem the writer had no idea was there.
 *
 * The predicates below are deliberately independent — each answers one question
 * about the claim — and the ordering is applied afterwards, so adding a kind
 * cannot silently mask an existing one the way an if/else chain does.
 */
export function problemKindsFor({
  claimType,
  hasInlineCitation,
  evidence,
  critiqueVerdict
}: ProblemKindInput): ScreenWatchProblemKind[] {
  // Nothing is known yet, so nothing else can be asserted. Sole kind.
  if (!evidence) return ['searching']

  const kinds: ScreenWatchProblemKind[] = []
  const nothingFound = evidence.count === 0

  if (critiqueVerdict === 'contradicted') kinds.push('contradicted-claim')
  else if (critiqueVerdict && WEAK_VERDICTS.includes(critiqueVerdict)) kinds.push('weak-reasoning')

  // Cited, and the literature we DID find does not back what was attributed.
  // Subsumes the plain evidence bands for a cited claim: "thin support" is the
  // wrong advice when the writer has already named a source.
  //
  // `!nothingFound` is the load-bearing half. This used to fire on zero results
  // too, which turns silence from four ACADEMIC search APIs into an accusation
  // about a sentence the writer has already attributed — and those APIs index
  // journal articles, not UN treaty pages, government programmes, national
  // statistics offices or newspapers, which is what a policy paper actually
  // cites. On an essay that cited an institution on nearly every line, every
  // line came back "Citation may not support this". Absence of evidence in a
  // corpus that was never going to hold it is not evidence of absence.
  if (hasInlineCitation && !nothingFound && evidence.score < MIXED) kinds.push('cited-unverified')

  // A number nothing carries, in a sentence with no citation to check it
  // against. Cited figures are excluded for the reason above: we have not
  // read the source the writer named, so "unverified" would be our word for
  // "not indexed by OpenAlex", which is not what the reader will hear.
  if (nothingFound && !hasInlineCitation && claimType === 'statistic') kinds.push('unverified-statistic')
  if (nothingFound && !hasInlineCitation && claimType !== 'statistic') kinds.push('no-sources')

  if (!nothingFound && !hasInlineCitation) {
    if (evidence.score < MIXED) kinds.push('weak-evidence')
    else if (evidence.score < STRONG) kinds.push('partial-evidence')
    else kinds.push('missing-citation')
  }
  // A cited claim scoring in the middle band is neither settled nor alarming;
  // it is worth saying it is only partly supported.
  if (!nothingFound && hasInlineCitation && evidence.score >= MIXED && evidence.score < STRONG) {
    kinds.push('partial-evidence')
  }

  // An empty list is a real answer, and the caller treats it as "say nothing
  // about this sentence": a cited claim that is well supported, and a cited
  // claim the databases simply have no opinion on, both land here.
  return kinds.sort((a, b) => problemSeverity(a) - problemSeverity(b))
}

/** The worst of them — what the underline is coloured by and the card shows. */
export function problemKindFor(input: ProblemKindInput): ScreenWatchProblemKind {
  return problemKindsFor(input)[0] ?? 'searching'
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
  // Nothing outranks "a fact in this sentence is wrong". Every other kind here
  // is a statement about support; this one is a statement about truth.
  'contradicted-claim',
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
