import type { Author } from '@shared/types'
import { throttle } from './rateLimiter'
import type { NormalizedSourceResult } from './types'

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const MIN_INTERVAL_MS = 350 // NCBI allows ~3 req/sec unauthenticated

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
}

interface EsummaryResponse {
  result?: { uids?: string[] } & Record<string, EsummaryDoc | string[] | undefined>
}

function parseYear(pubdate: string | undefined): number | null {
  const match = pubdate?.match(/\d{4}/)
  return match ? Number(match[0]) : null
}

export async function search(query: string, limit = 6): Promise<NormalizedSourceResult[]> {
  await throttle('pubmed', MIN_INTERVAL_MS)
  const searchParams = new URLSearchParams({
    db: 'pubmed',
    term: query,
    retmax: String(limit),
    retmode: 'json'
  })
  const searchRes = await fetch(`${EUTILS_BASE}/esearch.fcgi?${searchParams.toString()}`)
  if (!searchRes.ok) return []
  const searchData = (await searchRes.json()) as EsearchResponse
  const ids = searchData.esearchresult?.idlist ?? []
  if (ids.length === 0) return []

  await throttle('pubmed', MIN_INTERVAL_MS)
  const summaryParams = new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'json' })
  const summaryRes = await fetch(`${EUTILS_BASE}/esummary.fcgi?${summaryParams.toString()}`)
  if (!summaryRes.ok) return []
  const summaryData = (await summaryRes.json()) as EsummaryResponse

  return ids.map((id, index) => {
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
      abstract: null,
      provider: 'pubmed',
      providerId: id,
      citationCount: null,
      oaStatus: null,
      relevanceRank: index,
      raw: doc ?? null
    }
  })
}
