import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { CritiqueGenerateResponse } from '@shared/ipc-contract'
import { generateCorrection } from '../services/ai/correction'
import { generateCritique } from '../services/ai/critique'
import { getEvidenceForClaim } from '../services/storage/claimEvidenceRepo'
import { getClaim, updateClaimCritique } from '../services/storage/claimsRepo'

const claimIdSchema = z.object({ claimId: z.string() })

export function registerCritiqueHandlers(): void {
  ipcMain.handle(IPC.CRITIQUE_GENERATE, async (_event, raw): Promise<CritiqueGenerateResponse> => {
    const { claimId } = claimIdSchema.parse(raw)
    const claim = getClaim(claimId)
    if (!claim) throw new Error('Claim not found')

    const evidence = getEvidenceForClaim(claimId)
    const result = await generateCritique(claim, evidence)
    updateClaimCritique(claimId, result.critique, result.verdict)

    // Only sources the local model flagged as contradicting, and only ones
    // that cleared the relevance bar to have been asked in the first place.
    // When there are none — the overwhelmingly common case — no relay call is
    // made and this costs nothing.
    const contradicting = evidence.filter((item) => item.stance === 'contradicts')
    const correction = await generateCorrection(claim.text, contradicting)

    return { ...result, correction: correction?.correction ?? null }
  })
}
