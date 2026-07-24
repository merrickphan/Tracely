import { createHash } from 'crypto'
import type { ClaimType } from '@shared/types'
import { getCached, setCached } from '../storage/cacheRepo'
import { callRelay } from './client'
import { MAX_CLAIMS_PER_ANALYSIS, truncateForClaimDetection } from './costGuard'

export interface DetectedClaim {
  text: string
  claimType: ClaimType
  confidence: number
  searchQuery: string
}

function cacheKey(text: string): string {
  return createHash('sha256').update(`ai:detectClaims::v1::${text}`).digest('hex')
}

export async function detectClaims(rawText: string): Promise<DetectedClaim[]> {
  const text = truncateForClaimDetection(rawText.trim())
  const key = cacheKey(text)

  const cached = getCached<DetectedClaim[]>(key)
  if (cached) return cached

  const { claims } = await callRelay<{ claims: DetectedClaim[] }>('detect-claims', { text })
  const trimmed = claims.slice(0, MAX_CLAIMS_PER_ANALYSIS)

  setCached(key, 'ai:detectClaims', trimmed)
  return trimmed
}
