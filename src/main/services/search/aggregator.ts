import { cosineSimilarity, embedCached } from '../ml'
import * as crossref from './crossref'
import { shouldQueryPubmed } from './domainRouter'
import * as openalex from './openalex'
import * as pubmed from './pubmed'
import * as semanticScholar from './semanticScholar'
import { computeStrengthScore, computeTextRelevance, type RelevanceMetric } from './scoring'
import type { NormalizedSourceResult } from './types'

const PER_PROVIDER_LIMIT = 6
const MAX_MERGED_RESULTS = 8

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// Same 0.75/0.25 blend as scoring.ts's relevance factor — used here too so
// the results that make the cut (and their order) reflect the same
// "actually about the claim" signal the final strength score is judged by,
// not just whatever order the source providers happened to return.
function blendedRelevance(item: NormalizedSourceResult, textRelevance: number): number {
  const rankRelevance = clamp01(1 - item.relevanceRank / PER_PROVIDER_LIMIT)
  return 0.75 * textRelevance + 0.25 * rankRelevance
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function normalizedDoi(item: NormalizedSourceResult): string | null {
  return item.doi ? item.doi.toLowerCase().trim() : null
}

function titleYearKey(item: NormalizedSourceResult): string {
  return `${normalizeTitle(item.title)}:${item.year ?? ''}`
}

// Same paper, indexed by two different providers, doesn't always come back
// with a DOI from BOTH of them — one might have it, the other might not (or
// one is the preprint record, one the published version). Matching on DOI
// *or* normalized title+year — instead of committing to whichever key the
// first-seen record happened to have — is what catches that case; DOI-only
// matching let those pairs both survive into the same claim's evidence list
// as if they were two different sources.
function findDuplicateIndex(clusters: NormalizedSourceResult[], item: NormalizedSourceResult): number {
  const doi = normalizedDoi(item)
  const titleYear = titleYearKey(item)
  return clusters.findIndex((c) => (doi !== null && normalizedDoi(c) === doi) || titleYearKey(c) === titleYear)
}

async function safeSearch(
  name: string,
  fn: (query: string, limit?: number) => Promise<NormalizedSourceResult[]>,
  query: string
): Promise<NormalizedSourceResult[]> {
  try {
    return await fn(query, PER_PROVIDER_LIMIT)
  } catch (error) {
    console.error(`[search:${name}]`, error)
    return []
  }
}

/**
 * A merged result with its claim-coverage score attached (see
 * computeTextRelevance). Callers used to have to re-derive a relevance
 * number and got it wrong — evidenceHandlers computed `1 - rank/length`,
 * i.e. the provider's own rank, which is not what results were sorted by
 * and not what critique.ts filters on. Carrying the real value out of the
 * one place that computes it removes that whole class of drift.
 */
export interface RankedSourceResult extends NormalizedSourceResult {
  textRelevance: number
}

function candidateText(item: NormalizedSourceResult): string {
  return `${item.title} ${item.abstract ?? ''}`.trim()
}

/**
 * How well each candidate matches the claim, semantically where possible.
 *
 * Word overlap cannot fix the failure this exists for. eval/baseline.md
 * recorded a remote-work claim retrieving remote *sensing* papers; measured on
 * that exact case, coverage scores the Bloom/Ctrip paper and a satellite
 * imagery paper **identically at 0.200**, because each shares exactly one of
 * the claim's five content words. There is no threshold that separates them.
 * Embeddings score them 0.44 and 0.03.
 *
 * One batched call for the claim and every candidate together: the worker
 * round-trip dominates, so 25 texts at once costs barely more than one.
 * Falls back to coverage whenever the model is unavailable — the caller is
 * told which metric came back, because the two need different thresholds.
 */
async function computeRelevances(
  claimText: string,
  items: NormalizedSourceResult[]
): Promise<{ values: number[]; metric: RelevanceMetric }> {
  const texts = items.map(candidateText)
  const vectors = await embedCached([claimText, ...texts])

  if (!vectors) {
    return { values: texts.map((text) => computeTextRelevance(claimText, text)), metric: 'lexical' }
  }

  const claimVector = vectors[0]
  return { values: vectors.slice(1).map((vector) => cosineSimilarity(claimVector, vector)), metric: 'dense' }
}

export async function findEvidence(
  query: string,
  claimText: string
): Promise<{ evidence: RankedSourceResult[]; score: number; breakdown: ReturnType<typeof computeStrengthScore>['breakdown'] }> {
  // Asked before the fan-out rather than filtered after: PubMed costs three
  // requests per claim (esearch, esummary, efetch) and contributed zero
  // relevant sources across the labelled baseline, so for a claim it cannot
  // answer the cheapest thing is not to ask.
  const usePubmed = await shouldQueryPubmed(claimText, query)

  const results = await Promise.all([
    safeSearch('openalex', openalex.search, query),
    safeSearch('crossref', crossref.search, query),
    safeSearch('semanticscholar', semanticScholar.search, query),
    usePubmed ? safeSearch('pubmed', pubmed.search, query) : Promise.resolve([])
  ])

  const clusters: NormalizedSourceResult[] = []
  for (const providerResults of results) {
    for (const item of providerResults) {
      const idx = findDuplicateIndex(clusters, item)
      if (idx === -1) {
        clusters.push(item)
        continue
      }
      // Keep whichever record is more useful: prefer one that actually has
      // a DOI (more complete/citable metadata) over one that doesn't, and
      // between two comparable records prefer the one its own provider
      // ranked higher.
      const existing = clusters[idx]
      const itemHasDoi = normalizedDoi(item) !== null
      const existingHasDoi = normalizedDoi(existing) !== null
      if ((itemHasDoi && !existingHasDoi) || (itemHasDoi === existingHasDoi && item.relevanceRank < existing.relevanceRank)) {
        clusters[idx] = item
      }
    }
  }

  // Ranked (and capped) by relevance to the claim itself, not just whichever
  // provider ranked its own result highest — see blendedRelevance/
  // computeTextRelevance for why: provider rank alone let confidently wrong
  // top hits pass straight through.
  const { values, metric } = await computeRelevances(claimText, clusters)
  const scored = clusters.map((item, index) => ({ item, textRelevance: values[index] }))
  scored.sort((a, b) => blendedRelevance(b.item, b.textRelevance) - blendedRelevance(a.item, a.textRelevance))
  const topScored = scored.slice(0, MAX_MERGED_RESULTS)

  const evidence: RankedSourceResult[] = topScored.map((s) => ({
    ...s.item,
    textRelevance: s.textRelevance
  }))
  const { score, breakdown } = computeStrengthScore(
    topScored.map((s) => ({
      venueType: s.item.venueType,
      year: s.item.year,
      relevanceRank: s.item.relevanceRank,
      textRelevance: s.textRelevance
    })),
    metric
  )

  return { evidence, score, breakdown }
}
