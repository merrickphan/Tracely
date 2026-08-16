import {
  corroborate,
  crossrefReferenceQueries,
  isCheckable,
  parseReferences,
  type CandidateWork,
  type CitedReference
} from '@shared/citedReference'
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
  year: number
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
  for (const url of urls) {
    const works = await fetchWorks(url)
    if (works === null) continue
    answered = true
    considered += works.length
    const result = corroborate(ref, works)
    if (result.found) {
      return {
        raw: ref.raw,
        surnames: ref.surnames,
        year: ref.year!,
        corroborated: true,
        matchedTitle: result.match?.title ?? null,
        candidatesConsidered: considered
      }
    }
  }

  if (!answered) return null
  return {
    raw: ref.raw,
    surnames: ref.surnames,
    year: ref.year!,
    corroborated: false,
    matchedTitle: null,
    candidatesConsidered: considered
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
 */
export async function checkReferences(sentence: string): Promise<ReferenceCheck[]> {
  const refs = parseReferences(sentence).filter(isCheckable).slice(0, MAX_REFERENCES_PER_CLAIM)
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
export function describeReferenceChecks(checks: ReferenceCheck[]): string | null {
  if (checks.length === 0) return null
  return checks
    .map((check) => {
      const who = `${check.surnames.join(' and ')} ${check.year}`
      return check.corroborated
        ? `${check.raw} — a targeted search of Crossref found a ${check.year} work by ${who}: "${check.matchedTitle}".`
        : `${check.raw} — a targeted search of Crossref for a work by ${who} returned ` +
            `${check.candidatesConsidered} results and none of them lists all of these authors. ` +
            `Crossref does not index most books, government and NGO reports, or non-English work, ` +
            `so this is not by itself proof the source does not exist.`
    })
    .join('\n')
}
