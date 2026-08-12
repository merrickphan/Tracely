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
  // Anchored on a capital immediately inside the bracket, so "(up from 2019)"
  // and "(down 4% since 2015)" do not match.
  ['parenthetical', /\([A-Z][^)]{0,80}?(?:1[6-9]|20)\d{2}[a-z]?\s*\)/],
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
