import type { StructureWeaknessKind } from './types.ts'

/**
 * Which findings mean a paragraph NEEDS WORK, and which are notes.
 *
 * Owner, 2026-08-19: *"too many paragraphs are being flagged as 'needs work'…
 * If the writing is fine, don't flag it. It feels like the system is flagging
 * things just for the sake of flagging them."*
 *
 * The cause was `issues.length === 0`. Every finding, of every kind, flipped a
 * paragraph's badge — so one "obviously" in an otherwise excellent paragraph
 * printed the same NEEDS WORK as a circular argument. With twenty-odd kinds
 * now live, a well-written draft could not keep a single Strong badge, and a
 * badge that is always on carries no information.
 *
 * So the badge asks a different question from the findings list: not "is there
 * anything to say about this paragraph" but "would a marker take marks off for
 * it". The notes still appear underneath either way — nothing is hidden, and
 * this file removes no finding from the report.
 *
 * A leaf with a type-only import.
 */

/**
 * Findings a strong paragraph can carry.
 *
 * Every one is a habit worth mentioning and none of them is a hole in the
 * argument. The test of membership: could a paragraph carry this and still be
 * the best paragraph in the essay? If yes it belongs here.
 */
const MINOR: ReadonlySet<StructureWeaknessKind> = new Set<StructureWeaknessKind>([
  // Word choice. "Obviously" is worth removing and its presence says nothing
  // about whether the paragraph argues.
  'unsupported-emphasis',
  // An opening line, and only ever on the first paragraph.
  'generic-opening',
  // Formatting of a reference, not the reasoning around it.
  'malformed-citation',
  // Two sentences that could be one. Tightening, not repair.
  'undeveloped-repetition'
])

/**
 * Does this finding cost the paragraph its Strong badge?
 *
 * Default is TRUE — a kind not listed as minor is treated as substantive, so a
 * newly added finding is loud until someone decides otherwise. That is the
 * right direction: a real problem shown quietly is worse than a small one shown
 * loudly, and the list above is short enough to review.
 */
export function isSubstantive(kind: StructureWeaknessKind): boolean {
  return !MINOR.has(kind)
}

/** Whether a paragraph's findings amount to more than notes. */
export function needsWork(kinds: StructureWeaknessKind[]): boolean {
  return kinds.some(isSubstantive)
}
