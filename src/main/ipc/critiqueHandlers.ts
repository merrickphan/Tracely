import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import { computeClaimSpans } from '@shared/claimSpans'
import { sentenceAround } from '@shared/inlineCitation'
import type { CritiqueGenerateResponse } from '@shared/ipc-contract'
import { getAnalysis } from '../services/storage/analysesRepo'
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
    // The analyzed document, so the reference check sees the whole sentence
    // rather than the claim span — which stops before a trailing "(Author,
    // Year)". Null when the analysis row is gone; generateCritique then falls
    // back to the claim text, which still carries a narrative citation.
    const analysis = getAnalysis(claim.analysisId)
    const span = analysis ? computeClaimSpans(analysis.sourceText, [claim])[0] : undefined
    const sentence =
      analysis && span ? sentenceAround(analysis.sourceText, span.start, span.end) : undefined
    // The whole document as well as the sentence: a "[3]" or "(Shoup 45)" is
    // resolved against the reference list at its end, which no amount of
    // widening around the claim would ever reach.
    const result = await generateCritique(claim, evidence, sentence, analysis?.sourceText)
    updateClaimCritique(
      claimId,
      result.critique,
      result.verdict,
      result.suggestedRevision,
      result.citationFix,
      result.citedWorkRead
    )

    // Only sources the local model flagged as contradicting, and only ones
    // that cleared the relevance bar to have been asked in the first place.
    // When there are none — the overwhelmingly common case — no relay call is
    // made and this costs nothing.
    const contradicting = evidence.filter((item) => item.stance === 'contradicts')
    const correction = await generateCorrection(claim.text, contradicting)

    return { ...result, correction: correction?.correction ?? null }
  })
}
