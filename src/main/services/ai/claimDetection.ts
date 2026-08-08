import { createHash } from 'crypto'
import type { ClaimType } from '@shared/types'
import { getCached, setCached } from '../storage/cacheRepo'
import { callRelay } from './client'
import { MAX_CLAIMS_PER_ANALYSIS, MIN_CLAIM_CONFIDENCE, truncateForClaimDetection } from './costGuard'
import { splitSentences, type SentenceSpan } from './sentenceSplit'

export interface DetectedClaim {
  text: string
  claimType: ClaimType
  confidence: number
  searchQuery: string
}

interface RelayClaim {
  sentenceIndices: number[]
  claimType: ClaimType
  confidence: number
  searchQuery: string
}

// Cache key only — sentence splitting/reconstruction still runs against the
// real, unnormalized text. Collapsing incidental whitespace differences
// (extra blank lines from a copy-paste, trailing spaces from an edit) means
// two pastes that are the same words hit the free cache instead of paying
// for a duplicate relay call that would return the same claims anyway.
function normalizeForCacheKey(text: string): string {
  return text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
}

function cacheKey(text: string): string {
  // v4: claims that reconstruct to the same sentence are now collapsed
  // (see dedupeByText) — bump so cached v3 results, which could contain the
  // same sentence twice, aren't served.
  return createHash('sha256').update(`ai:detectClaims::v4::${normalizeForCacheKey(text)}`).digest('hex')
}

function reconstructClaim(candidate: RelayClaim, sentences: SentenceSpan[], text: string): DetectedClaim | null {
  // The relay is an external boundary — validate its shape rather than trust
  // it, e.g. a mid-deploy race could briefly serve the previous response
  // format.
  if (!Array.isArray(candidate.sentenceIndices)) return null
  const indices = candidate.sentenceIndices.filter(
    (i) => Number.isInteger(i) && i >= 1 && i <= sentences.length
  )
  if (indices.length === 0) return null

  const start = Math.min(...indices.map((i) => sentences[i - 1].start))
  const end = Math.max(...indices.map((i) => sentences[i - 1].end))
  const claimText = text.slice(start, end).trim()
  if (!claimText) return null

  return {
    text: claimText,
    claimType: candidate.claimType,
    confidence: candidate.confidence,
    searchQuery: candidate.searchQuery
  }
}

// The model can return the same sentence index more than once — usually
// reading one sentence as two claims of different types, e.g. a Gutenberg
// sentence flagged once as "factual" and again as "statistic". Both
// reconstruct to identical text, so the user sees the same sentence listed
// twice, and each copy separately spends four provider searches plus a
// critique call. Keeping the first occurrence keeps the highest-confidence
// one, since the caller sorts before this runs.
function dedupeByText(claims: DetectedClaim[]): DetectedClaim[] {
  const seen = new Set<string>()
  return claims.filter((claim) => {
    const key = claim.text.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function detectClaims(rawText: string): Promise<DetectedClaim[]> {
  const text = truncateForClaimDetection(rawText.trim())
  const key = cacheKey(text)

  const cached = getCached<DetectedClaim[]>(key)
  if (cached) return cached

  const sentences = splitSentences(text)
  if (sentences.length === 0) return []

  // The model picks WHICH sentences (by number) state a claim, rather than
  // generating/quoting claim text itself — LLMs don't reliably comply with
  // "give me an exact verbatim quote" for claims that are natural paraphrases
  // of surrounding context (confirmed empirically: a real essay produced 5
  // claims where none were even a loosely-normalized substring of the
  // source). Selecting from a fixed numbered list can't be non-verbatim by
  // construction — the reconstructed text is always a real slice of `text`.
  const numberedText = sentences.map((s, i) => `[${i + 1}] ${s.text}`).join(' ')

  const { claims } = await callRelay<{ claims: RelayClaim[] }>('detect-claims', { text: numberedText })

  const detected = dedupeByText(
    (Array.isArray(claims) ? claims : [])
      .map((c) => reconstructClaim(c, sentences, text))
      .filter((c): c is DetectedClaim => c !== null && c.confidence >= MIN_CLAIM_CONFIDENCE)
      // Highest-confidence claims first, so the cap below keeps the claims
      // the model itself was surest about instead of whatever happened to
      // come first in the relay's response order — and so that dedupe keeps
      // the better-scored copy of a repeated sentence.
      .sort((a, b) => b.confidence - a.confidence)
  ).slice(0, MAX_CLAIMS_PER_ANALYSIS)

  setCached(key, 'ai:detectClaims', detected)
  return detected
}
