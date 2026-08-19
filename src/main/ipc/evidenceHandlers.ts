import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { EvidenceFindResponse, EvidenceGetForClaimResponse } from '@shared/ipc-contract'
import type { EvidenceItem } from '@shared/types'
import { findEvidenceCached } from '../services/search/cachedEvidence'
import {
  clearEvidenceForClaim,
  getEvidenceForClaim,
  linkEvidence
} from '../services/storage/claimEvidenceRepo'
import { getClaim, updateClaimScore } from '../services/storage/claimsRepo'
import { transaction } from '../services/storage/db'
import { upsertSource } from '../services/storage/sourcesRepo'

const claimIdSchema = z.object({ claimId: z.string() })

export function registerEvidenceHandlers(): void {
  ipcMain.handle(IPC.EVIDENCE_FIND, async (_event, raw): Promise<EvidenceFindResponse> => {
    const { claimId } = claimIdSchema.parse(raw)
    const claim = getClaim(claimId)
    if (!claim) throw new Error('Claim not found')

    const result = await findEvidenceCached(claim.searchQuery, claim.text)

    // One disk write for the whole set instead of one per statement — this
    // loop plus the score update was ~21 full-database serializations, each
    // proportional to total database size, on the main thread.
    const evidence: EvidenceItem[] = transaction(() => {
      // Replace, never merge. linkEvidence upserts per (claim, source), so
      // without this a search returning five sources leaves a previous
      // search's other eleven linked — and the picker reads stored rows.
      clearEvidenceForClaim(claimId)
      const items = result.evidence.map((item, index) => {
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
        // The aggregator's own claim-coverage score, not a re-derivation
        // from provider rank. The old `1 - rank/length` disagreed with the
        // order results were actually sorted in, and with the threshold
        // critique.ts filters evidence on.
        const relevanceScore = item.textRelevance
        const stance = item.stance?.stance ?? null
        const stanceConfidence = item.stance?.confidence ?? null
        // Persisted with the evidence because the critique and correction
        // steps read evidence back out of the database and would otherwise
        // have no way to know which sources disagree.
        linkEvidence(claimId, source.id, relevanceScore, index, stance, stanceConfidence)
        return { source, relevanceScore, rank: index, stance, stanceConfidence }
      })
      updateClaimScore(claimId, result.score, result.breakdown)
      return items
    })

    return { evidence, strengthScore: result.score, scoreBreakdown: result.breakdown }
  })

  ipcMain.handle(IPC.EVIDENCE_GET_FOR_CLAIM, (_event, raw): EvidenceGetForClaimResponse => {
    const { claimId } = claimIdSchema.parse(raw)
    return { evidence: getEvidenceForClaim(claimId) }
  })
}
