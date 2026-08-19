import type { ScreenWatchClaimEvidence, ScreenWatchClaimSummary, ScreenWatchProblemKind } from '@shared/ipc-contract'
import { hasRelevantSource } from '@shared/problemKind'
import { retrievalScopeFor, type OutOfScopeReason } from '@shared/retrievalScope'
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
import { summariseCritique } from '@shared/critiqueSummary'

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
  // Attribution, and the worst of it: a source that does not appear to exist.
  'fabricated-citation': DESIGN_RED,
  // Reasoning: the sentence does not follow, or asserts something false.
  'contradicted-claim': DESIGN_RED,
  // Orange, with the evidence group. This was RED, the design's colour for weak
  // reasoning, and the colour was the loudest part of the mislabelling: a
  // sentence whose SOURCES do not carry it was drawn in the hue reserved for a
  // sentence that does not think straight. See the kind's note in problemKind.ts.
  'unsupported-by-evidence': DESIGN_ORANGE,
  // Neither reasoning nor evidence: the claim is defensible and the
  // quantifier is not. Amber because nothing here is wrong.
  'overstated-claim': DESIGN_AMBER,
  // Evidence: nothing found, or what was found does not carry it.
  'unverified-statistic': DESIGN_ORANGE,
  'no-sources': DESIGN_ORANGE,
  'weak-evidence': DESIGN_ORANGE,
  'partial-evidence': DESIGN_ORANGE,
  // Attribution: the sentence needs a citation, or the one it has is suspect.
  'missing-citation': DESIGN_AMBER,
  'cited-unverified': DESIGN_AMBER,
  // Amber, with the attribution group rather than the evidence one. Orange is
  // the design's colour for "the evidence is missing or thin", and that is a
  // finding about the literature — the one thing this kind exists to stop
  // asserting. What is actually left to do here is add a citation, which is
  // what amber means everywhere else in the palette.
  'outside-index': DESIGN_AMBER,
  // Nothing known yet — deliberately the quietest thing on screen, since it
  // resolves on its own within a few seconds. Not a state the design draws.
  searching: '#9a9ba1'
}

/** Plain-language name for the mark, used as the underline's tooltip. */
export const PROBLEM_LABEL: Record<ScreenWatchProblemKind, string> = {
  // Hedged on purpose. The search covers four academic indexes, which do not
  // hold every real source — so the honest claim is that Tracely could not
  // find it, not that the student invented it. The verdict is serious enough
  // that overstating it once would cost the whole feature its credibility.
  'fabricated-citation': 'Source not found — may be fabricated',
  'contradicted-claim': 'Contradicted — check this fact',
  'unsupported-by-evidence': 'Evidence does not carry this',
  'overstated-claim': 'Overstated — narrow this',
  'unverified-statistic': 'Unverified statistic',
  'no-sources': 'No supporting sources',
  'weak-evidence': 'Evidence is weak',
  'cited-unverified': 'Citation may not support this',
  'partial-evidence': 'Partially supported',
  'missing-citation': 'Missing citation',
  // Not "unverified" and not "no sources". Both of those are verdicts on the
  // sentence; this one is a disclosure about the search.
  'outside-index': 'Not in these databases',
  searching: 'Checking…'
}

/**
 * What the card says when the databases were never going to hold the sentence.
 *
 * Five wordings rather than one, because the repair is different in each case
 * and a generic "we could not check this" leaves the writer exactly where the
 * old "No supporting sources" did — knowing something is wrong, with no idea
 * what to do. Each of these names the source the writer already has.
 *
 * Every one is phrased as a fact about the SEARCH, not about the sentence. The
 * claim may well be true and well-evidenced; Tracely has simply looked in the
 * wrong library for it, and says so.
 */
const OUT_OF_SCOPE_TITLE: Record<OutOfScopeReason, string> = {
  'primary-text': 'Cite the text itself',
  'legal-text': 'Cite the statute itself',
  'local-fact': 'Cite the record itself',
  prediction: 'A claim about the future',
  personal: 'Your own observation'
}

const OUT_OF_SCOPE_BODY: Record<OutOfScopeReason, string> = {
  'primary-text':
    'This reads as a claim about the work itself, and Tracely searches journal databases — they hold criticism about a novel, not the novel. Cite the page or line you are reading.',
  'legal-text':
    'This reads as a claim about what a law says. Journal databases index articles about legislation, not the text of it. Cite the section directly.',
  'local-fact':
    'This reads as a claim about one institution’s own records. Nothing in the academic databases covers a single district or campus. Cite the report, minutes or dataset you got it from.',
  prediction:
    'This is a claim about something that has not happened yet, so no study can confirm it. Cite the projection you are relying on, and say whose it is.',
  personal:
    'This is your own observation, which is a legitimate thing to put in an essay and not something a database can check. Say plainly that it is yours.'
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
  // Was `evidence.count === 0` — the number of results RETURNED, which is
  // eight for essentially every claim (see problemKind's hasRelevantSource).
  // So this copy could describe "8 sources came back, but they score 0/100"
  // under an underline that problemKindsFor had already decided says "No
  // supporting sources". One question, asked the same way in both places.
  if (!hasRelevantSource(evidence.breakdown)) return 'none'
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
        // Unreachable since 2026-08-16: problemKindsFor stopped raising
        // 'cited-unverified' at all when nothing relevant came back, which is
        // what this branch was the apology for. Left rather than deleted so the
        // wording survives if the kind's condition ever loosens again.
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
  claim: Pick<ScreenWatchClaimSummary, 'claimType' | 'hasInlineCitation' | 'critique' | 'text'>,
  evidence: ScreenWatchClaimEvidence,
  kind: Exclude<ScreenWatchProblemKind, 'searching'>
): ProblemCopy {
  if (kind === 'outside-index') {
    // The reason is recomputed from the claim's text rather than carried on the
    // payload. It is a pure function of that string — the same one main ran to
    // decide the kind — so a second field would be a second copy of one answer,
    // free to disagree with the underline after an edit.
    const reason = retrievalScopeFor(claim.text)
    return {
      title: OUT_OF_SCOPE_TITLE[reason ?? 'local-fact'],
      description: OUT_OF_SCOPE_BODY[reason ?? 'local-fact'],
      // Never "Find a source". The card has just said this search cannot find
      // one, and offering the search anyway is how a disclosure turns back into
      // a wild goose chase. The writer knows where their own source is.
      action: 'Cite it yourself'
    }
  }
  if (kind === 'overstated-claim') {
    // Was falling through to problemCopyFor, i.e. to the retrieval copy — and
    // that is the one outcome problemKind.ts says this kind exists to prevent.
    // On the preview fixture (c4: an 'overstated' verdict, a narrowed sentence
    // already in hand, evidence scoring 68) the card read "Partially supported
    // … Add citation": a sentence one quantifier away from being fine, sent off
    // to find sources that cannot exist for "always". The verdict is the
    // critique's, so the copy belongs beside the other two critique verdicts.
    return {
      title: 'Overstated — narrow this',
      description:
        summariseCritique(claim.critique) ??
        'The substance here is defensible; the phrasing is not. No evidence could support it as strongly as it is stated.',
      action: 'Suggest fix'
    }
  }
  if (kind === 'contradicted-claim') {
    // The fact-check verdict, not the rigor one. The critique text is
    // instructed to state the correct fact plainly when it fires, so it is the
    // description rather than a generic line about reasoning.
    return {
      title: 'Contradicted — check this fact',
      description:
        summariseCritique(claim.critique) ??
        'A specific fact asserted here appears to be wrong. Check it against the original source before this goes any further.',
      action: 'Suggest fix'
    }
  }
  if (kind === 'unsupported-by-evidence') {
    // Was titled "Weak reasoning", which is what this kind is named after and
    // what it is not. `weak` and `unsupported` come out of Pass 3, which judges
    // whether the EVIDENCE backs the claim as phrased — a question about
    // sources, not about thinking. Owner's case, 2026-08-19: a sentence
    // conceding a failed replication and bounding its own claim, underlined in
    // red as bad reasoning because its cited source turned out to be about
    // something else.
    return {
      title: 'Evidence does not carry this',
      description:
        summariseCritique(claim.critique) ??
        'The sources found do not support this claim as it is phrased. Narrow the claim, or find a source that speaks to it directly.',
      action: 'Suggest fix'
    }
  }
  return problemCopyFor(claim, evidence, kind)
}

/**
 * Verdicts the critique reached about the sentence, as opposed to findings
 * retrieval reached about the literature.
 *
 * Kept as its own predicate — rather than folded into `opensFixFlow` below —
 * because it is the question `popoverCopyFor` answers: these are the kinds
 * whose description is the critique text verbatim.
 */
export function isReasoningProblem(kind: ScreenWatchProblemKind): boolean {
  return kind === 'unsupported-by-evidence' || kind === 'contradicted-claim'
}

/**
 * Whether the popover's primary button opens the fix card or the citation flow.
 *
 * 'overstated-claim' is here and NOT in `isReasoningProblem`, and the split is
 * deliberate: it is not a finding about reasoning (see problemKind.ts, which
 * ranks it apart from both truth and support findings), but it is the one kind
 * that reliably arrives WITH a replacement sentence attached — the relay sets
 * `suggestedRevision` for overstatement and for nothing else. Routing it to
 * retrieval, which is what happened before, sent the writer looking for
 * evidence for "always" while the narrowed sentence sat unread on the claim.
 */
export function opensFixFlow(kind: ScreenWatchProblemKind): boolean {
  return isReasoningProblem(kind) || kind === 'overstated-claim'
}

// `insertsCitation` lives in shared/citationAction.ts — a leaf, so `npm test`
// can load it. This module value-imports @shared/problemKind and cannot be.
export { insertsCitation } from '@shared/citationAction'
