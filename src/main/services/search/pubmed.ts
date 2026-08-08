import type { Author } from '@shared/types'
import { getConfig } from '../storage/config'
import { PROVIDER_MIN_INTERVAL_MS, PUBMED_KEYED_MIN_INTERVAL_MS, throttle } from './rateLimiter'
import type { NormalizedSourceResult } from './types'

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

// Without a key NCBI meters by IP, which on a school or library network is
// shared with every other student behind the same gateway — the one place
// this app's per-user request volume stops being per-user. A key is free from
// an NCBI account, meters against the key instead, and raises the ceiling
// from ~3 to ~10 requests/second.
//
// Read per call rather than captured at module load: config resolves lazily
// through getAppPaths(), and a key set in Settings must take effect without a
// restart.
function withKey(params: URLSearchParams): URLSearchParams {
  const key = getConfig().ncbiApiKey
  if (key) params.set('api_key', key)
  return params
}

function minIntervalMs(): number {
  return getConfig().ncbiApiKey ? PUBMED_KEYED_MIN_INTERVAL_MS : PROVIDER_MIN_INTERVAL_MS.pubmed
}

interface EsearchResponse {
  esearchresult?: { idlist?: string[] }
}

interface ArticleId {
  idtype?: string
  value?: string
}

interface EsummaryDoc {
  uid: string
  title?: string
  authors?: { name?: string }[]
  source?: string
  pubdate?: string
  articleids?: ArticleId[]
  pubtype?: string[]
}

interface EsummaryResponse {
  result?: { uids?: string[] } & Record<string, EsummaryDoc | string[] | undefined>
}

// Commentary and correction records, not research. They match keyword
// queries as readily as the papers they discuss (an editorial about a sleep
// study is full of sleep-study words) and then occupy one of the eight
// evidence slots with something that reports no findings of its own.
// "Retracted Publication" marks the withdrawn paper itself.
const EXCLUDED_PUB_TYPES = new Set([
  'Editorial',
  'Comment',
  'Erratum',
  'Published Erratum',
  'Retraction of Publication',
  'Retracted Publication',
  'Expression of Concern'
])

function parseYear(pubdate: string | undefined): number | null {
  const match = pubdate?.match(/\d{4}/)
  return match ? Number(match[0]) : null
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
}

// esummary carries no abstract, so until now every PubMed result reached
// scoring with `abstract: null` and was matched against the claim on its
// title alone. That mattered little when relevance was Jaccard, but claim
// coverage rewards sources with more matchable text, so title-only records
// would be systematically pushed below their OpenAlex/S2 equivalents for a
// reason that has nothing to do with the paper. It also starves the
// critique (and the planned stance pass) of the one thing they reason over.
//
// efetch returns XML and pulling in an XML parser for two fields isn't
// worth it: records are split on their closing tag so a PMID can never be
// matched against a neighbouring article's abstract. Structured abstracts
// carry a Label per section ("RESULTS", "CONCLUSIONS") — kept, because the
// labelled findings are exactly the part a fact-check needs to find.
function parseAbstracts(xml: string): Map<string, string> {
  const abstracts = new Map<string, string>()

  for (const record of xml.split('</PubmedArticle>')) {
    const pmid = record.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1]
    if (!pmid) continue

    const sections: string[] = []
    const matcher = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g
    let match: RegExpExecArray | null
    while ((match = matcher.exec(record)) !== null) {
      const label = match[1].match(/Label="([^"]*)"/)?.[1]
      const body = decodeEntities(match[2].replace(/<[^>]+>/g, '')).trim()
      if (body) sections.push(label ? `${label}: ${body}` : body)
    }

    if (sections.length > 0) abstracts.set(pmid, sections.join(' '))
  }

  return abstracts
}

async function fetchAbstracts(ids: string[]): Promise<Map<string, string>> {
  // Abstracts are an enrichment — a failure here should cost the text, not
  // the results, so this never throws into the caller.
  try {
    await throttle('pubmed', minIntervalMs())
    const params = withKey(
      new URLSearchParams({
        db: 'pubmed',
        id: ids.join(','),
        retmode: 'xml',
        rettype: 'abstract'
      })
    )
    const res = await fetch(`${EUTILS_BASE}/efetch.fcgi?${params.toString()}`)
    if (!res.ok) return new Map()
    return parseAbstracts(await res.text())
  } catch (error) {
    console.error('[search:pubmed] abstract fetch failed', error)
    return new Map()
  }
}

// Terms that carry no indexing value in PubMed and actively break matching.
// Years are the worst of them: esearch maps a bare "2014" onto a date-ish
// field and ANDs it in, which almost nothing satisfies.
const QUERY_NOISE = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'as', 'is', 'are', 'was', 'were',
  'be', 'by', 'from', 'at', 'into', 'about', 'than', 'this', 'that', 'these', 'those', 'it', 'its',
  'study', 'studies', 'research', 'paper', 'article', 'findings', 'found', 'effect', 'effects', 'impact',
  'role', 'use', 'using', 'between', 'among', 'during', 'after', 'before', 'new', 'recommendation',
  'statistics', 'evidence', 'show', 'shows'
])

/**
 * Rewrites a natural-language search query into something esearch can answer.
 *
 * esearch runs Automatic Term Mapping across the whole string and ANDs the
 * pieces together, so a long query with proper nouns and a year produces a
 * conjunction nothing satisfies and returns *nothing at all*. Measured across
 * the thirteen labelled claims, the raw query returned zero results for 10 of
 * them — including every claim on the adolescent-sleep essay, which is
 * squarely PubMed's domain. Simplifying takes that to 3 of 13, and the sleep
 * claims start returning the papers they should have all along.
 *
 * Capped at five terms because each additional term is another AND. This is
 * deliberately lossy; the domain router is what stops the loss from mattering,
 * by only sending claims here that PubMed could answer in the first place.
 */
export function toPubmedQuery(query: string): string {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !QUERY_NOISE.has(word) && !/^\d+$/.test(word))

  const unique = [...new Set(terms)].slice(0, 5)
  // Nothing usable left — hand back the original rather than an empty term,
  // which esearch answers with a 400.
  return unique.length > 0 ? unique.join(' AND ') : query
}

export async function search(query: string, limit = 6): Promise<NormalizedSourceResult[]> {
  await throttle('pubmed', minIntervalMs())
  const searchParams = withKey(
    new URLSearchParams({
      db: 'pubmed',
      term: toPubmedQuery(query),
      retmax: String(limit),
      retmode: 'json'
    })
  )
  const searchRes = await fetch(`${EUTILS_BASE}/esearch.fcgi?${searchParams.toString()}`)
  if (!searchRes.ok) {
    console.warn(`[search:pubmed] ${searchRes.status} ${searchRes.statusText} — no results for "${query}"`)
    return []
  }
  const searchData = (await searchRes.json()) as EsearchResponse
  const ids = searchData.esearchresult?.idlist ?? []
  if (ids.length === 0) return []

  await throttle('pubmed', minIntervalMs())
  const summaryParams = withKey(
    new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'json' })
  )
  const summaryRes = await fetch(`${EUTILS_BASE}/esummary.fcgi?${summaryParams.toString()}`)
  if (!summaryRes.ok) return []
  const summaryData = (await summaryRes.json()) as EsummaryResponse

  const kept = ids.filter((id) => {
    const doc = summaryData.result?.[id] as EsummaryDoc | undefined
    return !(doc?.pubtype ?? []).some((type) => EXCLUDED_PUB_TYPES.has(type))
  })
  if (kept.length === 0) return []

  const abstracts = await fetchAbstracts(kept)

  return kept.map((id, index) => {
    const doc = summaryData.result?.[id] as EsummaryDoc | undefined
    const doi = doc?.articleids?.find((a) => a.idtype === 'doi')?.value ?? null
    const authors: Author[] = (doc?.authors ?? [])
      .map((a) => a.name)
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ family: name }))

    return {
      doi,
      title: doc?.title ?? 'Untitled',
      authors,
      year: parseYear(doc?.pubdate),
      venue: doc?.source ?? null,
      venueType: 'journal',
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      pdfUrl: null,
      abstract: abstracts.get(id) ?? null,
      provider: 'pubmed',
      providerId: id,
      citationCount: null,
      oaStatus: null,
      relevanceRank: index,
      raw: doc ?? null
    }
  })
}
