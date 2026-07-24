import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { CritiqueGenerateResponse } from '@shared/ipc-contract'
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

    return result
  })
}
