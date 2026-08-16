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
  const complete = roles.every((role) => role !== 'unknown')

  // --- Thesis (20) -------------------------------------------------------
  // Position matters, so it is scored rather than merely detected. A thesis
  // stated up front tells the reader what to do with everything that follows;
  // the same sentence buried in paragraph 6 is a discovery the reader had to
  // make unaided, which is worth partial credit and not full.
  const thesisAt = roles.indexOf('thesis')
  const thesis = thesisAt === -1 ? 0 : thesisAt <= 1 ? COMPONENT_MAX.thesis : COMPONENT_MAX.thesis / 2

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
  const body = roles.slice(1, -1)
  const claimBearing = body.filter((role) => role === 'claim').length
  const expectedClaims = Math.max(1, Math.ceil(body.length * 0.5))
  const governingClaims = COMPONENT_MAX.governingClaims * clamp01(claimBearing / expectedClaims)

  // --- Warrant (20) ------------------------------------------------------
  // Measured only over the paragraphs where a warrant is owed — ones making a
  // claim or presenting evidence. Averaging over the whole essay would punish
  // an intro and conclusion for not explaining evidence they never cited.
  const owed = paragraphs.filter((p) => p.role === 'claim' || p.role === 'evidence')
  const warrant =
    owed.length === 0
      ? 0
      : COMPONENT_MAX.warrant * (owed.filter((p) => p.hasWarrant).length / owed.length)

  // --- Counterargument (15) ----------------------------------------------
  // Binary, because the property is binary: an essay either takes the other
  // side seriously somewhere or it doesn't. Scaling this with how MANY
  // objections were raised would reward hedging.
  const counterargument = has(roles, 'counterargument') ? COMPONENT_MAX.counterargument : 0

  // --- Significance (15) -------------------------------------------------
  const significance = has(roles, 'significance')
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
