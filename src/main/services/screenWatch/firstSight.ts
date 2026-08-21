/**
 * Does this text need the typing debounce, or was it already there?
 *
 * `screenWatchService.ts` waits `STABLE_MS` (4s) after any change before it
 * analyses, and that bar is right for its stated reason: the poll interval is
 * 1200ms, which is the pause between WORDS, so someone drafting an essay clears
 * a 1.2s bar dozens of times a paragraph and every one of those is a full relay
 * call on the whole document.
 *
 * None of that reasoning reaches the FIRST text seen after a tracking reset. A
 * document you just switched to, with a page already in it, was written before
 * Screen Watch looked at it — waiting four seconds for it to settle is waiting
 * for something that finished before we arrived. Owner, 2026-08-20: underlines
 * *"should appear right as I enter the document."*
 *
 * ── Why the length test, and why only on the first snapshot ────────────────
 * Typing into an empty control arrives one keystroke at a time, so its first
 * snapshot is a character or two and grows. Text that arrives already long
 * cannot have been typed between two polls 1.2s apart. That is the whole
 * discriminator, and it has to be applied to the first snapshot specifically:
 * checking length alone on every change would fire mid-paragraph, analyse half
 * a sentence, and then take MIN_ANALYSIS_INTERVAL_MS (20s) — locking out the
 * analysis the writer was actually waiting for. Skipping the debounce must
 * never cost a detection.
 *
 * A leaf with no imports, so `npm test` can load it — `screenWatchService.ts`
 * value-imports the UIA snapshot and the relay client and cannot be tested at
 * all, which is why this decision lives out here rather than inline.
 */

/**
 * Shortest text worth analysing.
 *
 * Mirrors `MIN_TEXT_LENGTH` in `screenWatchService.ts`, which is the same bar
 * that gates analysis, so a snapshot short enough to skip the debounce is one
 * the service would refuse to analyse anyway.
 */
export const MIN_PREEXISTING_LENGTH = 20

/**
 * True when the typing debounce should be skipped for this snapshot.
 *
 * @param awaitingFirstSight is this the first text since a tracking reset
 * @param text the snapshot's text, as read from the focused control
 */
export function isPreexistingText(awaitingFirstSight: boolean, text: string): boolean {
  return awaitingFirstSight && text.trim().length >= MIN_PREEXISTING_LENGTH
}
