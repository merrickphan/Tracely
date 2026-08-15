import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { AnalyzeDetectClaimsResponse, AnalyzeGetResultResponse } from '@shared/ipc-contract'
import { detectClaims } from '../services/ai/claimDetection'
import { createAnalysis, getAnalysis } from '../services/storage/analysesRepo'
import { getClaimsByAnalysis, insertClaims } from '../services/storage/claimsRepo'

const detectSchema = z.object({
  text: z.string().min(1),
  origin: z.enum(['main', 'floating'])
})

const getResultSchema = z.object({ analysisId: z.string() })

export function registerAnalyzeHandlers(): void {
  ipcMain.handle(IPC.ANALYZE_DETECT_CLAIMS, async (_event, raw): Promise<AnalyzeDetectClaimsResponse> => {
    const { text, origin } = detectSchema.parse(raw)

    const detected = await detectClaims(text)
    const analysis = createAnalysis(text, origin)
    const claims = insertClaims(
      analysis.id,
      detected.map((c) => ({
        text: c.text,
        claimType: c.claimType,
        confidence: c.confidence,
        searchQuery: c.searchQuery
      }))
    )

    return { analysisId: analysis.id, claims }
  })

  ipcMain.handle(IPC.ANALYZE_GET_RESULT, (_event, raw): AnalyzeGetResultResponse => {
    const { analysisId } = getResultSchema.parse(raw)
    const analysis = getAnalysis(analysisId)
    if (!analysis) throw new Error('Analysis not found')
    return { analysis, claims: getClaimsByAnalysis(analysisId) }
  })
}
