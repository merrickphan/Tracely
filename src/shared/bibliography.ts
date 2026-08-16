/**
 * The reference list at the end of a document, and the in-text markers that
 * point into it.
 *
 * Why this file exists
 * --------------------
 * citedReference.ts reads a work out of the SENTENCE, which is everything the
 * fabrication check needs when the writer uses author-date, and nothing at all
 * when they do not. "[3]" and "(Shoup 45)" are POINTERS, not references: the
 * authors, the year and the title sit in a list at the end of the document that
 * the sentence never repeats. parseReferences says so in its own doc comment
 * and returns nothing for either.
 *
 * The consequence was that an IEEE or MLA draft got no fabrication check at
 * all — not a weaker one, none — and which drafts were covered was decided by
 * the writer's citation style rather than by anything about the citation. A
 * hallucinated source is not less hallucinated for being numbered.
 *
 * So this module goes and reads the list. A marker resolved against an entry
 * yields MORE than an inline citation does, not less: the entry carries every
 * author, the year and usually the title, where "(Shoup 45)" carries one
 * surname. Everything downstream — isCheckable, corroborate, the Crossref and
 * Open Library queries — then works unchanged.
 *
 * What it refuses to do
 * ---------------------
 * Guess. A parse that invents a surname would make a real reference
 * uncorroborable and, if the entry also carried a year, would report it absent
 * — the false-accusation direction this whole check is built around avoiding.
 * Three rules hold that line, and each exists because the alternative fails on
 * a real entry shape:
 *
 *   - a list is only found behind a "References"/"Works Cited" heading or a
 *     descending numbered run, never inferred from prose;
 *   - the FIRST author of an entry must be anchored — "Surname, Given" or
 *     leading initials — which is what every style does and what a stray line
 *     of title text does not;
 *   - a name chunk that is not strongly name-shaped is DROPPED rather than
 *     kept, because a missing author only makes corroboration easier and an
 *     invented one makes it impossible.
 *
 * A leaf module (the one import below is type-only and erases), so `npm test`
 * and the eval both load the code that ships.
 */
import type { CitedReference } from './citedReference'

/** Same particle list as citedReference.ts, and duplicated for the same reason. */
const PARTICLE = '(?:van|von|de|del|della|da|di|du|dos|das|la|le|el|al|bin|ibn|ter|ten|den)'
const SURNAME = `(?:${PARTICLE}\\s+)?\\p{Lu}[\\p{L}'’-]+`
const YEAR_BODY = '(?:1[6-9]|20)\\d{2}'
const YEAR_ANYWHERE = new RegExp(`\\b(${YEAR_BODY})\\b`, 'g')
const YEAR_PARENTHESISED = new RegExp(`\\(\\s*${YEAR_BODY}[a-z]?\\s*\\)`)

export interface BibliographyEntry {
  /** "3" for `[3]` or `3.`; null for an unnumbered (MLA/APA) list. */
  marker: string | null
  /** The entry as typed, minus its marker. */
  raw: string
  /** Surnames only, in the order the entry lists them. */
  surnames: string[]
  year: number | null
  title: string | null
}

/**
 * A reference list is FOUND, never inferred.
 *
 * Two ways in, both of which a body paragraph fails. A heading is searched for
 * from the END of the document, so a draft whose introduction says "prior
 * references disagree" does not hijack the search; the numbered fallback needs
 * an entry numbered 1 with at least one sibling, which is a list and not a
 * sentence that happens to contain a bracket.
 */
const HEADING = /^[\s#*_>-]*(?:\d+\.?\s*)?(references|works\s+cited|reference\s+list|bibliography|literature\s+cited|sources)\s*:?\s*$/i

/** `[3] `, `3. `, `3) ` — the marker forms a numbered list actually uses. */
const NUMERIC_ENTRY = /^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+(?=\S)/

/** An entry that has run to its end, rather than a line that wrapped. */
const ENDS_ENTRY = /[.!?)\]"”’]\s*$/

/** A guard against a pathological document, not a real budget. */
const MAX_ENTRIES = 300

function referenceSectionLines(document: string): string[] | null {
  const lines = document.split(/\r?\n/)

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    // Bounded length as well as the pattern: a paragraph ending in the word
    // "sources" is not a heading, and a heading is short.
    if (line.length <= 40 && HEADING.test(line)) return lines.slice(i + 1)
  }

  // No heading. A numbered list is still self-identifying: find the last entry
  // numbered 1 and require the run below it to be a list.
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = NUMERIC_ENTRY.exec(lines[i])
    if (!m || (m[1] ?? m[2]) !== '1') continue
    const numbered = lines.slice(i).filter((line) => NUMERIC_ENTRY.test(line)).length
    if (numbered >= 2) return lines.slice(i)
  }

  return null
}

/**
 * Lines back into entries.
 *
 * A numbered marker always starts a new one. Without markers the test is
 * whether the entry so far has ENDED: reference lists are one entry per line
 * when they fit and wrap mid-clause when they do not, so "the previous line
 * stopped at a full stop" separates the two cases without needing to know which
 * style is in use.
 */
function splitEntries(lines: string[]): Array<{ marker: string | null; raw: string }> {
  const entries: Array<{ marker: string | null; raw: string }> = []
  let current: { marker: string | null; raw: string } | null = null

  const flush = (): void => {
    if (current && current.raw.length >= 12) entries.push(current)
    current = null
  }

  for (const line of lines) {
    const text = line.trim()
    if (!text) {
      flush()
      continue
    }
    const m = NUMERIC_ENTRY.exec(text)
    if (m) {
      flush()
      current = { marker: m[1] ?? m[2], raw: text.slice(m[0].length).trim() }
      continue
    }
    if (current && !ENDS_ENTRY.test(current.raw)) {
      current.raw = `${current.raw} ${text}`
      continue
    }
    flush()
    current = { marker: null, raw: text }
  }
  flush()

  return entries.slice(0, MAX_ENTRIES)
}

/**
 * Where the authors stop and the work begins.
 *
 * Three delimiters, whichever comes first, because three styles put three
 * different things there: APA a parenthesised year, IEEE a quoted title, MLA a
 * full stop. Initials are skipped when looking for that full stop — "Smith,
 * J., & Doe, A." is four periods deep before the authors are done.
 */
interface AuthorBlock {
  segment: string
  /**
   * WHICH delimiter ended the block, which is not bookkeeping: a quote or a
   * parenthesised year proves the authors ended exactly there, while a full
   * stop only proves it in a style that ends the author block with one. IEEE
   * does not — "R. Sedgewick and K. Wayne, Algorithms. Upper Saddle River..."
   * puts the first full stop after the TITLE — so the segment overshoots, and
   * anything read out of the text past it is publisher and city.
   */
  delimiter: 'year' | 'quote' | 'period' | 'none'
}

function authorSegment(entry: string): AuthorBlock {
  const stops: Array<[number, AuthorBlock['delimiter']]> = []

  const yearParen = entry.search(YEAR_PARENTHESISED)
  if (yearParen >= 0) stops.push([yearParen, 'year'])

  const quote = entry.search(/["“]/)
  if (quote >= 0) stops.push([quote, 'quote'])

  for (const m of entry.matchAll(/\./g)) {
    const at = m.index ?? 0
    // A single capital immediately before the period is an initial ("J."),
    // not the end of the author block.
    if (/(?:^|[\s,(])\p{Lu}$/u.test(entry.slice(Math.max(0, at - 2), at))) continue
    stops.push([at, 'period'])
    break
  }

  if (stops.length === 0) return { segment: entry, delimiter: 'none' }
  const [at, delimiter] = stops.reduce((a, b) => (b[0] < a[0] ? b : a))
  return { segment: entry.slice(0, at), delimiter }
}

const SURNAME_ONLY = new RegExp(`^${SURNAME}$`, 'u')
const LEADING_INITIALS = /^(?:\p{Lu}\.\s*)+/u
const SURNAME_THEN_INITIALS = new RegExp(`(${SURNAME})\\s*,\\s*(?:\\p{Lu}\\.\\s*)+`, 'gu')

/** The last word, keeping a particle with it — "van Dijk", not "Dijk". */
function lastNameWord(part: string): string | null {
  const words = part.trim().split(/\s+/)
  if (words.length === 0) return null
  const last =
    words.length > 1 && new RegExp(`^${PARTICLE}$`, 'iu').test(words[words.length - 2])
      ? `${words[words.length - 2]} ${words[words.length - 1]}`
      : words[words.length - 1]
  return SURNAME_ONLY.test(last) ? last : null
}

/**
 * The authors an entry lists.
 *
 * Two tiers, and the difference between them is what keeps a title out of the
 * author list. An ANCHORED chunk carries positive evidence that it names a
 * person: a surname followed by initials ("Smith, J."), an inverted name
 * ("Shoup, Donald"), or leading initials ("J. Smith") — none of which a run of
 * title words produces.
 *
 * A BARE chunk ("Hinrich Schütze") is just two capitalised words, which is also
 * what "Statistical Learning" is, so it is admitted only when the entry has
 * already shown itself to be written in the one style that uses that form: MLA,
 * which inverts the first author to "Surname, Given" and then writes the rest
 * out normally. IEEE and APA never do — they use initials throughout — so a
 * bare chunk in one of those is title text, every time.
 *
 * Measured, not reasoned: an earlier version admitted a bare chunk as soon as
 * ANY anchored author had been seen, on the theory that the anchor proved this
 * was an author list. It does, and that was not the question. Over 46 labelled
 * references rendered as unquoted IEEE — "A. Kahneman and B. Tversky, Neural
 * Networks and Statistical Learning." — the real pair anchored the list and
 * "Statistical Learning" walked in behind them as a third author, 46 times out
 * of 46, on entries carrying a year and therefore able to accuse. See
 * eval/bibliography/run.mjs.
 *
 * Everything else is dropped. That is the safe direction and it is not
 * symmetric: `corroborate` requires every listed surname to appear on one work,
 * so a missing author makes corroboration EASIER and an invented one makes it
 * impossible — and an impossible corroboration on an entry that carries a year
 * is reported as absence, which is the accusation.
 */
/** "Shoup, Donald" — an inverted name with a spelled-out given name, which is MLA. */
const INVERTED_FULL_NAME = new RegExp(`^${SURNAME}\\s*,\\s*\\p{Lu}[\\p{L}'’-]+`, 'u')

function entrySurnames(segment: string): { surnames: string[]; namesWrittenOut: boolean } {
  const chunks = segment
    .replace(/\bet\s+al\.?/gi, '')
    .split(/\s*(?:;|&|\band\b)\s*/i)
    .map((chunk) => chunk.trim().replace(/[,\s]+$/, ''))
    .filter(Boolean)

  const surnames: string[] = []
  let namesWrittenOut = false

  for (const chunk of chunks) {
    const pairs = [...chunk.matchAll(SURNAME_THEN_INITIALS)]
    if (pairs.length > 0) {
      for (const pair of pairs) surnames.push(pair[1])
      continue
    }

    if (chunk.includes(',')) {
      // "Shoup, Donald" and IEEE's "R. Patel, <title so far>" alike: the author
      // is what precedes the first comma either way.
      const name = lastNameWord(chunk.slice(0, chunk.indexOf(',')))
      if (name) {
        surnames.push(name)
        if (INVERTED_FULL_NAME.test(chunk)) namesWrittenOut = true
      }
      continue
    }

    if (LEADING_INITIALS.test(chunk)) {
      const name = lastNameWord(chunk)
      if (name) surnames.push(name)
      continue
    }

    // Bare "Given Surname" — a later MLA author, or two words of a title. Only
    // an entry that has already spelled a given name out can be the first.
    if (namesWrittenOut && /^\p{Lu}/u.test(chunk) && chunk.split(/\s+/).length <= 4) {
      const name = lastNameWord(chunk)
      if (name) surnames.push(name)
    }
  }

  return { surnames, namesWrittenOut }
}

/**
 * The year the work was PUBLISHED.
 *
 * A parenthesised year wins outright — APA puts it there and puts nothing else
 * there. Otherwise the last year in the entry, which is where IEEE and MLA put
 * it, after an access date has been removed: an MLA web entry ends "Accessed 12
 * Mar. 2021", and taking that as the publication year would search the wrong
 * decade and report a real source missing.
 */
function entryYear(entry: string): number | null {
  const parenthesised = entry.match(new RegExp(`\\(\\s*(${YEAR_BODY})[a-z]?\\s*\\)`))
  if (parenthesised) return Number(parenthesised[1])

  // To the end, not to the next period: an access date is itself full of them
  // ("Accessed 12 Mar. 2021"), so stopping at one leaves the year behind.
  const withoutAccessDate = entry.replace(/\bAccessed\b.*$/i, '')
  const years = [...withoutAccessDate.matchAll(YEAR_ANYWHERE)].map((m) => Number(m[1]))
  return years.length ? years[years.length - 1] : null
}

/**
 * The work's title, when the entry states it where it can be found.
 *
 * Read only from a position the entry itself marks: inside quotes, or the
 * sentence after a parenthesised year, or the sentence after an author block
 * that a spelled-out given name identifies as MLA. Null everywhere else, and
 * deliberately — an unquoted IEEE entry hides its title INSIDE the author
 * segment ("R. Sedgewick and K. Wayne, Algorithms. Upper Saddle River, NJ:
 * Addison-Wesley, 2011"), so reading past the segment returns the publisher's
 * address.
 *
 * That was not a cosmetic failure. The junk title went into the Open Library
 * query as a title filter, the book index returned nothing for a book it holds,
 * and two real textbooks came back reported absent — measured
 * 2026-08-16, eval/bibliography/lookup.mjs. A title guessed wrong is worse than
 * no title at all, because a query is narrowed by it.
 */
function entryTitle(entry: string, block: AuthorBlock, namesWrittenOut: boolean): string | null {
  const after = (from: number): string | null => {
    const rest = entry.slice(from).replace(/^[\s.,)]*/, '')
    const candidate = rest.split(/\.\s|\.$/)[0]?.trim().replace(/[,;:]+$/, '') ?? ''
    if (candidate.split(/\s+/).length < 2 || candidate.length > 160) return null
    return new RegExp(`^${YEAR_BODY}$`).test(candidate) ? null : candidate
  }

  if (block.delimiter === 'year') {
    const year = entry.slice(block.segment.length).match(new RegExp(`\\(\\s*${YEAR_BODY}[a-z]?\\s*\\)`))
    if (year) return after(block.segment.length + (year.index ?? 0) + year[0].length)
  }

  const quoted = entry.match(/["“]([^"”]{6,160})["”]/)
  if (quoted) return quoted[1].trim().replace(/[.,;:]+$/, '')

  // MLA, and only MLA: the author block ended at a full stop AND the entry
  // spelled a given name out, which is what says that full stop was the end of
  // the authors rather than the end of the title.
  if (block.delimiter === 'period' && namesWrittenOut) return after(block.segment.length)

  return null
}

/**
 * Every entry in the document's reference list, or an empty list when it has
 * none this can be sure of.
 */
export function parseBibliography(document: string): BibliographyEntry[] {
  const lines = referenceSectionLines(document)
  if (!lines) return []

  const entries: BibliographyEntry[] = []
  for (const { marker, raw } of splitEntries(lines)) {
    const block = authorSegment(raw)
    const { surnames, namesWrittenOut } = entrySurnames(block.segment)
    // No author, no lookup. An anonymous or corporate entry is the same case
    // as an institutional inline citation: an index answers it badly, so
    // nothing it says about the entry would mean anything.
    if (surnames.length === 0) continue
    entries.push({
      marker,
      raw,
      surnames,
      year: entryYear(raw),
      title: entryTitle(raw, block, namesWrittenOut)
    })
  }
  return entries
}

/** `[3]`, `[3, 7]`, `[3-5]` — one marker may point at several entries. */
const NUMERIC_MARKER = /\[\s*(\d{1,3}(?:\s*[–—,-]\s*\d{1,3})*)\s*\]/g

/**
 * MLA author-page: `(Shoup 45)`, `(Shoup and Lee 45-47)`, `(Shoup, "Parking" 45)`.
 *
 * The number must NOT be year-shaped, which is the one thing separating this
 * from an author-date citation `(Shoup 2005)` that citedReference.ts already
 * reads. Overlapping with it would double-count the same reference.
 */
const AUTHOR_PAGE = new RegExp(
  `\\(\\s*(${SURNAME}(?:\\s+(?:and|&)\\s+${SURNAME})?)(?:\\s*,\\s*[^)]{0,80}?)?\\s+(?:pp?\\.\\s*)?(\\d{1,4})(?:\\s*[–—-]\\s*\\d{1,4})?\\s*\\)`,
  'gu'
)

/** A range wider than this is a typo or a page span, not a citation list. */
const MAX_RANGE_SPAN = 20

function expandNumericMarker(body: string): string[] {
  const out: string[] = []
  for (const part of body.split(',')) {
    const range = part.trim().match(/^(\d{1,3})\s*[–—-]\s*(\d{1,3})$/)
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])]
      if (to > from && to - from <= MAX_RANGE_SPAN) {
        for (let n = from; n <= to; n++) out.push(String(n))
      }
      continue
    }
    const single = part.trim().match(/^\d{1,3}$/)
    if (single) out.push(single[0])
  }
  return out
}

function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
}

function asReference(marker: string, entry: BibliographyEntry): CitedReference {
  return {
    raw: marker,
    kind: 'bibliographic',
    surnames: entry.surnames,
    year: entry.year,
    title: entry.title,
    etAl: false,
    entry: entry.raw
  }
}

/**
 * The works a sentence names by pointing at them.
 *
 * Returns nothing when the document has no reference list this could find,
 * which is the honest answer rather than a cautious one: a marker with no list
 * behind it names no author and no year, so there is nothing to look up and
 * nothing that could be concluded from failing to find it.
 */
export function resolveMarkers(sentence: string, entries: BibliographyEntry[]): CitedReference[] {
  if (entries.length === 0) return []

  const refs: CitedReference[] = []
  const seen = new Set<string>()
  const push = (marker: string, entry: BibliographyEntry): void => {
    const key = `${entry.surnames.join('|').toLowerCase()}|${entry.year}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push(asReference(marker, entry))
  }

  const numbered = new Map(
    entries.filter((e) => e.marker !== null).map((e) => [e.marker as string, e])
  )
  for (const m of sentence.matchAll(NUMERIC_MARKER)) {
    for (const n of expandNumericMarker(m[1])) {
      const entry = numbered.get(n)
      if (entry) push(`[${n}]`, entry)
    }
  }

  for (const m of sentence.matchAll(AUTHOR_PAGE)) {
    if (new RegExp(`^${YEAR_BODY}$`).test(m[2])) continue
    const wanted = m[1]
      .split(/\s+(?:and|&)\s+/i)
      .map(normalize)
      .filter(Boolean)
    if (wanted.length === 0) continue

    const matches = entries.filter((entry) => {
      const have = entry.surnames.map(normalize)
      return wanted.every((name) => have.includes(name))
    })
    // Exactly one, or nothing. Two entries by the same author are what MLA's
    // short-title form exists to disambiguate, and picking one of them at
    // random would attach the lookup to a work the sentence did not cite —
    // then report the wrong one absent.
    if (matches.length === 1) push(m[0], matches[0])
  }

  return refs
}

/**
 * Both steps, for a caller that has the document to hand.
 *
 * Separate from `parseReferences` rather than folded into it, because this one
 * needs the whole document and that one needs only the sentence — and every
 * caller of the sentence-only version would otherwise have to start supplying
 * something it does not have.
 */
export function bibliographyReferences(sentence: string, document: string): CitedReference[] {
  return resolveMarkers(sentence, parseBibliography(document))
}
