import type { ParagraphOutline, ParagraphRole, StructureComponents } from '@shared/types'

/**
 * The draft score.
 *
 * This is a FORMULA, not a model output — the same stance `search/scoring.ts`
 * takes for evidence strength, and for the same reason: a number a student is
 * asked to act on has to be one they can argue with. Every point below traces
 * to a specific paragraph and a specific rule, and the panel shows the role
 * labels the number was computed from so a wrong label is visibly wrong rather
 * than mysteriously costly.
 *
 * The honest caveat, stated here because it is easy to oversell: the score is
 * deterministic GIVEN the role vector, and from the relay classifier onward
 * that vector is model output. Deterministic scoring of an uncertain input is
 * a real improvement over asking a model for a number — it cannot drift
 * between runs, it cannot be flattered into a higher score, and it is
 * testable — but it is not the same as a measurement.
 *
 * What is deliberately NOT in here: anything about evidence. `strengthScore`
 * already contains a source-count factor, so folding retrieval in would
 * double-count it — and worse, would make the score track how searchable the
 * topic is. A close reading of a novel would cap around 50 by construction
 * because the academic APIs have nothing to say about it. Evidence coverage is
 * reported beside this number, never inside it.
 */

export const COMPONENT_MAX: StructureComponents = {
  thesis: 20,
  governingClaims: 20,
  warrant: 20,
  counterargument: 15,
  significance: 15,
  conclusion: 10
}

/** Signals the score needs that can only be read off the paragraph TEXT. */
export interface ScoreSignals {
  /**
   * A "so what" phrase in the concluding paragraph. Earns partial significance
   * credit for an essay that gestures at stakes in its conclusion without
   * devoting a paragraph to them.
   */
  soWhatInConclusion: boolean
  /**
   * A significance marker anywhere in the draft.
   *
   * Read off the TEXT rather than the role vector, because a paragraph carries
   * one role and the closing paragraph is routinely both the conclusion and the
   * place the stakes are stated. Judging the last paragraph as a conclusion
   * first — which it is — used to cost the essay all 15 significance points for
   * work it had plainly done. This credits the work; the role decides the
   * conclusion.
   */
  significanceAnywhere?: boolean
  /**
   * Whether paragraph 1 is the essay's title. It is 'unknown' by rights — a
   * title states no claim — but counting it as unlabelled made every titled
   * essay's reading "provisional", which is the panel telling the writer it
   * could not read a paragraph when the paragraph was a heading.
   */
  titleParagraph?: boolean
}

export interface DraftScore {
  score: number
  components: StructureComponents
  complete: boolean
  /**
   * Always true. Retained because `src/shared/types.ts` carries this field and
   * shared files are additive — see the branch rules in CLAUDE.md.
   *
   * It used to be false for a draft under three paragraphs, and every surface
   * rendered a "not enough draft to grade" state instead of a number. That was
   * a deliberate choice with a real case behind it, recorded here because the
   * reasoning has not stopped being true, only stopped being what this product
   * does: a genuinely strong single-paragraph MUN position paper — nine
   * sentences, five citations, a thesis and a close — scored 20/100 and was
   * told it had no argument in it.
   *
   * The mechanism is still there, and is worth knowing when reading a low
   * score. Four of the six components can only be earned by a paragraph OTHER
   * than the first or last: `governingClaims` reads `roles.slice(1, -1)`,
   * `warrant` reads the claim and evidence paragraphs inside it, and
   * counterargument and significance need somewhere to live. Hand this rubric
   * one paragraph and that slice is empty, so 80 points are unreachable however
   * good the writing is.
   *
   * Owner's call, 2026-08-16: "Worst case scenario it would be a 0/100, I never
   * want it to say not enough info to grade." A number every time, including
   * the ones that hurt.
   */
  applicable: boolean
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function has(roles: ParagraphRole[], role: ParagraphRole): boolean {
  return roles.includes(role)
}

/**
 * Roles whose paragraphs are eligible to count as governed by a claim.
 *
 * The other four are excluded because they are doing a different job and
 * crediting them here would double-pay for it: `counterargument` and
 * `significance` have components of their own, `transition` is by definition
 * argumentative filler, and `thesis` states the draft's position rather than a
 * sub-point (it is outside the body slice anyway, but a delayed thesis makes
 * that slice's start move, so this stays belt-and-braces).
 *
 * `unknown` is excluded too, and that is the important one: a labeller that
 * could not say what a paragraph is doing has not established that it governs
 * anything. Crediting it would turn "we could not read this" into points,
 * which is the one thing the whole `unknown`-is-a-real-answer design exists to
 * prevent.
 */
const GOVERNING_ELIGIBLE_ROLES = new Set<ParagraphRole>(['claim', 'evidence', 'reasoning'])

/**
 * Whether a body paragraph counts toward `governingClaims`.
 *
 * The fallback is what makes this safe to ship into a database full of stored
 * outlines and into a two-repo release where the relay may be a deploy behind:
 * with no `statesClaim`, this is `role === 'claim'` — bit-for-bit the old
 * component. See ParagraphOutline.statesClaim.
 */
function governsAClaim(paragraph: ParagraphOutline): boolean {
  if (paragraph.statesClaim === undefined) return paragraph.role === 'claim'
  return paragraph.statesClaim && GOVERNING_ELIGIBLE_ROLES.has(paragraph.role)
}

export function scoreDraft(paragraphs: ParagraphOutline[], signals: ScoreSignals): DraftScore {
  const zero: StructureComponents = {
    thesis: 0,
    governingClaims: 0,
    warrant: 0,
    counterargument: 0,
    significance: 0,
    conclusion: 0
  }

  // An empty draft is the one case with nothing to compute over — there are no
  // paragraphs to read a role off. It still reports `applicable: true` so no
  // surface has to render a "cannot grade" state; 0/100 for an empty document
  // is a true statement rather than a refusal.
  if (paragraphs.length === 0) {
    return { score: 0, components: zero, complete: false, applicable: true }
  }

  const roles = paragraphs.map((p) => p.role)
  const complete = roles.every(
    (role, i) => role !== 'unknown' || (signals.titleParagraph === true && i === 0)
  )

  // --- Thesis (20) -------------------------------------------------------
  // Position matters, so it is scored rather than merely detected. A thesis
  // stated up front tells the reader what to do with everything that follows;
  // the same sentence buried near the end is a discovery the reader had to
  // make unaided, which is worth partial credit and not full.
  //
  // "Up front" is a FRACTION of the draft, not paragraph 1 or 2. The absolute
  // test came from the five-paragraph essay, where the opening third IS the
  // first paragraph, and it silently punished every longer shape: a 14
  // paragraph essay that spends four paragraphs establishing what the
  // literature actually says and states its thesis in the fifth was docked ten
  // points for it, on the same rule that would give full marks to a
  // three-paragraph draft asserting its thesis in line one. Earning a thesis
  // over four paragraphs is architecture, not burial, and the reader of
  // paragraph 5 of 14 has not had to find anything unaided.
  //
  // A third, and never less than the first two paragraphs — so every draft
  // short enough for the original rule to have been written about scores
  // exactly as it did.
  const thesisAt = roles.indexOf('thesis')
  const upFront = Math.max(1, Math.floor(paragraphs.length / 3))
  const thesis =
    thesisAt === -1 ? 0 : thesisAt <= upFront ? COMPONENT_MAX.thesis : COMPONENT_MAX.thesis / 2

  // --- Governing claims (20) ---------------------------------------------
  // A FRACTION of the body, never a count. This is what stops the score being
  // a length proxy: a 16-paragraph essay and an 8-paragraph one with the same
  // proportion of claim-bearing body paragraphs score identically, and adding
  // filler paragraphs lowers the score rather than raising it.
  //
  // Full marks at half the body carrying an explicit claim, not all of it —
  // evidence, reasoning and transition paragraphs are supposed to exist, and
  // an essay where every paragraph opens a new claim is a list, not an
  // argument.
  // The body starts after the THESIS, not after the first paragraph.
  //
  // `slice(1, -1)` assumed paragraph 1 is always the introduction. A titled
  // essay breaks that: `splitParagraphs` makes the title paragraph 1 and the
  // introduction paragraph 2, so the intro was counted as a body paragraph and
  // diluted the ratio — it carries the thesis, never a governing claim, so it
  // could only ever drag the fraction down. A real four-paragraph essay lost
  // half this component for having a heading.
  //
  // Falls back to the old slice when no thesis was labelled, which is the case
  // the original was written for and still correct there.
  //
  // What counts is `statesClaim`, NOT `role === 'claim'` — see governsAClaim.
  // The old test asked which paragraphs are *primarily* claims, and this
  // component is not asking that: a body paragraph that opens with its
  // sub-point and then spends four sentences citing studies for it is
  // primarily evidence, and is exactly the paragraph the rubric wants to
  // reward. Both labellers agreed on calling it `evidence` — the model does it
  // by instruction, the heuristics by reaching their citation branch first —
  // so the better-argued the body, the more reliably this scored zero.
  const body = paragraphs.slice(thesisAt === -1 ? 1 : thesisAt + 1, -1)
  const claimBearing = body.filter(governsAClaim).length
  const expectedClaims = Math.max(1, Math.ceil(body.length * 0.5))
  const governingClaims = COMPONENT_MAX.governingClaims * clamp01(claimBearing / expectedClaims)

  // --- Warrant (20) ------------------------------------------------------
  // Measured only over the paragraphs where a warrant is owed — ones making a
  // claim or presenting evidence. Averaging over the whole essay would punish
  // an intro and conclusion for not explaining evidence they never cited.
  //
  // `reasoning` paragraphs are owed a warrant AND satisfy it by existing, and
  // leaving them out entirely was a 20-point hole. The classifier's own
  // definition of the role is "explains how evidence bears on a claim, or
  // works through an implication — no new evidence and no new claim": that IS
  // the warrant, written out at paragraph length instead of signposted in a
  // clause. A draft that devotes whole paragraphs to the link between its
  // evidence and its claim was getting nothing for them, while a draft that
  // wrote "therefore" once inside a claim paragraph got full marks.
  //
  // It is deliberately not gated on `hasWarrant`. That field asks whether a
  // paragraph doing something ELSE also explains its link; asking it of a
  // paragraph whose whole job is the explanation is asking the model to
  // signpost its own signposting, and it answers false often enough that the
  // role would have cost points rather than earned them.
  const isReasoning = (p: ParagraphOutline): boolean => p.role === 'reasoning'
  const owed = paragraphs.filter(
    (p) => p.role === 'claim' || p.role === 'evidence' || isReasoning(p)
  )
  const warrant =
    owed.length === 0
      ? 0
      : COMPONENT_MAX.warrant *
        (owed.filter((p) => isReasoning(p) || p.hasWarrant).length / owed.length)

  // --- Counterargument (15) ----------------------------------------------
  // Binary, because the property is binary: an essay either takes the other
  // side seriously somewhere or it doesn't. Scaling this with how MANY
  // objections were raised would reward hedging.
  const counterargument = has(roles, 'counterargument') ? COMPONENT_MAX.counterargument : 0

  // --- Significance (15) -------------------------------------------------
  const significance =
    has(roles, 'significance') || signals.significanceAnywhere === true
      ? COMPONENT_MAX.significance
      : signals.soWhatInConclusion
        ? COMPONENT_MAX.significance / 2
        : 0

  // --- Conclusion (10) ---------------------------------------------------
  // Lowest weight on purpose. It is the easiest component to satisfy and the
  // least diagnostic — an essay with a tidy conclusion and no counterargument
  // is in worse shape than the reverse, and the weights should say so.
  const conclusionAt = roles.lastIndexOf('conclusion')
  const conclusion =
    conclusionAt === -1
      ? 0
      : conclusionAt === roles.length - 1
        ? COMPONENT_MAX.conclusion
        : COMPONENT_MAX.conclusion / 2

  const components: StructureComponents = {
    thesis,
    governingClaims,
    warrant,
    counterargument,
    significance,
    conclusion
  }

  const score = Math.round(
    thesis + governingClaims + warrant + counterargument + significance + conclusion
  )

  // For anyone re-adding a length floor here: the panel no longer has a
  // "cannot grade" state to fall back to. Suppressing the number now renders a
  // card with nothing in it.
  return { score, components, complete, applicable: true }
}
