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
 * Two, not one, and the asymmetry is deliberate: the cost of being wrong here
 * is a genuine misspelling that stops being underlined.
 */
export const MIN_OCCURRENCES = 2

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
  const firstSeen: string[] = []

  for (const match of text.matchAll(WORD)) {
    const word = match[0]
    if (word.length < MIN_LENGTH) continue
    // Capitalised, and not SHOUTING. An all-caps heading or acronym says
    // nothing about whether the word is a name.
    if (word[0] !== word[0].toUpperCase() || word === word.toUpperCase()) continue
    if (NOT_NAMES.has(word.toLowerCase())) continue

    // "Sweller's" is one token to this regex and a possessive to a reader. The
    // dictionary wants the NAME — teaching it the possessive leaves the bare
    // surname underlined everywhere else in the draft.
    const base = word.replace(/['’]s$/i, '').replace(/['’]$/, '')
    if (base.length < MIN_LENGTH || NOT_NAMES.has(base.toLowerCase())) continue

    if (!total.has(base)) firstSeen.push(base)
    total.set(base, (total.get(base) ?? 0) + 1)
    if (!opensASentence(text, match.index)) midSentence.add(base)
  }

  return firstSeen.filter(
    (word) => midSentence.has(word) && (total.get(word) ?? 0) >= MIN_OCCURRENCES
  )
}
