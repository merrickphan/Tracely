import type { StructureComponents } from './types'

/**
 * The closing paragraph of the report, in the writer's own terms.
 *
 * The report names six components, a flow score, a coverage ratio and up to a
 * dozen findings, and then stopped — leaving the reader to work out which of
 * those to act on first. That is the one question a report exists to answer,
 * and the number at the top does not answer it: 74/100 says how it went, not
 * what to do on Tuesday morning.
 *
 * Composed, not generated. This is a claim about a student's essay, so it is
 * built from the same deterministic components the score is, for the same
 * reason `scoreDraft.ts` is a formula: a sentence the writer is asked to act on
 * has to be one they can argue with, and one that cannot drift between two runs
 * on unchanged text. It costs nothing and cannot hallucinate a strength the
 * draft does not have.
 *
 * The counterfactual at the end ("that alone would put this at 84") is real
 * arithmetic on the rubric, not encouragement. It is the honest version of the
 * design's "this easily becomes an A-": the number is exactly what the score
 * becomes if that one component goes to full marks, and nothing else changes.
 *
 * A leaf: one type-only import, so `npm test` can load it.
 */

/** Component keys in the order the rubric weights them, with display names. */
const COMPONENT_NAMES: Array<[keyof StructureComponents, string, number]> = [
  ['thesis', 'the thesis', 20],
  ['governingClaims', 'the governing claims', 20],
  ['warrant', 'the reasoning that links evidence to claims', 20],
  ['counterargument', 'the counterargument', 15],
  ['significance', 'the significance', 15],
  ['conclusion', 'the conclusion', 10]
]

/** How the summary opens, by band. Matches essayGrade.ts's thresholds. */
function opener(score: number): string {
  if (score >= 85) return 'This is in good shape.'
  if (score >= 75) return 'The argument holds up.'
  if (score >= 65) return 'The shape of an argument is here.'
  if (score >= 50) return 'There is an argument in here, but it is mostly implied.'
  return 'This reads as notes rather than as an argument yet.'
}

export interface DraftSummaryInput {
  score: number
  components: StructureComponents
  /**
   * False when any paragraph came back `unknown`. The summary must say so
   * rather than describing a reading of paragraphs nothing read — the same rule
   * `findWeaknesses` follows when it withholds whole-draft findings.
   */
  complete: boolean
  /** Claims the writer cited themselves, and how many were detected. */
  withOwnCitation: number
  detected: number
}

export function summariseDraft({
  score,
  components,
  complete,
  withOwnCitation,
  detected
}: DraftSummaryInput): string {
  const scored = COMPONENT_NAMES.map(([key, name, max]) => ({
    key,
    name,
    max,
    value: components[key],
    // The gap in POINTS, not as a fraction. A component worth 20 sitting at
    // half is a bigger thing to fix than one worth 10 sitting at zero, and
    // ranking by fraction would send the writer to the cheaper repair first.
    gap: max - components[key]
  }))

  const strong = scored.filter((c) => c.value >= c.max * 0.9)
  const weakest = [...scored].sort((a, b) => b.gap - a.gap)[0]

  const parts: string[] = [opener(score)]

  if (strong.length > 0) {
    const names = strong.slice(0, 2).map((c) => c.name)
    parts.push(
      names.length === 1
        ? `${cap(names[0])} is doing its job.`
        : `${cap(names[0])} and ${names[1]} are both doing their job.`
    )
  }

  if (weakest && weakest.gap > 0) {
    const after = Math.round(score + weakest.gap)
    parts.push(
      `The most points are in ${weakest.name} — ${round(weakest.value)} of ${weakest.max}. ` +
        `Closing that alone would put this at ${after}.`
    )
  }

  // Citation coverage is a fact about the draft that needs no search, so it can
  // be stated even when nothing has been checked against the literature.
  if (detected > 0 && withOwnCitation < detected) {
    const missing = detected - withOwnCitation
    parts.push(
      `${missing} of ${detected} detected ${detected === 1 ? 'claim reads' : 'claims read'} as unattributed.`
    )
  }

  if (!complete) {
    // Last, and unhedged. Everything above is computed from a role vector with
    // holes in it, and a summary that reads as confident over a partial reading
    // is the failure the "Provisional" badge exists to prevent.
    parts.push(
      'Some paragraphs could not be read as a specific move, so this reading is provisional.'
    )
  }

  return parts.join(' ')
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Components carry halves (a buried thesis is 10, a half-warranted body 10.5). */
function round(value: number): number {
  return Math.round(value * 10) / 10
}
