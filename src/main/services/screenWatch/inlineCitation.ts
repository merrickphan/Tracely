/**
 * Does this sentence already carry a citation the writer put there?
 *
 * Screen Watch had no notion of this at all. `citationByClaimId` is set only
 * when TRACELY inserted a citation, so a sentence the user had cited perfectly
 * well themselves was indistinguishable from an uncited one — and the popover
 * told them, in those words, that it was "Missing citation". That is the single
 * most common thing a real draft contains, and getting it wrong makes every
 * other judgement on the card look untrustworthy.
 *
 * Deliberately conservative. A false positive here silently drops a claim the
 * user should have seen; a false negative only means one extra card. So every
 * pattern below requires something that does not occur by accident in ordinary
 * prose — a capitalised name beside a year, a bracketed number, a DOI. A bare
 * parenthesised year is NOT one of them: "the rate rose (2019)" is a date far
 * more often than a reference.
 */

const PATTERNS: Array<[string, RegExp]> = [
  // Parenthetical: (Smith, 2020) · (Mueller & Oppenheimer, 2014) · (IEA, 2024)
  // · ("Corruption Perceptions Index", 2024) · (Margarian, 2022: 23)
  //
  // Anchored on a capital immediately inside the bracket, so "(up from 2019)"
  // and "(down 4% since 2015)" do not match. Two things the first version got
  // wrong, both found on a real, meticulously cited MUN position paper:
  //
  //  - An opening quotation mark before the capital. MLA cites a title, not an
  //    author, and a title is quoted: ("Corruption Perceptions Index", 2024).
  //  - A page locator after the year. ("IOM Libya Migrant Report Round 44",
  //    2022: 15) and (Margarian, 2022: 23) both failed, because the pattern
  //    required the year to be the last thing before the bracket.
  [
    'parenthetical',
    /\(["“'‘]?[A-Z][^)]{0,140}?(?:1[6-9]|20)\d{2}[a-z]?(?:\s*[:,]\s*(?:pp?\.\s*)?\d+(?:\s*[–—-]\s*\d+)?)?["”'’]?\s*\)/
  ],
  // A quoted title in brackets, with no year at all — the MLA short form for a
  // source with no dated author: ("Background to the Convention"). This is the
  // single most common citation shape in a paper that cites institutions
  // rather than papers (UN pages, government sites, standards bodies), and
  // NONE of it was detected: 26 of the 34 citations in the essay that prompted
  // this were invisible, so an essay that cited something on nearly every line
  // was told on nearly every line to add a citation.
  //
  // The 6-character floor inside the quotes is what keeps ordinary quoted
  // speech out — (he said "no") does not match. A quoted phrase of six or more
  // characters inside brackets is a reference to a named thing essentially
  // every time. The known cost is a naming gloss — the policy ("Operation Warp
  // Speed") — reading as a citation, which is the quiet failure this module
  // prefers: a false positive hides one card, a false negative accuses a
  // writer of missing a citation they wrote.
  ['titled', /\(\s*["“][^"”)]{6,}["”][^)]*\)/],
  // Narrative: Smith (2020) · Smith et al. (2020) · Mueller and Oppenheimer (2014)
  [
    'narrative',
    /\b[A-Z][A-Za-z'’-]+(?:\s+(?:et al\.?|and\s+[A-Z][A-Za-z'’-]+|&\s*[A-Z][A-Za-z'’-]+))?\s*\((?:1[6-9]|20)\d{2}[a-z]?\)/
  ],
  // Numeric: [1] · [12] · [1,2] · [1-3]
  ['numeric', /\[\s*\d{1,3}(?:\s*[–—,-]\s*\d{1,3})*\s*\]/],
  // A DOI or a URL in the sentence is an explicit source, whatever its shape.
  ['doi', /\bdoi:\s*10\.\d{4,}/i],
  ['url', /\bhttps?:\/\/\S+/i],
  // Superscript reference marks, as Word produces for footnotes.
  ['superscript', /[¹²³⁰-⁹]/]
]

/** Which pattern matched, or null. Exported for the debug log — knowing WHY a
 *  claim was treated as cited is the difference between a bug report and a
 *  guess. */
export function inlineCitationKind(sentence: string): string | null {
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(sentence)) return kind
  }
  return null
}

export function hasInlineCitation(sentence: string): boolean {
  return inlineCitationKind(sentence) !== null
}
