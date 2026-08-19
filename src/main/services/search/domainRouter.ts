import { cosineSimilarity, embedCached } from '../ml'

// Which providers are worth asking about a given claim.
//
// This started as a yes/no question about PubMed, for a measured reason: PubMed
// indexes biomedical literature and nothing else, so for a claim about the
// printing press every result it can return is a false match. The baseline's 0
// relevant sources out of 11 was structural, not bad luck.
//
// The same logic generalises. The academic providers are the wrong instrument
// for a claim about an economic indicator or a historical date, and the
// baseline shows it: the best result for "commercial office vacancy rates in
// major American cities reached record highs" was a paper about *housing*
// vacancy. There is no ranking fix for that — the right source was never in the
// candidate set, because nobody asked an institution that publishes vacancy
// statistics.
//
// Routing has to be per claim and has to be about meaning, not vocabulary. The
// labelled set contains a sleep-and-depression claim PubMed answers well and a
// "randomized controlled trial at a Chinese travel agency" claim that reads
// medical, is about remote work, and returns 1057 cardiology papers. A keyword
// list fails on exactly these: the deciding words — sleep, school, trial, crash
// — are not themselves medical.

export type ClaimDomain = 'biomedical' | 'statistical' | 'general' | 'scholarly'

const ANCHORS: Record<Exclude<ClaimDomain, 'scholarly'>, string[]> = {
  biomedical: [
    'a clinical study of human health, disease, medicine, or physiology',
    'research on sleep, nutrition, mental health, or the human body',
    'a medical trial measuring a health outcome in patients'
  ],
  statistical: [
    'an official statistic about an economy, population, or labour market',
    'a measured rate, percentage, or index published by a government agency',
    'national data on employment, prices, housing, trade, or development'
  ],
  general: [
    'a historical fact, date, or definition of a well-known thing',
    'a description of who someone was or what an organisation does',
    'general background knowledge found in an encyclopedia',
    // Biography, added 2026-08-19 from a real failure. The three anchors above
    // describe who a person WAS — an identity, a definition — and an essay
    // about a person is mostly claims about what they DID. Measured on the
    // owner's Audrey Hepburn draft: "She had largely contributed to the
    // resistance by participating in underground activities" routed
    // 'scholarly', and "She also volunteered in a hospital that was involved
    // with resistance activity" routed BIOMEDICAL — so PubMed was queried
    // about a WWII biography and returned clinical psychopharmacology papers,
    // which is most of what the owner was looking at when they said the
    // sources had "literally no correlation".
    'what a named person did during a particular period of their life',
    'a biographical detail about a specific individual, such as where they lived, worked, or served'
  ]
}

// The academic providers are the default, and everything else has to earn its
// place ahead of them by this much. Not zero: a claim that is genuinely about a
// study still scores on the statistical anchors, because studies report rates
// and percentages too.
//
// 0.05 rather than the 0.03 the binary router used, and the change is measured
// — see eval/scripts/measure-routing.mjs. Across the 13 labelled claims, 0.05
// strictly dominates 0.03: it corrects two misroutes and costs nothing.
//
//   "fully remote workers are less likely to be promoted"    0.040 -> scholarly
//   "randomized controlled trial at a Chinese travel agency" 0.046 -> scholarly
//
// Both are research findings that read like something else, and both are the
// exact failure the router exists to avoid. Every correctly-routed claim sits
// at 0.063 or above, so the gap between right and wrong answers is real rather
// than a knife edge. Still a threshold from thirteen claims — it should move
// again when the full eval can run.
const DOMAIN_MARGIN = 0.05

const ORDER: Exclude<ClaimDomain, 'scholarly'>[] = ['biomedical', 'statistical', 'general']

/**
 * Classifies a claim by what kind of source could actually settle it.
 *
 * Returns 'scholarly' — the safe default, meaning the academic providers only —
 * when embeddings are unavailable or when nothing wins clearly. That direction
 * is deliberate: the academic providers are free, unmetered, and the product's
 * core, so a machine that cannot run the router degrades to today's behaviour
 * rather than to a wider and noisier net.
 */
export async function classifyClaim(claimText: string, searchQuery: string): Promise<ClaimDomain> {
  const subject = `${claimText} ${searchQuery}`.trim()
  const flat = ORDER.flatMap((domain) => ANCHORS[domain])
  const vectors = await embedCached([...flat, subject])
  if (!vectors) return 'scholarly'

  const subjectVector = vectors[vectors.length - 1]
  const scores = vectors.slice(0, -1).map((anchor) => cosineSimilarity(anchor, subjectVector))

  // Max over a domain's anchors rather than a centroid: the domains are broad,
  // and one anchor matching strongly is the signal. Averaging lets two
  // unrelated anchors dilute a clear hit on the third.
  let offset = 0
  const byDomain = ORDER.map((domain) => {
    const size = ANCHORS[domain].length
    const best = Math.max(...scores.slice(offset, offset + size))
    offset += size
    return { domain, best }
  }).sort((a, b) => b.best - a.best)

  const [winner, runnerUp] = byDomain
  return winner.best - runnerUp.best > DOMAIN_MARGIN ? winner.domain : 'scholarly'
}

