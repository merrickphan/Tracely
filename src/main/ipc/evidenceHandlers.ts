import { createHash } from 'crypto'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { EvidenceFindResponse, EvidenceGetForClaimResponse } from '@shared/ipc-contract'
import type { EvidenceItem } from '@shared/types'
import { findEvidence } from '../services/search/aggregator'
import type { NormalizedSourceResult } from '../services/search/types'
import { getCached, setCached } from '../services/storage/cacheRepo'
import { linkEvidence, getEvidenceForClaim } from '../services/storage/claimEvidenceRepo'
import { getClaim, updateClaimScore } from '../services/storage/claimsRepo'
import { upsertSource } from '../services/storage/sourcesRepo'

const claimIdSchema = z.object({ claimId: z.string() })

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24h — evidence for a given query rarely changes intraday

function cacheKey(query: string, claimText: string): string {
  // v2: score/ranking now also depends on claimText (see computeTextRelevance
  // in aggregator.ts), not just the search query — included here so two
  // claims that happen to produce the same searchQuery never share a cached
  // score/evidence order that was actually computed for different claim text.
  return createHash('sha256').update(`search:aggregate::v2::${query}::${claimText}`).digest('hex')
}

export function registerEvidenceHandlers(): void {
  ipcMain.handle(IPC.EVIDENCE_FIND, async (_event, raw): Promise<EvidenceFindResponse> => {
    const { claimId } = claimIdSchema.parse(raw)
    const claim = getClaim(claimId)
    if (!claim) throw new Error('Claim not found')

    const key = cacheKey(claim.searchQuery, claim.text)
    let result = getCached<{ evidence: NormalizedSourceResult[]; score: number; breakdown: EvidenceFindResponse['scoreBreakdown'] }>(
      key
    )
    if (!result) {
      result = await findEvidence(claim.searchQuery, claim.text)
      setCached(key, 'search:aggregate', result, CACHE_TTL_MS)
    }

    const evidence: EvidenceItem[] = result.evidence.map((item, index) => {
      const source = upsertSource({
        doi: item.doi,
        title: item.title,
        authors: item.authors,
        year: item.year,
        venue: item.venue,
        venueType: item.venueType,
        url: item.url,
        pdfUrl: item.pdfUrl,
        abstract: item.abstract,
        provider: item.provider,
        providerId: item.providerId,
        citationCount: item.citationCount,
        oaStatus: item.oaStatus,
        raw: item.raw
      })
      const relevanceScore = 1 - item.relevanceRank / Math.max(1, result!.evidence.length)
      linkEvidence(claimId, source.id, relevanceScore, index)
      return { source, relevanceScore, rank: index }
    })

    updateClaimScore(claimId, result.score, result.breakdown)

    return { evidence, strengthScore: result.score, scoreBreakdown: result.breakdown }
  })

  ipcMain.handle(IPC.EVIDENCE_GET_FOR_CLAIM, (_event, raw): EvidenceGetForClaimResponse => {
    const { claimId } = claimIdSchema.parse(raw)
    return { evidence: getEvidenceForClaim(claimId) }
  })
}
