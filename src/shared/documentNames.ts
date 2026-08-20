/**
 * Proper nouns a draft uses that a dictionary will not know.
 *
 * Chromium's spellchecker underlines "Hepburn", "Lähteenmäki" and "Arnhem" as
 * misspellings, because they are. Owner, 2026-08-19: *"The tool is currently
 * underlining real names as 'words that don't exist.'"* Nothing in this repo
 * draws that squiggle — it is Chromium's own dictionary — so the only lever is
 * telling it about the names in the document being written.
 *
 * ── The test for a name, and why it is this one ────────────────────────────
 * A capital letter is not evidence: every sentence starts with one. What marks
 * a proper noun is being capitalised where a common noun would NOT be — mid
 * sentence. So a word qualifies only if it appears capitalised at least once
 * away from a sentence opening.
 *
 * It must also recur. A name used once is the one the writer is least likely to
 * have proof-read, and a misspelling learned is a misspelling hidden — a worse
 * failure than the squiggle it removes. Twice is cheap evidence they mean it.
 *
 * A leaf with no imports.
 */

/**
 * How many times a capitalised word must appear before it counts as a name.
 *
 * ── Why this is 1, having been 2 ───────────────────────────────────────────
 * Two was the cautious answer: a name used once is the one the writer is least
 * likely to have proof-read, and a misspelling learned is a misspelling hidden.
 *
 * Measured on the owner's biography essay, 2026-08-19, that rule blocked
 * **English, Otto, Limburger, Stirim, Belgium, Brussels and Allied** — every
 * one of them appearing exactly once. Owner: *"English, Stirim, and a name were
 * all deemed not a word when they are."* In an essay about a person, most
 * proper nouns appear once; requiring two rejected nearly all of them.
 *
 * And the protection it was buying is mostly illusory. Chromium cannot
 * spellcheck a proper noun it has never heard of: "Stirim" and a misspelling of
 * it are equally unknown to the dictionary, so the squiggle under a name it
 * does not know carries no information the writer can act on. Where the word IS
 * in the dictionary — Belgium, English — teaching it changes nothing, because
 * a known word was never underlined.
 *
 * So the case where two protected anything is narrow, and the case where it
 * added noise was most of the document. The mid-sentence test below is what
 * actually separates a name from a sentence opening, and it does that alone.
 */
export const MIN_OCCURRENCES = 1

/**
 * How many times an ALL-CAPS word must appear.
 *
 * Higher than the ordinary bar, because upper case is genuinely weaker evidence
 * — a heading is capitalised for being a heading. Recurrence is what tells an
 * acronym the draft uses from a line that was merely shouted once.
 */
export const SHOUTED_MIN_OCCURRENCES = 2

/** Shortest word worth learning. Two-letter capitals are initials and acronyms. */
const MIN_LENGTH = 3

/**
 * Capitalised words that are ordinary English rather than names.
 *
 * These turn up mid-sentence capitalised often enough — in a title, after a
 * colon, inside a quotation — that the mid-sentence test alone lets them
 * through. Teaching the dictionary about "The" is harmless but pointless, and
 * the list is here so that what is actually sent is recognisably a name.
 */
const NOT_NAMES = new Set([
  'the', 'and', 'but', 'for', 'nor', 'yet', 'this', 'that', 'these', 'those', 'with', 'from',
  'they', 'their', 'there', 'then', 'than', 'when', 'where', 'while', 'what', 'which', 'who',
  'whom', 'whose', 'how', 'why', 'her', 'his', 'him', 'she', 'hers', 'its', 'our', 'ours',
  'your', 'yours', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'not', 'all', 'any',
  'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'too',
  'very', 'can', 'will', 'just', 'should', 'now', 'also', 'after', 'before', 'during', 'because',
  'although', 'however', 'therefore', 'many', 'much', 'one', 'two', 'three', 'first', 'second',
  'third', 'last', 'next', 'about', 'above', 'below', 'over', 'under', 'again', 'once', 'here',
  'references', 'bibliography', 'introduction', 'conclusion', 'abstract'
])

/** A word, including the marks real names carry. */
const WORD = /[\p{L}][\p{L}'’-]*/gu

/**
 * Does a sentence boundary sit immediately before this word?
 *
 * A newline counts. A heading or a reference-list line opens a sentence without
 * any punctuation before it, and treating those as mid-sentence would teach the
 * dictionary every author surname in a bibliography from its first line alone.
 */
function opensASentence(text: string, start: number): boolean {
  if (start === 0) return true
  return /(?:^|[.!?]["'”’)\]]*|\n)\s*$/.test(text.slice(0, start))
}

/**
 * The names in a draft, deduplicated, in first-appearance order.
 *
 * Order is stable so two runs over the same text give the same list, which is
 * what lets the caller diff against what it taught the dictionary last time
 * rather than re-teaching everything on every analysis.
 */
export function documentNames(text: string): string[] {
  if (!text) return []

  const total = new Map<string, number>()
  const midSentence = new Set<string>()
  /** Words seen in ALL CAPS, held to a higher bar — see the loop below. */
  const shouted = new Set<string>()
  const firstSeen: string[] = []

  for (const match of text.matchAll(WORD)) {
    const word = match[0]
    if (word.length < MIN_LENGTH) continue
    if (word[0] !== word[0].toUpperCase()) continue
    // ALL-CAPS is held to the old two-occurrence bar rather than excluded.
    // A heading shouts once; an acronym the draft actually uses recurs. UNICEF
    // appeared six times mid-sentence in the owner's essay and was rejected
    // outright for being upper case, which is the wrong reading of the same
    // evidence — a term used six times is exactly what a writer means.
    const shouting = word === word.toUpperCase() && word.length > 1
    if (NOT_NAMES.has(word.toLowerCase())) continue

    // "Sweller's" is one token to this regex and a possessive to a reader. The
    // dictionary wants the NAME — teaching it the possessive leaves the bare
    // surname underlined everywhere else in the draft.
    const base = word.replace(/['’]s$/i, '').replace(/['’]$/, '')
    if (base.length < MIN_LENGTH || NOT_NAMES.has(base.toLowerCase())) continue

    if (!total.has(base)) firstSeen.push(base)
    total.set(base, (total.get(base) ?? 0) + 1)
    if (shouting) shouted.add(base)
    if (!opensASentence(text, match.index)) midSentence.add(base)
  }

  return firstSeen.filter((word) => {
    if (!midSentence.has(word)) return false
    const seen = total.get(word) ?? 0
    return seen >= (shouted.has(word) ? SHOUTED_MIN_OCCURRENCES : MIN_OCCURRENCES)
  })
}
