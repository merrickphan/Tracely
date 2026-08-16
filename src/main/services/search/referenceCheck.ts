import {
  absenceIsInformative,
  corroborate,
  crossrefReferenceQueries,
  isCheckable,
  openLibraryReferenceQuery,
  parseReferences,
  type CandidateWork,
  type CitedReference
} from '@shared/citedReference'
import { bibliographyReferences } from '@shared/bibliography'
import { PROVIDER_MIN_INTERVAL_MS, throttle } from './rateLimiter'
import { politePoolMailto } from '../storage/settingsRepo'

/**
 * Go and look for the work the sentence names.
 *
 * The `fabricated` verdict had never fired once. The relay's Pass 2(c) requires
 * the model to be "confident no work matching this author, year and title
 * exists", and a model cannot be confident of a negative about the world — so
 * shown an invented study with every marker the prompt itself lists, it
 * correctly answered that it "cannot be verified as real or fabricated without
 * further information", and problemKind's top severity tier was unreachable by
 * construction (eval/critique/FINDINGS.md).
 *
 * This replaces the model's memory with a retrieval fact. It is deliberately
 * NOT a verdict — see `ReferenceCheck.corroborated` — and the reason is
 * measured rather than assumed: on eval/fabrication's labelled set the lookup
 * separated 10 invented author pairs from 16 real journal articles perfectly,
 * and then failed on 2 of 8 real BOOKS. Crossref registers DOIs for the
 * scholarly record; Freakonomics and Strunk & White are not in it, and a
 * student citing either is doing nothing wrong. So what ships is the evidence,
 * handed to the one reader that can tell a missing book from a missing paper.
 */
export interface ReferenceCheck {
  /** As the writer typed it. */
  raw: string
  surnames: string[]
  /** Null for the yearless shapes — "Reinhart and Rogoff found that …". */
  year: number | null
  /** The work the sentence named, when it named one. */
  title: string | null
  /**
   * The reference-list entry, when the sentence cited by pointing at one.
   *
   * Carried through to the description because the critique needs to see WHICH
   * work "[3]" turned out to name — the marker alone tells it nothing, and a
   * lookup result attached to a bare "[3]" would be unreadable.
   */
  entry?: string
  /**
   * Did an index return a work carrying every cited surname in that year?
   *
   * `false` means NOT FOUND, which is evidence and not a finding. Anything
   * downstream that renders this as "fabricated" on its own is wrong — that is
   * what the book measurement above establishes.
   */
  corroborated: boolean
  /** The work that matched, when one did. */
  matchedTitle: string | null
  /** How many works the targeted queries returned in total. */
  candidatesConsidered: number
  /**
   * Which index carried the match, or null when nothing did.
   *
   * Worth recording rather than collapsing to a boolean: a Crossref match means
   * the scholarly record contains the work, an Open Library match means it is a
   * book. Those are different facts about a citation, and the critique reasons
   * differently about them.
   */
  index: 'crossref' | 'openlibrary' | null
}

const CROSSREF_TIMEOUT_MS = 4000

/**
 * At most this many references per claim.
 *
 * A sentence names one work almost always and two occasionally. The cap is a
 * guard against a pathological paragraph, not a real budget — each reference
 * costs at most two unmetered Crossref requests.
 */
const MAX_REFERENCES_PER_CLAIM = 3

async function fetchWorks(url: string): Promise<CandidateWork[] | null> {
  await throttle('crossref', PROVIDER_MIN_INTERVAL_MS.crossref)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CROSSREF_TIMEOUT_MS) })
    if (!res.ok) {
      console.warn(`[referenceCheck] crossref ${res.status} ${res.statusText}`)
      return null
    }
    const data = (await res.json()) as {
      message?: { items?: Array<{ title?: string[]; author?: Array<{ family?: string }>; issued?: { 'date-parts'?: number[][] } }> }
    }
    return (data.message?.items ?? []).map((item) => ({
      title: item.title?.[0] ?? '(untitled)',
      authorSurnames: (item.author ?? []).map((a) => a.family ?? '').filter(Boolean),
      year: item.issued?.['date-parts']?.[0]?.[0] ?? null
    }))
  } catch (error) {
    console.warn(`[referenceCheck] crossref lookup failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Open Library, normalised into the same shape Crossref results take.
 *
 * `publish_year` carries every edition, and `corroborate` needs all of them —
 * a book is cited by the edition in the student's hands, not by its first
 * printing. Unauthenticated and unmetered; no key, no rate limit worth
 * throttling for one request behind an empty Crossref result.
 */
async function fetchBooks(url: string): Promise<CandidateWork[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CROSSREF_TIMEOUT_MS) })
    if (!res.ok) {
      console.warn(`[referenceCheck] openlibrary ${res.status} ${res.statusText}`)
      return null
    }
    const data = (await res.json()) as {
      docs?: Array<{
        title?: string
        author_name?: string[]
        first_publish_year?: number
        publish_year?: number[]
      }>
    }
    return (data.docs ?? []).map((doc) => ({
      title: doc.title ?? '(untitled)',
      // Open Library gives full names ("Steven D. Levitt"), not family names.
      // corroborate matches a cited surname against the LAST word, so the whole
      // name is passed through and left for it to split.
      authorSurnames: doc.author_name ?? [],
      year: doc.first_publish_year ?? null,
      years: doc.publish_year ?? []
    }))
  } catch (error) {
    console.warn(
      `[referenceCheck] openlibrary lookup failed: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

/**
 * Both queries, stopping at the first corroboration.
 *
 * Not "the first query that returns results" — every query returns twenty.
 * The stop condition is a work carrying every cited name, which is the only
 * thing that settles the question. The two queries fail in opposite directions
 * (see crossrefReferenceQueries), so asking both is what took the real-article
 * false-alarm rate to zero.
 *
 * Returns null when the network could not answer at all. Null is NOT
 * `corroborated: false`: a failed lookup must never reach the critique as
 * evidence that a source does not exist.
 */
async function checkOne(ref: CitedReference, context: string): Promise<ReferenceCheck | null> {
  const urls = crossrefReferenceQueries(ref, { context, mailto: politePoolMailto() })
  if (urls.length === 0) return null

  let considered = 0
  let answered = false

  const hit = (title: string | null, index: ReferenceCheck['index']): ReferenceCheck => ({
    raw: ref.raw,
    surnames: ref.surnames,
    year: ref.year,
    title: ref.title,
    corroborated: true,
    matchedTitle: title,
    candidatesConsidered: considered,
    index,
    entry: ref.entry
  })

  for (const url of urls) {
    const works = await fetchWorks(url)
    if (works === null) continue
    answered = true
    considered += works.length
    const result = corroborate(ref, works)
    if (result.found) return hit(result.match?.title ?? null, 'crossref')
  }

  // Only now, and only because Crossref came up empty. Every reference this
  // check has ever failed on was a book, and that is a gap in the corpus rather
  // than in the method — so the repair is another corpus. See
  // openLibraryReferenceQuery.
  const bookUrl = openLibraryReferenceQuery(ref)
  if (bookUrl) {
    const books = await fetchBooks(bookUrl)
    if (books !== null) {
      answered = true
      considered += books.length
      const result = corroborate(ref, books)
      if (result.found) return hit(result.match?.title ?? null, 'openlibrary')
    }
  }

  if (!answered) return null

  // Nothing found — and for a yearless reference that is not something the
  // critique may be told. See absenceIsInformative: the pattern that produced
  // it cannot be sure the names were a citation at all ("Romeo and Juliet
  // describes a feud"), and reporting an empty lookup for one would put a
  // fabrication accusation on a sentence that cited nothing. Returning null
  // here drops the reference from the section entirely, which is exactly the
  // difference between "we looked and found nothing" and "no lookup happened".
  if (!absenceIsInformative(ref)) return null

  return {
    raw: ref.raw,
    surnames: ref.surnames,
    year: ref.year,
    title: ref.title,
    corroborated: false,
    matchedTitle: null,
    candidatesConsidered: considered,
    index: null,
    entry: ref.entry
  }
}

/**
 * Every reference in this sentence the check can say something about.
 *
 * `sentence` rather than the claim text, and that is load-bearing: a detected
 * claim is a sub-span that stops at the end of the assertion, so a trailing
 * "(Minges & Redeker, 2016)" is not inside it. The same reason
 * `hasInlineCitationNear` widens to the sentence before testing.
 *
 * References the check has no power over — a single author, an institution, a
 * quoted title — are absent from the result rather than present and negative.
 * A caller that reads "no entry" as "corroborated" has turned every citation
 * style this cannot cover into a clean bill of health.
 *
 * @param document The whole draft, when the caller has it. Numbered "[3]" and
 *   MLA "(Shoup 45)" citations name no author and no year in the sentence — the
 *   reference is in a list at the end — so without this they got no fabrication
 *   check at all, and whether a draft was covered was decided by its citation
 *   style. Omitted, the author-date shapes still work exactly as before.
 */
export async function checkReferences(
  sentence: string,
  document?: string
): Promise<ReferenceCheck[]> {
  const inline = parseReferences(sentence)
  const resolved = document ? bibliographyReferences(sentence, document) : []

  // The same work can be picked up twice. "Thackeray and Nwosu found that …
  // (Thackeray and Nwosu 88)" is a yearless narrative pair AND a resolved
  // marker, and looking it up twice costs two queries and a duplicated line in
  // the description.
  //
  // The resolved one wins whenever the names match and the inline reference has
  // no year of its own, because it is strictly the better object: it carries
  // the year and title from the entry, and — unlike a bare pair of names the
  // pattern cannot be sure is a citation at all — its absence may be reported.
  // Keeping the inline one instead would silently disarm the check.
  const names = (ref: { surnames: string[] }): string => ref.surnames.join('|').toLowerCase()
  const resolvedNames = new Set(resolved.map(names))

  const refs = [
    ...inline.filter((ref) => !(ref.year === null && resolvedNames.has(names(ref)))),
    // A marker and an author-date citation for the same work in the same
    // sentence — belt and braces from the writer — is still one lookup.
    ...resolved.filter(
      (ref) => !inline.some((other) => `${names(other)}|${other.year}` === `${names(ref)}|${ref.year}`)
    )
  ]
    .filter(isCheckable)
    .slice(0, MAX_REFERENCES_PER_CLAIM)
  if (refs.length === 0) return []

  const checks: ReferenceCheck[] = []
  for (const ref of refs) {
    const check = await checkOne(ref, sentence)
    if (check) checks.push(check)
  }
  return checks
}

/**
 * The lookup result as a line the critique can read.
 *
 * Written as what was DONE and what came back, not as a conclusion. "No work
 * carrying both names was found" is a fact; "this source does not exist" is a
 * verdict, and the whole point of handing this to the model is that it can see
 * things the lookup cannot — that the reference is to a book, a government
 * report, or something the index was never going to carry.
 */
/**
 * The relay's zod schema caps this field at 1200 characters and rejects the
 * whole request past it — see api/critique.ts. Three absent references plus
 * their reference-list entries can exceed that, so the last check is dropped
 * rather than the text being cut: a truncated line could end mid-caveat, and
 * the caveat is the half that says an empty lookup is not proof. A dropped
 * check is an unchecked reference, which is a state the whole design already
 * handles; half a sentence saying no work was found is not.
 */
const MAX_DESCRIPTION_CHARS = 1200

/** Enough of an entry to identify the work, bounded for the same reason. */
const MAX_ENTRY_CHARS = 140

export function describeReferenceChecks(checks: ReferenceCheck[]): string | null {
  if (checks.length === 0) return null
  const lines = checks
    .map((check) => {
      // "Reinhart and Rogoff 2010" when the sentence gave a year, "Reinhart and
      // Rogoff" when it did not — never "Reinhart and Rogoff null", and never a
      // year the writer did not actually claim.
      const who = [check.surnames.join(' and '), check.year, check.title && `"${check.title}"`]
        .filter(Boolean)
        .join(' ')
      // "[3]" on its own names nothing, so the entry it resolved to has to be
      // shown with it — otherwise the critique is reading a lookup result for a
      // work it has not been told the identity of.
      const cited = check.entry
        ? `${check.raw}, which the document's reference list gives as "${check.entry.length > MAX_ENTRY_CHARS ? `${check.entry.slice(0, MAX_ENTRY_CHARS).trimEnd()}…` : check.entry}"`
        : check.raw
      if (check.corroborated) {
        const where =
          check.index === 'openlibrary'
            ? 'Open Library (the book index)'
            : 'Crossref (the scholarly index)'
        return `${cited} — a targeted search of ${where} found a work by ${who}: "${check.matchedTitle}".`
      }
      // Both indexes now, and the sentence has to say so — the model's remaining
      // reasons to doubt an empty result were "it might be a book" and "it might
      // be a report", and the first of those is no longer available. What is
      // left is narrower and is stated as such, rather than leaving the model to
      // apply a caveat that no longer fits.
      return (
        `${cited} — targeted searches of BOTH Crossref (the scholarly index) and ` +
        `Open Library (the book index) for a work by ${who} returned ` +
        `${check.candidatesConsidered} results in total, and none of them lists all of these ` +
        `authors. Neither index covers government and NGO reports, working papers, or much ` +
        `non-English publishing, so this is not by itself proof the source does not exist — ` +
        `but a book or textbook would have been found.`
      )
    })

  while (lines.length > 1 && lines.join('\n').length > MAX_DESCRIPTION_CHARS) lines.pop()
  const described = lines.join('\n')
  // A single line that still will not fit is reported as no lookup rather than
  // as a cut one, for the reason above: every state this function can return
  // is safe except a half-sentence.
  return described.length <= MAX_DESCRIPTION_CHARS ? described : null
}
