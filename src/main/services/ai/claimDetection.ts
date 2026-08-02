import { createHash } from 'crypto'
import type { ClaimType } from '@shared/types'
import { getSetting } from '../storage/settingsRepo'
import { getCached, setCached } from '../storage/cacheRepo'
import { callRelay } from './client'
import { MAX_CLAIMS_PER_ANALYSIS, truncateForClaimDetection } from './costGuard'
import { runLocalStructuredCompletion } from './localModel'
import { getLocalModelStatus, markLocalModelError } from './modelDownload'
import { CLAIM_DETECTION_JSON_SCHEMA, CLAIM_DETECTION_SYSTEM_PROMPT } from './prompts'
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

function cacheKey(text: string): string {
  // v3: results may now come from the local model instead of the relay —
  // bump so cached relay-only results (from before local inference existed)
  // aren't silently treated as equivalent.
  return createHash('sha256').update(`ai:detectClaims::v3::${text}`).digest('hex')
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

async function detectClaimsRaw(numberedText: string): Promise<RelayClaim[]> {
  const useLocal = getSetting('localModelEnabled') === 'true' && getLocalModelStatus() === 'ready'

  if (useLocal) {
    try {
      const result = await runLocalStructuredCompletion<{ claims: RelayClaim[] }>(
        CLAIM_DETECTION_SYSTEM_PROMPT,
        numberedText,
        CLAIM_DETECTION_JSON_SCHEMA
      )
      return Array.isArray(result.claims) ? result.claims : []
    } catch {
      // A local-model failure (e.g. the weights file was moved/corrupted
      // mid-session) shouldn't break claim detection outright — fall back
      // to the relay below, same as when local mode is off.
      markLocalModelError()
    }
  }

  const { claims } = await callRelay<{ claims: RelayClaim[] }>('detect-claims', { text: numberedText })
  return Array.isArray(claims) ? claims : []
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

  const claims = await detectClaimsRaw(numberedText)

  const detected = claims
    .map((c) => reconstructClaim(c, sentences, text))
    .filter((c): c is DetectedClaim => c !== null)
    .slice(0, MAX_CLAIMS_PER_ANALYSIS)

  setCached(key, 'ai:detectClaims', detected)
  return detected
}
