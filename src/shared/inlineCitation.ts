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

/**
 * A surname as it appears at the start of a citation.
 *
 * `\p{Lu}` rather than `[A-Z]`, and an optional lowercase particle in front,
 * because the parenthetical pattern anchored on an ASCII capital immediately
 * inside the bracket and therefore missed (van Dijk, 2019), (de Beauvoir, 1949)
 * and (Ángel, 2020). Narrative form escaped this by accident — it matches on
 * the capitalised surname, so `van Dijk (2019)` was found via `Dijk`.
 */
const PARTICLE = '(?:(?:van|von|de|del|della|da|di|du|dos|das|la|le|el|al|bin|ibn|ter|ten|den)\\s+)?'
const SURNAME = `${PARTICLE}\\p{Lu}[\\p{L}'’-]+`

/**
 * Words that make "(Word 12)" a pointer rather than a citation.
 *
 * MLA author-page has no year to anchor on — a capitalised word beside a bare
 * number is the whole signature — so it is the one pattern here that needs a
 * stoplist instead of a shape. These are the structural and legislative
 * pointers that would otherwise read as an author: (Table 3), (Chapter 11),
 * (Proposition 13), (Title 42).
 */
const NOT_AN_AUTHOR =
  'Table|Fig|Figure|Chart|Graph|Chapter|Ch|Section|Sec|Part|Page|Pages|Volume|Vol|Appendix|Equation|Eq|Step|Item|Note|Line|Row|Column|Level|Grade|Round|Phase|Class|Type|Version|Model|Form|Room|Box|Panel|Article|Clause|Rule|Title|Proposition|Prop|Measure|Bill|Amendment|Act'

/**
 * A source named in PROSE rather than in brackets.
 *
 * Every pattern above waits for punctuation — a bracket, a square bracket, a
 * superscript. None of them can see the oldest citation shape there is, which
 * is a writer simply saying whose claim it is: *"According to Pearson from
 * UNICEF, …"*. Owner, 2026-08-19: *"a citation doesn't need to have parentheses
 * directly at the very end. It could be at the very start … Be smart about
 * this, because there is not just one way to cite stuff."*
 *
 * Correct, and the cost of missing it is the worst thing this module can do: a
 * sentence that names its source in the clearest possible way, told it is
 * "Missing citation". Narrative style is also what MLA and Chicago actually
 * teach, and what a student writes before they have learned a house style at
 * all.
 *
 * ── What is deliberately NOT here ──────────────────────────────────────────
 * A bare `Name verb that …` — "Hepburn argued that the war changed her" — is
 * left undetected. In an essay ABOUT a person, that sentence attributes to its
 * own subject and cites nothing, and it is far too common in biography and
 * history to read as a reference. Every pattern below therefore requires a
 * word that only appears when a writer is pointing AT a source: "according to",
 * "as … reports", "reported by", or a possessive over a source noun.
 */
const REPORTING =
  'reports?|reported|notes?|noted|writes?|wrote|argues?|argued|observes?|observed|explains?|explained|documents?|documented|records?|recorded|describes?|described|states?|stated|shows?|showed|concludes?|concluded|estimates?|estimated|found|puts? it'

/** "… as reported BY the WHO", "… as published IN the Lancet". */
const ATTRIBUTING_PARTICIPLE =
  'reported|published|documented|recorded|noted|stated|described|compiled|collected|released|issued|cited'

/** The nouns that make a possessive a citation: "UNICEF's figures". */
const SOURCE_NOUN =
  'reports?|stud(?:y|ies)|surveys?|analys[ie]s|data|dataset|figures|statistics|research|articles?|papers?|website|webpage|page|records|findings|account|estimates?|census|archives?|database|guidelines?|profile|biography|obituary|documentary|entry'

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
    new RegExp(
      `\\(["“'‘]?${PARTICLE}\\p{Lu}[^)]{0,140}?(?:1[6-9]|20)\\d{2}[a-z]?(?:\\s*[:,]\\s*(?:pp?\\.\\s*)?\\d+(?:\\s*[–—-]\\s*\\d+)?)?["”'’]?\\s*\\)`,
      'u'
    )
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
  // MLA 9 author-page: (Shoup 45) · (Shoup 45-47) · (Mueller and Oppenheimer 1163)
  //
  // The whole author-date family above is anchored on a year, and MLA has no
  // year in the text at all — it lives only in the Works Cited. So none of the
  // patterns above could ever match an MLA essay, and the detector reported
  // every cited line in one as uncited. That is the MUN position paper failure
  // again with a different style: MLA is the default in US high-school English,
  // which is most of who writes the drafts this runs on.
  //
  // Without a year there is no shape to key on — a capitalised word beside a
  // bare number IS the citation — so this is the one pattern that needs
  // NOT_AN_AUTHOR to hold back (Table 3) and (Proposition 13).
  //
  // Two MLA forms are deliberately left undetected, because neither has
  // anything distinguishing left once the author or the number is gone:
  //  - bare page after a narrative mention — "Shoup argues it is a tax (45)"
  //  - whole-work with no locator — "(Shoup)", indistinguishable from "(Congress)"
  // Both fail toward the safe side for a reader but the noisy side for a writer;
  // catching them needs the surrounding sentence, not this regex.
  [
    'author-page',
    new RegExp(
      `\\((?!(?:${NOT_AN_AUTHOR})\\b)${SURNAME}(?:\\s+(?:et al\\.?|and\\s+${SURNAME}|&\\s*${SURNAME}))?\\s+(?:pp?\\.\\s*)?\\d{1,4}(?:\\s*[–—-]\\s*\\d{1,4})?\\s*\\)`,
      'u'
    )
  ],
  // Prose attribution, four shapes — see the prose-attribution note above.
  //
  //   According to UNICEF, she made fifteen field visits.
  //   According to Pearson from UNICEF, …
  //   As the Red Cross reported, the camps were full.
  //   The figure was first published in the Lancet.
  //   UNICEF's own records put the number higher.
  //
  // Reported as one kind, `attributed`, and deliberately NOT in
  // problemKind.ts's CHECKABLE_CITATION_SHAPES: none of these carries the
  // author-and-year that `search/referenceCheck.ts` needs to resolve a work, so
  // a critique that doubts one is doubting the topical search rather than the
  // source the writer named.
  ['attributed', new RegExp(`\\b[Aa]ccording to\\s+(?:the\\s+)?${SURNAME}`, 'u')],
  [
    'attributed',
    // The gap allows a multi-word name — "As the Red Cross reported" — so it
    // cannot be restricted to lowercase filler. Three words, because past that
    // the verb has stopped belonging to the name.
    new RegExp(
      `\\b[Aa]s\\s+(?:the\\s+)?${SURNAME}(?:\\s+[\\p{L}'’-]+){0,3}\\s+(?:${REPORTING})\\b`,
      'u'
    )
  ],
  [
    'attributed',
    new RegExp(
      `\\b(?:${ATTRIBUTING_PARTICIPLE})\\s+(?:by|in)\\s+(?:the\\s+)?${SURNAME}`,
      'u'
    )
  ],
  ['attributed', new RegExp(`\\b${SURNAME}['’]s\\s+(?:own\\s+)?(?:${SOURCE_NOUN})\\b`, 'u')],
  // Numeric: [1] · [12] · [1,2] · [1-3]
  ['numeric', /\[\s*\d{1,3}(?:\s*[–—,-]\s*\d{1,3})*\s*\]/],
  // Chicago notes shorthand for "the source I just cited": (ibid.) · (Ibid., 47)
  // · (op. cit.). Unambiguous — these strings do not occur in ordinary prose.
  ['ibid', /\((?:ibid|id|op\.\s*cit|loc\.\s*cit)\b\.?[^)]{0,24}\)/i],
  // A DOI or a URL in the sentence is an explicit source, whatever its shape.
  ['doi', /\bdoi:\s*10\.\d{4,}/i],
  ['url', /\bhttps?:\/\/\S+/i],
  // Screen Watch reads rendered text, where a linked source usually loses its
  // scheme: what is on screen is www.oecd.org/education/report.pdf.
  ['url', /\bwww\.\S+\.\S+/i],
  // Superscript reference marks, as Word produces for footnotes.
  ['superscript', /[¹²³⁰-⁹]/]
]

/**
 * The sentence containing `[start, end)`, so a citation can be found where
 * writers actually put one.
 *
 * Every caller used to test `claim.text` on its own, and a detected claim is a
 * SUB-SPAN of a sentence, not the sentence. The relay returns the assertion —
 * "Increased xenophobia has caused migrants to fear speaking out ... and
 * anti-migrant sentiment" — and stops at the assertion, so the "(Tyche
 * Hendricks, 2024)" that follows it was never part of the string being tested.
 * The detector below matches that sentence perfectly; it was simply never shown
 * it. The result was the failure this module exists to prevent, on the one shape
 * it handles best: a properly cited sentence told it had no citation.
 *
 * Bracket-aware in both directions, because the terminator that ends a sentence
 * is the one OUTSIDE the brackets — "(Smith et al., 2024)." has a full stop
 * inside it that would otherwise cut the sentence off before its own citation.
 *
 * Widening stops at the sentence and never crosses into the next one, so a
 * neighbouring sentence's citation cannot be borrowed. Where the boundary is
 * misjudged (an abbreviation like "Dr." at bracket depth zero) the window only
 * ever gets SMALLER, which degrades to exactly the old behaviour rather than to
 * a false positive.
 */
export function sentenceAround(text: string, start: number, end: number): string {
  const isTerminator = (ch: string): boolean => ch === '.' || ch === '!' || ch === '?' || ch === '\n'

  /**
   * Where the sentence ends, given a terminator at `i` — or -1 if that
   * terminator does not end anything.
   *
   * Both halves were bugs, both found by `npm run eval:citations`, and both
   * cost the same thing: a window that stops one character short of the
   * citation, so the pattern that can see it perfectly is never shown it.
   *
   *  - **Trailing marks belong to the sentence they hang off.** A Word footnote
   *    renders as `travel.¹` — the terminator ends the window and the mark sits
   *    outside it. Every Chicago-style citation failed this way: 5 of 5 found
   *    when handed the sentence, 1 of 5 when handed a claim span inside it.
   *  - **A terminator with no whitespace after it is not a terminator.** The
   *    dots in `doi: 10.1257/aer.20191325` and `www.bls.gov/news.release` closed
   *    the window mid-URL, leaving a fragment with no second dot in it. `doi`
   *    and `url` both scored 100% by sentence and 0% by span.
   *
   * Applied in both directions. Backward matters for the same reason forward
   * does: with a link earlier in the sentence, a dot inside it is nearer than
   * the real boundary and would cut the window off in front of the citation.
   */
  const CLOSERS = /["'’”)\]¹²³⁰-⁹]/
  const sentenceEndAt = (i: number): number => {
    // A newline ends a sentence whatever follows it — it is whitespace itself,
    // so the trailing-whitespace rule below would ask about the wrong character.
    if (text[i] === '\n') return i + 1
    let after = i + 1
    while (after < text.length && CLOSERS.test(text[after])) after++
    return after >= text.length || /\s/.test(text[after]) ? after : -1
  }

  let stop = Math.max(0, Math.min(end, text.length))

  /**
   * A span that already ENDS on its own sentence's terminator stops there.
   *
   * Without this the forward walk below begins at `stop` — i.e. one past that
   * terminator — so it never sees it, runs on, and takes the whole NEXT
   * sentence with it. Measured on the owner's draft, 2026-08-19: *"She devolved
   * anemia, respiratory difficulties, and oedema … full-time dancer."* has no
   * citation of any kind, and the window ran on to *"…gratitude for what UNICEF
   * does" ("Audrey" UNICEF)."* The `titled` pattern matched that, so an uncited
   * sentence was reported as cited and the popover offered "Compare sources"
   * over a claim with nothing to compare.
   *
   * The relay returns whole sentences for a great many claims, so this was not
   * an edge case — it was the common one, borrowing whatever the next sentence
   * happened to cite.
   */
  const alreadyAtBoundary = ((): number => {
    let i = stop
    while (i > 0 && /\s/.test(text[i - 1])) i--
    if (i > 0 && isTerminator(text[i - 1])) {
      const at = sentenceEndAt(i - 1)
      if (at !== -1) return at
    }
    return -1
  })()

  let depth = 0
  while (alreadyAtBoundary === -1 && stop < text.length) {
    const ch = text[stop]
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && isTerminator(ch)) {
      const sentenceEnd = sentenceEndAt(stop)
      if (sentenceEnd !== -1) {
        stop = sentenceEnd
        break
      }
    }
    stop++
  }
  if (alreadyAtBoundary !== -1) stop = alreadyAtBoundary

  let from = Math.max(0, Math.min(start, text.length))
  depth = 0
  while (from > 0) {
    const ch = text[from - 1]
    if (ch === ')' || ch === ']') depth++
    else if (ch === '(' || ch === '[') depth = Math.max(0, depth - 1)
    else if (depth === 0 && isTerminator(ch) && sentenceEndAt(from - 1) !== -1) break
    from--
  }

  return text.slice(from, stop)
}

/**
 * `hasInlineCitation` for a claim located in its document.
 *
 * Prefer this wherever the surrounding text is in hand. `hasInlineCitation` on
 * a bare claim string is still correct when it is all there is — Screen Watch's
 * own claim list, a stored claim with no snapshot — it just cannot see a
 * citation that sits outside the claim's own span.
 */
export function hasInlineCitationNear(text: string, start: number, end: number): boolean {
  return hasInlineCitation(sentenceAround(text, start, end))
}

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
