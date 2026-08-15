import type { ScreenWatchClaimEvidence, ScreenWatchClaimSummary, ScreenWatchProblemKind } from '@shared/ipc-contract'
import type { ClaimType } from '@shared/types'

/**
 * What a flagged claim is called, what colour its mark is, and what the popover
 * says about it.
 *
 * Lifted out of OverlayApp.tsx unchanged, because the document editor now draws
 * the same underlines over Tracely's own writing surface that Screen Watch
 * draws over other apps'. Two copies of this would be two products: the same
 * sentence would be amber in one window and red in the other, and the wording
 * that was argued into shape here (see problemCopyFor) would drift in whichever
 * copy was edited second.
 *
 * Pure text and colour — no JSX. The two surfaces render very differently (the
 * overlay uses inline styles and its own stylesheet, the main app uses
 * index.css classes), so they share the decisions and not the markup.
 */

/**
 * The design's three underline colours, read off the Figma frames rather than
 * chosen here: `#ff5900` on the "Inline Detection (Statistic)" marks, `#ffb800`
 * on "(Citation)", `#d93636` on "(Reasoning)". The popover's dot is the same
 * colour as the mark that opened it, in all three.
 *
 * Three, for eight problem kinds — so the mapping below is a grouping, not a
 * palette of its own. What the design is saying with the colour is which of
 * three KINDS of trouble a sentence is in: is the reasoning wrong (red), is the
 * evidence missing or thin (orange), or is the attribution missing (amber).
 * Inventing a fourth and fifth hue for our extra kinds is exactly the drift
 * that produced a purple statistic underline and an orange "missing citation"
 * one — the two the design has, with their colours swapped.
 */
export const DESIGN_ORANGE = '#ff5900'
export const DESIGN_AMBER = '#ffb800'
export const DESIGN_RED = '#d93636'

/**
 * The mark's colour, by what is wrong — never by what kind of sentence it is.
 *
 * Colouring by claimType meant every factual claim in a document was the same
 * orange whatever state it was in, so the underline — the part people actually
 * read — carried no information about the problem. See problemKind.ts.
 */
export const PROBLEM_COLOR: Record<ScreenWatchProblemKind, string> = {
  // Reasoning: the sentence does not follow, or asserts something false.
  'contradicted-claim': DESIGN_RED,
  'weak-reasoning': DESIGN_RED,
  // Evidence: nothing found, or what was found does not carry it.
  'unverified-statistic': DESIGN_ORANGE,
  'no-sources': DESIGN_ORANGE,
  'weak-evidence': DESIGN_ORANGE,
  'partial-evidence': DESIGN_ORANGE,
  // Attribution: the sentence needs a citation, or the one it has is suspect.
  'missing-citation': DESIGN_AMBER,
  'cited-unverified': DESIGN_AMBER,
  // Nothing known yet — deliberately the quietest thing on screen, since it
  // resolves on its own within a few seconds. Not a state the design draws.
  searching: '#9a9ba1'
}

/** Plain-language name for the mark, used as the underline's tooltip. */
export const PROBLEM_LABEL: Record<ScreenWatchProblemKind, string> = {
  'contradicted-claim': 'Contradicted — check this fact',
  'weak-reasoning': 'Weak reasoning',
  'unverified-statistic': 'Unverified statistic',
  'no-sources': 'No supporting sources',
  'weak-evidence': 'Evidence is weak',
  'cited-unverified': 'Citation may not support this',
  'partial-evidence': 'Partially supported',
  'missing-citation': 'Missing citation',
  searching: 'Checking…'
}

export type Bucket = 'statistic' | 'factual' | 'causal' | 'other'

export function bucketFor(claimType: ClaimType): Bucket {
  if (claimType === 'statistic') return 'statistic'
  if (claimType === 'factual') return 'factual'
  if (claimType === 'causal') return 'causal'
  return 'other'
}

type SupportLevel = 'none' | 'weak' | 'mixed' | 'strong'

/** The same 70/40 bands every other score in the product uses. */
function supportLevelFor(evidence: ScreenWatchClaimEvidence): SupportLevel {
  if (evidence.count === 0) return 'none'
  if (evidence.score >= 70) return 'strong'
  if (evidence.score >= 40) return 'mixed'
  return 'weak'
}

const KIND_NOUN: Record<Bucket, string> = {
  statistic: 'figure',
  factual: 'claim',
  causal: 'cause-and-effect claim',
  other: 'statement'
}

export interface ProblemCopy {
  title: string
  description: string
  action: string
}

/**
 * Title, description AND the primary button's label for a claim whose evidence
 * search has resolved.
 *
 * The action belongs here, with the diagnosis, because it kept drifting from
 * it. The label used to be computed separately as `evidence.count > 0 ? 'Add
 * citation' : 'Find a source'` — binary on whether anything came back at all —
 * so a card correctly titled "Evidence is weak … they are related rather than
 * confirming" still offered "Add citation" underneath, telling the student to
 * cite the very sources it had just told them not to lean on. One return value
 * now, so they cannot disagree again.
 */
export function problemCopyFor(
  claim: Pick<ScreenWatchClaimSummary, 'claimType' | 'hasInlineCitation'>,
  evidence: ScreenWatchClaimEvidence,
  kind: ScreenWatchProblemKind
): ProblemCopy {
  const bucket = bucketFor(claim.claimType)
  const level = supportLevelFor(evidence)
  const noun = KIND_NOUN[bucket]
  const n = evidence.count
  const sources = `${n} source${n === 1 ? '' : 's'}`

  if (kind === 'cited-unverified') {
    return {
      title: 'Citation may not support this',
      description:
        evidence.count === 0
          ? `You have cited this ${noun}, but a search of the academic databases found nothing carrying it. Either the source is not indexed — or it does not say this.`
          : `You have cited this ${noun}, but the ${sources} found score ${evidence.score}/100 for supporting it. Check the source says what you have attributed to it.`,
      action: 'Compare sources'
    }
  }

  if (level === 'none') {
    // "Unverified statistic" is the design's wording, and it is the better one:
    // "figure" reads as a chart as easily as a number.
    if (claim.hasInlineCitation) {
      return {
        title: bucket === 'statistic' ? 'Unverified statistic' : 'Source not found',
        description: `You have cited this ${noun}, but a search of the academic databases found nothing carrying it. That can mean the source is not indexed — or that it does not say this.`,
        action: 'Find a source'
      }
    }
    return {
      title: bucket === 'statistic' ? 'Unverified statistic' : 'No supporting sources',
      description:
        bucket === 'statistic'
          ? 'A search of the academic databases turned up nothing carrying this statistic. Check the number against its original source before citing it.'
          : `A search of the academic databases turned up nothing supporting this ${noun}. It may still be true — but you have nothing to cite for it yet.`,
      action: 'Find a source'
    }
  }

  if (level === 'weak') {
    return {
      title: bucket === 'causal' ? 'Cause and effect not established' : 'Evidence is weak',
      description:
        bucket === 'causal'
          ? `${sources} touch on this, but score ${evidence.score}/100 for supporting a causal link specifically. Correlation in the literature is not the same as the cause you have asserted here.`
          : `${sources} came back, but they score ${evidence.score}/100 for actually supporting this ${noun} — they are related rather than confirming. Read them before leaning on them.`,
      // Not "Add citation". The card just said these do not confirm the claim;
      // the honest next step is to look at them, which is what the picker shows.
      action: 'Review the sources'
    }
  }

  if (level === 'mixed') {
    return {
      title: 'Partially supported',
      description: `${sources} score ${evidence.score}/100 for this ${noun} — enough to cite, but they qualify it rather than confirm it outright. Consider softening how strongly it is stated.`,
      action: 'Add citation'
    }
  }

  // strong — the claim holds up. What is left depends entirely on whether the
  // writer has already attributed it, and telling someone who cited properly
  // that they are "Missing citation" is the single least credible thing this
  // card can do.
  if (claim.hasInlineCitation) {
    return {
      title: 'Cited — worth checking',
      description: `${sources} agree with this ${noun} (${evidence.score}/100). Tracely cannot read the source you cited, so check it says what you have attributed to it.`,
      action: 'Compare sources'
    }
  }
  return {
    title: 'Missing citation',
    description: `${sources} support this ${noun} (${evidence.score}/100). It reads as unattributed, though — add a citation so the reader can follow it.`,
    action: 'Add citation'
  }
}

/**
 * The full popover copy for any problem kind, including the two that are
 * decided by the critique rather than by retrieval.
 *
 * `searching` is not handled here: it has no diagnosis to report and both
 * surfaces draw it as a spinner rather than a title/description/button.
 */
export function popoverCopyFor(
  claim: Pick<ScreenWatchClaimSummary, 'claimType' | 'hasInlineCitation' | 'critique'>,
  evidence: ScreenWatchClaimEvidence,
  kind: Exclude<ScreenWatchProblemKind, 'searching'>
): ProblemCopy {
  if (kind === 'contradicted-claim') {
    // The fact-check verdict, not the rigor one. The critique text is
    // instructed to state the correct fact plainly when it fires, so it is the
    // description rather than a generic line about reasoning.
    return {
      title: 'Contradicted — check this fact',
      description:
        claim.critique ??
        'A specific fact asserted here appears to be wrong. Check it against the original source before this goes any further.',
      action: 'Suggest fix'
    }
  }
  if (kind === 'weak-reasoning') {
    return {
      title: 'Weak reasoning',
      description:
        claim.critique ??
        "This conclusion doesn't clearly follow from the evidence cited. Consider strengthening the argument.",
      action: 'Suggest fix'
    }
  }
  return problemCopyFor(claim, evidence, kind)
}

/** Whether the primary button fixes prose or goes looking for a source. */
export function isReasoningProblem(kind: ScreenWatchProblemKind): boolean {
  return kind === 'weak-reasoning' || kind === 'contradicted-claim'
}
