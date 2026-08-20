/**
 * Whether a popover's primary button should offer to INSERT a citation.
 *
 * Decided from the action WORDING rather than from the problem kind, because
 * the kind does not know: `popoverCopyFor` picks the action from the evidence
 * as well, so one kind says "Add citation" on a claim with strong support and
 * "Compare sources" on that same kind once the writer has cited it.
 *
 * Owner, 2026-08-19: *"how come everything pulls up a source… I only want it to
 * appear if it says add citation or something."* Right, and the reason is
 * sharper than clutter. "Compare sources" fires on a claim they ALREADY cited,
 * and "Review the sources" on one where the card has just said the sources do
 * not confirm the claim. A picker whose primary button inserts a citation
 * contradicts the sentence directly above it in the first case, and in the
 * second invites citing a source the card has called insufficient.
 *
 * Both still SHOW what came back, read-only — comparing is the entire point of
 * "Compare sources". What goes is the offer to insert.
 *
 * A leaf with no imports.
 */

/** The two actions that are asking the writer for a citation. */
const INSERTING: ReadonlySet<string> = new Set([
  'Add citation',
  'Find a source',
  // Added 2026-08-19. It was absent, so "Fix the citation" opened the read-only
  // list — a card headed "your citation is broken" with no way to fix it.
  // Owner: *"there is no replace button to replace the citation."*
  'Fix the citation'
])

export function insertsCitation(action: string): boolean {
  return INSERTING.has(action)
}
