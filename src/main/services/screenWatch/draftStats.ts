import type { DraftStats } from '@shared/ipc-contract'

/**
 * Word, sentence and distinct-word counts for the overlay's stats row.
 *
 * Its own module, rather than living in watchOutline.ts, so it can be tested:
 * `npm test` runs .ts files through Node's type stripping with no bundler, so a
 * module is only reachable if every one of its VALUE imports resolves without
 * path aliases. watchOutline.ts imports `@shared/paragraphSplit` at runtime and
 * so cannot be loaded by the test runner at all; the `import type` above is
 * erased and costs nothing.
 *
 * Local by necessity rather than preference: the overlay is never sent the
 * document text — only one truncated line per paragraph — so if these are not
 * computed on the main side they cannot be computed anywhere.
 *
 * Deliberately crude, and that is the right amount of effort. Four display
 * numbers do not justify a tokenizer, and being one word out is invisible where
 * a dependency on this path would not be: it runs on every re-analysis of
 * whatever the user happens to be typing in.
 */
export function draftStats(text: string): DraftStats {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []
  const terminators = text.match(/[.!?]+(?=\s|$)/g) ?? []
  return {
    words: words.length,
    // Sentences count terminators rather than splitting on them — the count is
    // only ever a divisor, so a splitter's edge cases would buy nothing. Floors
    // at 1 so a draft with no full stop yet still divides.
    //
    // Known and accepted: an abbreviation ends a sentence here, so "Dr. Smith"
    // counts as two, pulling words-per-sentence down slightly on drafts full of
    // them. Fixing it means an abbreviation list or a real splitter — a great
    // deal of machinery for one display number nothing else reads.
    sentences: Math.max(1, terminators.length),
    // Case-folded, so "The" and "the" are one word. The figure is meant to say
    // how varied the vocabulary is, and capitalisation is sentence position.
    uniqueWords: new Set(words.map((word) => word.toLocaleLowerCase())).size
  }
}
