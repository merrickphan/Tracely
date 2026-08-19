/**
 * The first thing a critique says, for a card with no room for the rest.
 *
 * Owner, 2026-08-19: *"the overlay popup is way too wordy. No one wants to read
 * a full paragraph explaining why a claim is overstated."*
 *
 * The cause is that `popoverCopyFor` uses `claim.critique` as its description
 * verbatim, and `CRITIQUE_SYSTEM_PROMPT` budgets that at "under 120 words" —
 * a specification for a report, rendered into a hover card. It also arrives as
 * markdown (the relay's prompts neither request nor forbid it and gpt-4.1 emits
 * it freely), so bold markers and bullet syntax were being shown raw.
 *
 * A hover card answers "what is wrong here"; the full critique lives in the
 * report, one click away, unchanged. Nothing is lost — the first sentence of a
 * critique is where the verdict is, because the prompt asks for the finding
 * first and the reasoning after.
 *
 * A leaf with no imports.
 */

/** Roughly two lines in the popover at its real width. */
export const POPOVER_CRITIQUE_CHARS = 150

/**
 * Markdown flattened to the text under it.
 *
 * Deliberately not a markdown parser: the card renders plain text, and what is
 * needed is that `**cross-sectional**` reads as a word rather than as punctuation.
 */
function flatten(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The critique cut to its opening finding.
 *
 * Takes whole sentences where it can, because a critique cut mid-clause reads
 * as a truncation bug rather than as a summary — and an abbreviation is not a
 * sentence end, so "e.g." and "et al." do not split it.
 */
export function summariseCritique(
  critique: string | null,
  maxChars = POPOVER_CRITIQUE_CHARS
): string | null {
  if (!critique) return null
  const flat = flatten(critique)
  if (!flat) return null
  if (flat.length <= maxChars) return flat

  // A sentence end that is not an abbreviation or an initial.
  const cut = flat.slice(0, maxChars + 1)
  // The closing-quote class is load-bearing: a critique routinely ends a
  // sentence on a quoted phrase — `…use their phones more."` — and requiring
  // whitespace immediately after the full stop misses every one of them.
  const end = [
    ...cut.matchAll(/(?<![A-Z]|\be\.g|\bi\.e|\bal|\betc|\bvs|\bDr|\bMr|\bMs)([.!?]["'”’)\]]*)\s/g)
  ].pop()
  if (end && end.index > maxChars * 0.4) {
    return flat.slice(0, end.index + end[1].length).trim()
  }

  // No usable sentence break — fall back to a word boundary rather than a
  // hard slice, so the card never ends mid-word.
  const space = cut.lastIndexOf(' ')
  return `${flat.slice(0, space > 0 ? space : maxChars).trim()}…`
}
