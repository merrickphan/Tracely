import { classifyStance, cosineSimilarity, embedCached, type StanceVerdict } from '../ml'
import * as crossref from './crossref'
import { shouldQueryPubmed } from './domainRouter'
import * as openalex from './openalex'
import * as pubmed from './pubmed'
import * as semanticScholar from './semanticScholar'
import {
  computeStrengthScore,
  computeTextRelevance,
  MIN_COUNTABLE_RELEVANCE,
  type RelevanceMetric
} from './scoring'
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
  /** Whether this source agrees with the claim. Null when stance could not be
   *  determined — either the model was unavailable or the source did not clear
   *  the relevance bar, which are different from "unclear" and both mean the
   *  same thing to a reader: this source is not evidence either way. */
  stance: StanceVerdict | null
}

/**
 * Attaches a stance verdict to the evidence that has earned one.
 *
 * Only sources above the relevance floor are asked about. An NLI model given
 * an unrelated paper does not answer "irrelevant" — it picks whichever of
 * entailment/contradiction/neutral fits best, and on the twelve-pair test set
 * the single dangerous error was exactly that: a 0.64 "contradicts" between a
 * claim about school start times and a paper on chronotype and depression.
 * Relevance is the gate that keeps that pair from ever being asked about.
 */
async function attachStance(
  claimText: string,
  scored: { item: NormalizedSourceResult; textRelevance: number }[],
  metric: RelevanceMetric
): Promise<(StanceVerdict | null)[]> {
  const floor = MIN_COUNTABLE_RELEVANCE[metric]
  const eligible = scored.map((s, index) => ({ index, s })).filter(({ s }) => s.textRelevance >= floor)
  if (eligible.length === 0) return scored.map(() => null)

  const verdicts = await classifyStance(
    claimText,
    eligible.map(({ s }) => candidateText(s.item))
  )
  if (!verdicts) return scored.map(() => null)

  const byIndex = new Array<StanceVerdict | null>(scored.length).fill(null)
  eligible.forEach(({ index }, i) => {
    byIndex[index] = verdicts[i]
  })
  return byIndex
}

/**
 * Fills in what the discovering provider didn't know, from OpenAlex, by DOI.
 *
 * Runs BEFORE relevance is computed, which is the point: an abstract is most of
 * what the embedding model has to work with, and adding one changes the ranking
 * rather than just the card. Measured on the labelled baseline, sources with
 * abstracts separated relevant from irrelevant at 0.238 against 0.192 on titles
 * alone.
 *
 * Crossref finds the most relevant papers (45% of its results were labelled
 * relevant against OpenAlex's 29%) but hardcodes `pdfUrl: null`, `oaStatus:
 * null`, and carried an abstract for only 24% of the baseline where OpenAlex
 * had 90%. Discovery and metadata are different jobs and the providers are good
 * at different ones.
 *
 * Mutates in place rather than returning copies — these objects are local to
 * this function's caller and nothing else holds a reference yet.
 */
async function enrichFromOpenAlex(items: NormalizedSourceResult[]): Promise<void> {
  // Only ask about what is actually missing. A record OpenAlex itself returned
  // already has everything this could add.
  const needy = items.filter(
    (item) => item.doi !== null && (item.abstract === null || item.pdfUrl === null || item.oaStatus === null)
  )
  if (needy.length === 0) return

  const enrichments = await openalex.enrichByDoi(needy.map((item) => item.doi as string))
  if (enrichments.size === 0) return

  for (const item of needy) {
    const found = enrichments.get(openalex.normalizeDoi(item.doi as string))
    if (!found) continue

    // Never overwrite what a provider already supplied — this is a backfill,
    // not a correction. The discovering provider saw the record in its own
    // context and its abstract may be the better one.
    item.abstract ??= found.abstract
    item.pdfUrl ??= found.pdfUrl
    item.oaStatus ??= found.oaStatus
    item.url ??= found.landingPageUrl
    item.venueType ??= found.venueType
    item.citationCount ??= found.citationCount
  }

  // Crossref and PubMed do not flag retractions, so before this the only
  // protection was OpenAlex's own search filter — which never saw the papers
  // the other providers found. A retracted paper is the worst possible
  // evidence: the literature has formally withdrawn it.
  const retracted = new Set(
    [...enrichments].filter(([, value]) => value.retracted).map(([doi]) => doi)
  )
  if (retracted.size > 0) {
    for (let i = items.length - 1; i >= 0; i--) {
      const doi = items[i].doi
      if (doi && retracted.has(openalex.normalizeDoi(doi))) {
        console.warn(`[search] dropping retracted paper: ${items[i].title}`)
        items.splice(i, 1)
      }
    }
  }
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

  await enrichFromOpenAlex(clusters)

  // Ranked (and capped) by relevance to the claim itself, not just whichever
  // provider ranked its own result highest — see blendedRelevance/
  // computeTextRelevance for why: provider rank alone let confidently wrong
  // top hits pass straight through.
  const { values, metric } = await computeRelevances(claimText, clusters)
  const scored = clusters.map((item, index) => ({ item, textRelevance: values[index] }))
  scored.sort((a, b) => blendedRelevance(b.item, b.textRelevance) - blendedRelevance(a.item, a.textRelevance))
  const topScored = scored.slice(0, MAX_MERGED_RESULTS)

  // After the cut to eight, not before: stance is the most expensive local
  // step and there is no point asking it about candidates that were never
  // going to be shown.
  const stances = await attachStance(claimText, topScored, metric)

  const evidence: RankedSourceResult[] = topScored.map((s, index) => ({
    ...s.item,
    textRelevance: s.textRelevance,
    stance: stances[index]
  }))
  const { score, breakdown } = computeStrengthScore(
    topScored.map((s, index) => ({
      venueType: s.item.venueType,
      year: s.item.year,
      relevanceRank: s.item.relevanceRank,
      textRelevance: s.textRelevance,
      stance: stances[index]?.stance ?? null
    })),
    metric
  )

  return { evidence, score, breakdown }
}
