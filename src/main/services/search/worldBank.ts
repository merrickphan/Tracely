import { cosineSimilarity, embed, embedCached } from '../ml'
import { PROVIDER_MIN_INTERVAL_MS, throttle } from './rateLimiter'
import type { NormalizedSourceResult } from './types'

// World Development Indicators, for claims that are assertions about a
// published statistic rather than findings from a research paper.
//
// The catalogue contains roughly 1,500 indicators whose names often differ by
// one consequential qualifier: total vs. youth unemployment, current dollars
// vs. constant dollars, or one poverty line vs. another. Returning the nearest
// name unconditionally would put an authoritative-looking but wrong statistic
// in front of a student, so this provider is deliberately all-or-nothing.

const API_ROOT = 'https://api.worldbank.org/v2'
const WORLD_DEVELOPMENT_INDICATORS_SOURCE = '2'

// Measured by eval/scripts/probe-statistical.mjs. At 0.55 the representative
// claims that matched were paired with the intended indicator and the claim
// about proprietary office-vacancy data stayed silent. A miss is preferable
// to lowering this until a larger labelled set demonstrates otherwise.
const MATCH_FLOOR = 0.55

interface WorldBankIndicator {
  id: string
  name: string
  unit?: string
  source?: { id?: string; value?: string }
  sourceNote?: string
  sourceOrganization?: string
  topics?: { id?: string; value?: string }[]
}

interface IndexedIndicator {
  indicator: WorldBankIndicator
  vector: Float32Array
}

let cataloguePromise: Promise<WorldBankIndicator[]> | null = null
let indexPromise: Promise<IndexedIndicator[] | null> | null = null

function readIndicatorResponse(value: unknown): WorldBankIndicator[] {
  if (!Array.isArray(value) || !Array.isArray(value[1])) return []

  return value[1].filter((item): item is WorldBankIndicator => {
    if (typeof item !== 'object' || item === null) return false
    const candidate = item as Partial<WorldBankIndicator>
    return typeof candidate.id === 'string' && typeof candidate.name === 'string'
  })
}

async function fetchCatalogue(): Promise<WorldBankIndicator[]> {
  const params = new URLSearchParams({
    format: 'json',
    source: WORLD_DEVELOPMENT_INDICATORS_SOURCE,
    // Source 2 currently has about 1,500 indicators. Keeping them in one
    // response makes catalogue loading one free request rather than a paging
    // loop and leaves room for the catalogue to grow.
    per_page: '2000'
  })

  await throttle('worldbank', PROVIDER_MIN_INTERVAL_MS.worldbank)
  const res = await fetch(`${API_ROOT}/indicator?${params.toString()}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

  const indicators = readIndicatorResponse(await res.json())
  if (indicators.length === 0) throw new Error('indicator catalogue was empty or malformed')
  return indicators
}

function getCatalogue(): Promise<WorldBankIndicator[]> {
  if (!cataloguePromise) {
    // Share the initial download across concurrent claim searches. Reset on a
    // failure so one transient outage does not disable the provider until the
    // app restarts.
    cataloguePromise = fetchCatalogue().catch((error) => {
      cataloguePromise = null
      throw error
    })
  }
  return cataloguePromise
}

async function buildIndex(): Promise<IndexedIndicator[] | null> {
  const indicators = await getCatalogue()
  // The completed index owns these vectors for the rest of the process, so
  // putting all ~1,500 names into the shared 2,000-entry evidence cache would
  // only evict useful claim and source embeddings. Nothing reads the catalogue
  // vectors from that cache again.
  const vectors = await embed(indicators.map((indicator) => indicator.name))

  // Semantic matching is the confidence gate, not an optional ranking
  // enhancement here. If the model cannot run, staying quiet is safer than a
  // keyword fallback that confuses closely related indicators.
  if (!vectors) return null
  return indicators.map((indicator, index) => ({ indicator, vector: vectors[index] }))
}

function getIndex(): Promise<IndexedIndicator[] | null> {
  if (!indexPromise) {
    indexPromise = buildIndex()
      .then((result) => {
        // A model call may time out without disabling the worker. Let the next
        // claim retry instead of memoising a transient null for the session.
        if (result === null) indexPromise = null
        return result
      })
      .catch((error) => {
        indexPromise = null
        throw error
      })
  }
  return indexPromise
}

function description(indicator: WorldBankIndicator): string | null {
  const parts = [indicator.sourceNote?.trim(), indicator.sourceOrganization?.trim()].filter(
    (part): part is string => Boolean(part)
  )
  return parts.length > 0 ? parts.join(' Source: ') : null
}

/**
 * Finds at most one official indicator that confidently measures the claim.
 *
 * `claimText` is intentional rather than the generated academic search query:
 * the 0.55 threshold was measured against complete claims, including their
 * geography, date, direction, and unit qualifiers.
 */
export async function search(claimText: string): Promise<NormalizedSourceResult[]> {
  const index = await getIndex()
  if (!index || index.length === 0) return []

  const claimVectors = await embedCached([claimText])
  if (!claimVectors) return []

  let best: IndexedIndicator | null = null
  let bestScore = -1
  for (const candidate of index) {
    const score = cosineSimilarity(claimVectors[0], candidate.vector)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  if (!best || bestScore < MATCH_FLOOR) return []

  const indicator = best.indicator
  return [
    {
      doi: null,
      title: indicator.name,
      // The World Bank is the corporate author of the indicator page. Keeping
      // that in authors also prevents generated citations from saying
      // "Unknown Author" for an official dataset.
      authors: [{ family: 'World Bank' }],
      // An indicator is a maintained time series, not a publication from the
      // most recent observation year. `n.d.` is less misleading than making a
      // changing series look like a one-year work.
      year: null,
      venue: indicator.source?.value ?? 'World Development Indicators',
      venueType: 'dataset',
      url: `https://data.worldbank.org/indicator/${encodeURIComponent(indicator.id)}`,
      pdfUrl: null,
      abstract: description(indicator),
      provider: 'worldbank',
      providerId: indicator.id,
      citationCount: null,
      oaStatus: 'open',
      relevanceRank: 0,
      raw: { ...indicator, matchScore: bestScore }
    }
  ]
}
