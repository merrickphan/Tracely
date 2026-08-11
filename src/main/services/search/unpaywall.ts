import { politePoolMailto } from '../storage/settingsRepo'
import { normalizeDoi } from './openalex'
import { PROVIDER_MIN_INTERVAL_MS, throttle } from './rateLimiter'
import type { NormalizedSourceResult } from './types'

// Not a search provider — it never contributes a result, it only repairs the
// link on one that already exists.
//
// Crossref returns `https://doi.org/...` as a work's canonical URL, and
// OpenAlex falls back to the same form whenever it has no landing page, so a
// results list was overwhelmingly DOI resolvers. That is technically correct
// and practically useless to a student: it lands on a publisher paywall
// rather than on something readable.
//
// It cannot fix everything, and deliberately does not pretend to: a paper with
// no free copy anywhere keeps its doi.org link, because for a closed paper the
// resolver genuinely IS the right permanent link.

const ENDPOINT = 'https://api.unpaywall.org/v2'

// Same shape as openalex's ENRICH_CONCURRENCY and for the same reason: these
// are one request per DOI, and serialising them behind a throttle chain would
// add seconds to every claim. Unpaywall publishes a daily volume cap (100k)
// rather than a rate, so this is politeness against a burst.
const LOOKUP_CONCURRENCY = 6

interface UnpaywallLocation {
  url_for_landing_page?: string | null
  url_for_pdf?: string | null
  host_type?: string | null
  version?: string | null
}

interface UnpaywallResponse {
  oa_status?: string | null
  best_oa_location?: UnpaywallLocation | null
  oa_locations?: UnpaywallLocation[] | null
}

export interface OpenAccessLinks {
  landingPageUrl: string | null
  pdfUrl: string | null
  oaStatus: string | null
}

/** Whether a URL is a bare DOI resolver rather than somewhere readable. */
export function isDoiResolver(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https?:\/\/(dx\.)?doi\.org\//i.test(url)
}

// Version matters for more than preference: Tracely generates a citation for
// the PUBLISHED work, so linking a `submittedVersion` sends the reader to a
// preprint whose content can differ from the thing being cited. Preferred in
// order, never excluded — a preprint still beats a paywall.
const VERSION_RANK: Record<string, number> = {
  publishedVersion: 0,
  acceptedVersion: 1,
  submittedVersion: 2
}

// Repository copies of one paper routinely tie on both version and host_type —
// a PLOS paper checked against the live API had three `submittedVersion`
// repository locations (DOAJ, PubMed Central, figshare), so whichever happened
// to sort first won. That picked the figshare *dataset* record: not the
// article, and not something to hand a student as the source of a claim.
//
// So content type breaks the tie before host_type does. This is a heuristic
// over a handful of hosts rather than an allowlist to maintain: anything
// unrecognised sits in the middle and is neither preferred nor penalised.
function contentTier(url: string): number {
  // PubMed Central is the canonical free full text for the biomedical
  // literature, and Europe PMC mirrors it.
  if (/(\/\/|\.)europepmc\.org\/|ncbi\.nlm\.nih\.gov\/pmc\//i.test(url)) return 0
  // Dataset and index records describe the work without being it.
  if (/figshare\.com\/|datadryad\.org\/|zenodo\.org\/record\/|doaj\.org\/article\//i.test(url)) return 2
  return 1
}

function rank(loc: UnpaywallLocation): number {
  const version = VERSION_RANK[loc.version ?? ''] ?? 3
  const content = contentTier(loc.url_for_landing_page ?? loc.url_for_pdf ?? '')
  // Publisher copies are the authoritative text; repositories are the
  // fallback. Weakest signal of the three — version and content type both
  // dominate it.
  const host = loc.host_type === 'publisher' ? 0 : 1
  return version * 100 + content * 10 + host
}

/**
 * Picks the most useful free links out of a DOI's open-access locations.
 *
 * `best_oa_location` alone is not enough, which is the whole reason this is
 * more than a two-line field read. Checked against the live API: for both a
 * gold-OA PLOS paper and a closed Cell paper, `best_oa_location` is the
 * *publisher* record and its `url_for_landing_page` is itself
 * `https://doi.org/...` — so taking it would have swapped one resolver for
 * another and fixed nothing. The genuinely useful links (PMC, DOAJ, figshare,
 * a direct publisher PDF) live in the `oa_locations` array alongside it.
 */
export function selectLinks(data: UnpaywallResponse): OpenAccessLinks | null {
  const candidates = [data.best_oa_location, ...(data.oa_locations ?? [])].filter(
    (loc): loc is UnpaywallLocation => Boolean(loc)
  )
  if (candidates.length === 0) return null

  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b))

  // A resolver landing page is worth no more than the link already held, so
  // it is not a candidate here at all.
  const landing = ordered.find((loc) => loc.url_for_landing_page && !isDoiResolver(loc.url_for_landing_page))
  const pdf = ordered.find((loc) => loc.url_for_pdf && !isDoiResolver(loc.url_for_pdf))
  if (!landing && !pdf) return null

  return {
    landingPageUrl: landing?.url_for_landing_page ?? null,
    pdfUrl: pdf?.url_for_pdf ?? null,
    oaStatus: data.oa_status ?? null
  }
}

// Bounds on enrichment, and the reason they are not optional.
//
// `attachOpenAccessLinks` is awaited inside `findEvidence`, *after* the section
// that `PROVIDER_TIMEOUT_MS` protects. So while every search provider is capped
// at 6s, an unbounded fetch here re-opened exactly the hole aggregator.ts's own
// comment describes: the Screen Watch popover shows a loading state until the
// search resolves, so one Unpaywall connection that is accepted and then never
// answered left "loading articles" spinning forever.
//
// Two separate limits, because one does not imply the other. The per-request
// timeout stops a single stalled connection; the budget stops N sequential slow
// -but-not-stalled lookups from adding up past anything reasonable.
const LOOKUP_TIMEOUT_MS = 4000
const ENRICHMENT_BUDGET_MS = 8000

async function lookup(doi: string, email: string): Promise<OpenAccessLinks | null> {
  // AbortController rather than AbortSignal.timeout so the timer is cleared on
  // the normal path instead of being left to fire into nothing.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`, {
      signal: controller.signal
    })
    // 404 is the normal answer for a DOI Unpaywall has never indexed, not a
    // failure worth logging — enrichment is additive and a source with a
    // resolver link is still a source.
    if (!res.ok) return null
    return selectLinks((await res.json()) as UnpaywallResponse)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Replaces DOI-resolver links with open-access ones, in place.
 *
 * Only asks about items that would actually benefit: a result that already
 * carries a real publisher landing page is left alone, so this costs one
 * request per genuinely-unhelpful link rather than one per result.
 *
 * Call it AFTER the cut to what will be shown. Enriching every merged
 * candidate would spend most of its requests on results nobody sees.
 */
export async function attachOpenAccessLinks(items: NormalizedSourceResult[]): Promise<void> {
  const email = politePoolMailto()

  const needsLink = items.filter((item) => item.doi !== null && (item.url === null || isDoiResolver(item.url)))
  if (needsLink.length === 0) return

  const queue = [...needsLink]
  const deadline = Date.now() + ENRICHMENT_BUDGET_MS
  const workers = Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      // Best-effort by design: this only ever upgrades a link that already
      // works. Abandoning the rest of the queue costs some doi.org resolvers
      // staying as they are, which is strictly better than holding up every
      // result that did resolve.
      if (Date.now() >= deadline) return
      const item = queue.shift()
      if (item === undefined) return
      try {
        await throttle('unpaywall', PROVIDER_MIN_INTERVAL_MS.unpaywall)
        const links = await lookup(normalizeDoi(item.doi as string), email)
        if (!links) continue

        // Landing page preferred over PDF for the main link: it carries the
        // citation metadata and abstract, and a PDF that opens in an external
        // viewer is a worse first click. pdfUrl is carried separately, and
        // only filled when the provider had none of its own.
        if (links.landingPageUrl) item.url = links.landingPageUrl
        else if (links.pdfUrl) item.url = links.pdfUrl
        if (!item.pdfUrl && links.pdfUrl) item.pdfUrl = links.pdfUrl
        if (!item.oaStatus && links.oaStatus) item.oaStatus = links.oaStatus
      } catch {
        // One unreachable lookup must not cost the rest their links.
      }
    }
  })

  await Promise.all(workers)
}
