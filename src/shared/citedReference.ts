/**
 * The work a sentence NAMES, pulled apart into something you can look up.
 *
 * inlineCitation.ts answers a yes/no question — is there a citation here — and
 * that is all `problemKind` needs. This answers the next one: WHICH work, by
 * whom, in what year. That is the difference between knowing a sentence is
 * attributed and being able to check whether the thing it attributes to exists.
 *
 * Why this file exists at all
 * ---------------------------
 * The `fabricated` verdict has never once fired. Measured on 2026-08-16
 * (eval/critique/FINDINGS.md), the critique was handed a sentence crediting
 * "Ramirez and Doyle (2024)" with an exact figure — a study that does not
 * exist, carrying every marker the relay's own prompt lists — and returned
 * `unsupported`, saying:
 *
 *   > cannot be verified as real or fabricated without further information
 *
 * That is the correct answer to the question it was asked. The relay's Pass 2(c)
 * requires the model to be "confident no work matching this author, year and
 * title exists", and a language model cannot be confident of a negative about
 * the world; not recognising a reference is not evidence against it, since
 * obscure, regional, very recent and non-English work is routinely real and
 * unfamiliar. So the top severity tier in problemKind.ts was unreachable by
 * construction, and Tracely's answer to an AI-hallucinated citation was the same
 * word it uses for thin sourcing.
 *
 * The fix is not a firmer prompt. It is to stop asking the model a question it
 * cannot answer and go and look instead: a targeted author+year query against
 * an index, which is a fact about the world rather than about the model's
 * memory. This module is the half of that which is pure — parsing the reference
 * out of the sentence, building the query, and deciding whether a returned work
 * is the one that was cited. A leaf, so `npm test` and the eval can both load
 * it, and so the eval measures the code that ships rather than a copy of it.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * Judge. Absence from an index is evidence, not a verdict — Crossref does not
 * carry most books, most non-English scholarship, most government and NGO
 * reports, or anything unregistered. `corroborate` reports what was found and
 * stops there; who is allowed to conclude "fabricated" from that is a decision
 * for the critique, which also sees the marks of generation.
 */

/** Which shape of reference this is, and therefore what can be done with it. */
export type CitedReferenceKind =
  /** A person (or people) and a year: Carskadon (2011), (Minges & Redeker, 2016). */
  | 'author-year'
  /**
   * An organisation and a year: (IEA, 2024), (World Health Organization, 2021).
   *
   * Parsed, and then never checked. An institutional author is exactly the case
   * a scholarly index answers badly — the work is a report on the body's own
   * site, usually with no DOI and no Crossref record — so "not found" here
   * carries no information at all, and acting on it would accuse a writer who
   * cited a real WHO report of inventing it.
   */
  | 'institutional'
  /** A quoted title and a year, with no author: ("Later School Start Times", 2018). */
  | 'title-year'

export interface CitedReference {
  /** Exactly as the writer typed it, for quoting back in a critique. */
  raw: string
  kind: CitedReferenceKind
  /** Surnames only, in the order cited. Empty for 'title-year'. */
  surnames: string[]
  year: number | null
  /** The quoted title, when the reference carries one. */
  title: string | null
  /** "et al." — there are more authors than the sentence names. */
  etAl: boolean
}

// Same particle list as inlineCitation.ts. Duplicated rather than shared
// because these two modules answer different questions and inlineCitation's
// patterns are tuned for detection recall, where this one is tuned for pulling
// a name out cleanly — a change that helps one would not obviously help the
// other, and a shared constant would make that trade-off invisible.
const PARTICLE = '(?:van|von|de|del|della|da|di|du|dos|das|la|le|el|al|bin|ibn|ter|ten|den)'
const SURNAME = `(?:${PARTICLE}\\s+)?\\p{Lu}[\\p{L}'’-]+`
const YEAR = '(?:1[6-9]|20)\\d{2}'

/**
 * Words that make a capitalised author an organisation rather than a person.
 *
 * Not exhaustive and does not need to be: everything this catches is EXCLUDED
 * from the existence check, so a miss costs a check that would have been
 * uninformative, and there is no accusation on this path to get wrong.
 */
const ORG_WORDS =
  /\b(?:organization|organisation|ministry|bureau|institute|institution|department|commission|agency|council|bank|fund|association|society|centre|center|university|college|school|office|administration|service|programme|program|union|foundation|committee|authority|board|corporation|company|trust|network|alliance|coalition|federation|forum|group|initiative|project|observatory|secretariat|nations|government|congress|parliament|court|academy)\b/i

/**
 * An acronym author — IEA, WHO, OECD, NHTSA.
 *
 * Two or more capitals with no lowercase. A real surname in this shape is rare
 * enough to be worth losing, and the cost of the mistake is only a skipped
 * check.
 */
const ACRONYM = /^[\p{Lu}]{2,}$/u

function classify(surnames: string[]): CitedReferenceKind {
  if (surnames.length === 0) return 'title-year'
  const isOrg = surnames.some((name) => ACRONYM.test(name) || ORG_WORDS.test(name))
  return isOrg ? 'institutional' : 'author-year'
}

/**
 * Names as a citation writes them, split into surnames.
 *
 * Handles "Minges & Redeker", "Wheaton and Ferro", "Dunster et al.", and the
 * three-author "Smith, Jones, & Lee" that APA uses before it collapses to
 * et al. Given names are dropped: an index is queried on family names, and a
 * citation gives an initial at most.
 */
function splitNames(text: string): { surnames: string[]; etAl: boolean } {
  const etAl = /\bet\s+al\b/i.test(text)
  const surnames = text
    .replace(/\bet\s+al\.?/gi, '')
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
    // Drop bare initials ("J.", "A. B.") — a citation that writes them puts
    // them after the surname in the reference list, never inline, so anything
    // that is only initials here is a split artefact.
    .filter((part) => !/^(?:\p{Lu}\.\s*)+$/u.test(part))
    // The surname is the last word: "van Dijk" keeps its particle, "Mary
    // Carskadon" (a narrative mention with a given name) reduces to Carskadon.
    .map((part) => {
      const words = part.split(/\s+/)
      if (words.length > 1 && new RegExp(`^${PARTICLE}$`, 'iu').test(words[words.length - 2])) {
        return `${words[words.length - 2]} ${words[words.length - 1]}`
      }
      return words[words.length - 1]
    })
    .filter((name) => new RegExp(`^${SURNAME}$`, 'u').test(name))

  return { surnames, etAl }
}

const PARENTHETICAL = new RegExp(
  `\\(\\s*(["“][^"”)]{4,}["”]|[^)]{2,120}?)\\s*,\\s*(${YEAR})[a-z]?(?:\\s*[:,]\\s*(?:pp?\\.\\s*)?\\d+(?:\\s*[–—-]\\s*\\d+)?)?\\s*\\)`,
  'gu'
)

const NARRATIVE = new RegExp(
  `\\b(${SURNAME}(?:\\s+et\\s+al\\.?|(?:\\s*,)?\\s+and\\s+${SURNAME}|\\s*&\\s*${SURNAME})?)\\s*\\(\\s*(${YEAR})[a-z]?\\s*\\)`,
  'gu'
)

/**
 * Every work this sentence names, in the order it names them.
 *
 * Author-date shapes only. A numeric marker ([3], a superscript) points into a
 * reference list this function has never seen, and MLA author-page ("Shoup 45")
 * carries no year — neither can be looked up from the sentence alone, so
 * neither is returned rather than being returned unusable. That is a real limit
 * on which drafts the fabrication check can cover, and it is the writer's
 * citation style that decides it: an IEEE or MLA paper gets no check at all.
 */
export function parseReferences(sentence: string): CitedReference[] {
  const refs: CitedReference[] = []
  const seen = new Set<string>()

  const push = (raw: string, namePart: string, year: number, quotedTitle: string | null): void => {
    const key = `${namePart.toLowerCase()}|${year}`
    if (seen.has(key)) return
    seen.add(key)
    const { surnames, etAl } = quotedTitle ? { surnames: [], etAl: false } : splitNames(namePart)
    refs.push({
      raw: raw.trim(),
      kind: classify(surnames),
      surnames,
      year,
      title: quotedTitle,
      etAl
    })
  }

  for (const m of sentence.matchAll(PARENTHETICAL)) {
    const inner = m[1].trim()
    const quoted = /^["“]/.test(inner)
    push(m[0], quoted ? inner : inner, Number(m[2]), quoted ? inner.replace(/^["“]|["”]$/g, '') : null)
  }
  for (const m of sentence.matchAll(NARRATIVE)) {
    push(m[0], m[1], Number(m[2]), null)
  }

  return refs
}

// Diacritics folded and case dropped, so "Ángel" in an index matches "Angel"
// as a student typed it, and "van Dijk" matches "Van Dijk".
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
}

/**
 * How far a publication year may sit from the cited one and still be the same
 * work.
 *
 * Not zero. An online-first article carries one year in Crossref and another on
 * the printed issue a student cites from, and a preprint posted in December is
 * routinely cited by the journal year that follows. ±1 costs almost nothing in
 * discrimination — a fabricated author pair does not acquire a real paper by
 * widening a year — and it removes the most common way a real citation would
 * have been called invented.
 */
export const YEAR_TOLERANCE = 1

export interface CandidateWork {
  title: string
  /** Family names, as the index returns them. */
  authorSurnames: string[]
  year: number | null
}

export interface Corroboration {
  /** Does a returned work carry every surname cited, in the right year? */
  found: boolean
  /** The work that matched, for quoting back. Null when nothing did. */
  match: CandidateWork | null
  /** How many works the targeted query returned at all. */
  candidatesConsidered: number
}

/**
 * Did the index return the work this reference names?
 *
 * The test is authors AND year, deliberately not topic. A reference that
 * resolves to a real paper saying something else is a DIFFERENT problem —
 * the writer misread their source — and it has its own verdicts
 * (`contradicted`, `overstated`) and its own repair. Folding topical fit in
 * here would report a misread source as an invented one, which is both wrong
 * and the more serious accusation of the two.
 *
 * EVERY cited surname must appear. A single common surname ("Smith, 2020")
 * therefore corroborates on almost any hit, and that asymmetry is the right way
 * round: the check can quietly fail to catch a fabrication, and cannot easily
 * manufacture one. Fabricated references overwhelmingly name a pair — that is
 * what makes them read as real — and a work carrying both invented surnames in
 * the stated year is what does not exist.
 */
export function corroborate(ref: CitedReference, candidates: CandidateWork[]): Corroboration {
  const wanted = ref.surnames.map(normalizeName).filter(Boolean)
  if (wanted.length === 0 || ref.year === null) {
    return { found: false, match: null, candidatesConsidered: candidates.length }
  }

  const match =
    candidates.find((work) => {
      if (work.year !== null && Math.abs(work.year - ref.year!) > YEAR_TOLERANCE) return false
      const have = work.authorSurnames.map(normalizeName)
      // `endsWith` rather than equality: indexes carry compound and hyphenated
      // surnames a citation shortens, and a citation's "Dijk" should meet the
      // record's "van Dijk".
      return wanted.every((name) => have.some((h) => h === name || h.endsWith(` ${name}`)))
    }) ?? null

  return { found: match !== null, match, candidatesConsidered: candidates.length }
}

/**
 * Two named authors, because one carries no information.
 *
 * Measured 2026-08-16. A query for a single surname and year returns a work by
 * SOMEONE of that name essentially always — "Dunster 2018" returns a blood
 * coagulation paper, "Barrero 2023" a Spanish public-procurement article — so a
 * single-author reference corroborates on a coincidence, and would corroborate
 * an invented single-author reference exactly as readily. The check has no
 * power there at all, and a check with no power that still returns an answer is
 * worse than one that declines: it converts "we cannot tell" into "verified".
 *
 * Two surnames is a different object. A work carrying BOTH cited names in the
 * cited year is not something a common surname produces by chance, so both a
 * corroboration and its absence mean something.
 *
 * The cost is real and is not hidden: an invented single-author citation
 * ("Smith, 2019") cannot be caught by this at all, and `et al.` names exactly
 * one surname however many authors it hides. What is bought is that the check
 * cannot manufacture an accusation out of a common name — and being told you
 * invented a source you actually cited is the most damaging thing this product
 * could say to a writer.
 *
 * The alternative for single authors — requiring the found work to be TOPICALLY
 * close to the claim — was rejected: it reports a writer who misread a real
 * paper as one who invented it, which is the more serious accusation of the two
 * and the wrong repair entirely.
 */
export const MIN_CHECKABLE_SURNAMES = 2

/**
 * Is this reference one the check can say anything about?
 *
 * Institutional and title-only references are excluded because a scholarly
 * index answers them badly — a WHO report lives on WHO's site with no Crossref
 * record, so "not found" there carries no information and acting on it would
 * accuse a writer who cited it properly.
 *
 * Excluded means UNCHECKED, never "fine". A caller that reads a skipped
 * reference as a corroborated one has turned every uncoverable citation style
 * into a clean bill of health.
 */
export function isCheckable(ref: CitedReference): boolean {
  return (
    ref.kind === 'author-year' && ref.surnames.length >= MIN_CHECKABLE_SURNAMES && ref.year !== null
  )
}

/**
 * Content words from the sentence, to point the query at the right work.
 *
 * Bounded, because this rides in a URL and a whole paragraph would dilute the
 * surnames it is meant to support. The citation itself is stripped out first —
 * it is already in the query as author names, and leaving "(Wheaton and Ferro,
 * 2016)" in duplicates them.
 */
function contextTerms(context: string, ref: CitedReference, maxChars = 120): string {
  return context
    .replace(ref.raw, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .join(' ')
    .slice(0, maxChars)
}

/**
 * The targeted query: does the work this sentence NAMES exist?
 *
 * Entirely separate from the evidence search, which asks what the literature
 * says about the claim — and which is why the fabricated citation went
 * unnoticed. That search returned eight real, genuinely relevant papers about
 * AI feedback and none of them was the named work; nothing in that result set
 * could answer this question, because it was never a search for it.
 *
 * `query.bibliographic` rather than `query.author`, and this is the difference
 * between a check that works and one that does not. Measured 2026-08-16 over
 * the essay corpus: `query.author=Wheaton Ferro` with a year filter returns
 * twenty works, ranked by Crossref's own relevance, which has no idea which of
 * forty Wheatons is meant — the actual paper was not among them, and a real
 * citation came back uncorroborated. `query.bibliographic` is Crossref's
 * reference-matching field; given the surnames AND the sentence's own words it
 * put the right paper first.
 *
 * The context only helps RANK the candidates. What decides a match is still
 * authors and year alone (see `corroborate`), so a sentence that misdescribes
 * a real paper still corroborates — that is a different problem with different
 * verdicts, and conflating the two would report a misread source as an invented
 * one.
 *
 * Cheap: one unmetered Crossref request.
 */
export function crossrefReferenceQueries(
  ref: CitedReference,
  {
    context = '',
    rows = 20,
    mailto = null
  }: { context?: string; rows?: number; mailto?: string | null } = {}
): string[] {
  if (!isCheckable(ref)) return []
  const from = ref.year! - YEAR_TOLERANCE
  const until = ref.year! + YEAR_TOLERANCE

  const build = (bibliographic: string): string => {
    const params = new URLSearchParams({
      'query.bibliographic': bibliographic,
      filter: `from-pub-date:${from}-01-01,until-pub-date:${until}-12-31`,
      select: 'title,author,issued,DOI',
      rows: String(rows),
      ...(mailto ? { mailto } : {})
    })
    return `https://api.crossref.org/works?${params.toString()}`
  }

  const names = `${ref.surnames.join(' ')} ${ref.year}`
  const terms = contextTerms(context, ref)

  // Two queries, and a match on EITHER corroborates. They fail in opposite
  // directions, which is the whole reason for the pair:
  //
  //   with context     rescues a common surname the index has thousands of.
  //                    "Wheaton Ferro 2016" alone returns twenty petroleum
  //                    engineering and lifestyle sport papers and not the one
  //                    cited; the sentence's own words put it first.
  //
  //   without context  rescues a reference whose sentence contains a word the
  //                    index reads as a term of art. "students TYPED them on
  //                    laptops" turned a query for the most cited note-taking
  //                    study in psychology into twenty papers on typed lambda
  //                    calculus, and a real, famous citation came back
  //                    uncorroborated.
  //
  // Corroboration is an existence proof, so looking twice can only reduce false
  // accusations — it cannot manufacture one, because both queries still have to
  // clear the same authors-and-year test. Measured 2026-08-16: neither query
  // finds any of the ten invented pairs, together they find 16 of 16 real ones.
  return terms ? [build(`${names} ${terms}`), build(names)] : [build(names)]
}
