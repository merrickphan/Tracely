import type { ParagraphRole } from '@shared/types'

/**
 * One sentence saying what an opened paragraph is DOING, above its metric.
 *
 * The expanded row used to open on a preview of the paragraph's own text. That
 * is the one thing on the screen the writer already knows — they wrote it, and
 * it is visible in the editor behind the modal — while the thing they cannot
 * see is the reading the score was computed from. A report whose detail view
 * quotes you back at yourself has spent its most valuable line saying nothing.
 *
 * Phrased as an observation about the paragraph, not as praise or a grade. The
 * verdict pill beside the row already says how it went; this says what was
 * measured, so a wrong label is visibly wrong rather than mysteriously costly —
 * the same reason the role chip is on the row at all.
 *
 * `unknown` is the important one. It has to say plainly that nothing was read,
 * because that is exactly the state `complete: false` and the "Provisional"
 * badge are about, and a blank space there reads as "nothing to report".
 */
export const ROLE_BLURB: Record<ParagraphRole, string> = {
  thesis: 'States the position the rest of the draft argues for.',
  claim: 'Asserts a sub-point of its own and works to support it.',
  evidence: 'Presents data, a study, a source or an example.',
  reasoning: 'Explains how the evidence bears on the claim — the link, not the assertion.',
  counterargument: 'Takes an objection or an opposing view seriously.',
  significance: 'Says why the argument matters and what is at stake.',
  conclusion: 'Closes the draft.',
  transition: 'Bridges two sections without arguing anything of its own.',
  unknown:
    'Nothing here could be read as a specific move in the argument, so this paragraph earned no component.'
}

export function roleBlurbFor(role: ParagraphRole): string {
  return ROLE_BLURB[role]
}
