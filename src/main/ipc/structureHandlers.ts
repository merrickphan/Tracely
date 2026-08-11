import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { StructureAnalyzeResponse, StructureGetResponse } from '@shared/ipc-contract'
import { getClaimsByAnalysis } from '../services/storage/claimsRepo'
import { getDocument } from '../services/storage/documentsRepo'
import { setInAppOutlineContext } from '../services/structure/outlineContext'
import { getStoredOutline, saveOutline } from '../services/storage/structureRepo'
import {
  analyzeStructure,
  sourceHashFor,
  STRUCTURE_SCHEMA_VERSION
} from '../services/structure/analyzeStructure'
import { claimsWithoutEvidence, computeEvidenceCoverage } from '../services/structure/evidenceCoverage'

// Matches documentsHandlers' MAX_BODY_CHARS. The analysis is linear in the
// document, but the database is fully re-serialized on every write, so a
// runaway paste should be rejected at the same boundary the document itself is.
const MAX_TEXT_CHARS = 400_000

const analyzeSchema = z.object({
  documentId: z.string().min(1).nullish(),
  text: z.string().max(MAX_TEXT_CHARS),
  analysisId: z.string().min(1).nullish()
})

const getSchema = z.object({
  documentId: z.string().min(1),
  text: z.string().max(MAX_TEXT_CHARS)
})

export function registerStructureHandlers(): void {
  ipcMain.handle(IPC.STRUCTURE_ANALYZE, (_event, raw): StructureAnalyzeResponse => {
    const input = analyzeSchema.parse(raw)

    // Claims come from the store rather than over the wire so the renderer
    // cannot hand main a claim it never detected, and so the strength scores
    // and breakdowns coverage reads are the persisted ones.
    const claims = input.analysisId ? getClaimsByAnalysis(input.analysisId) : []

    const outline = analyzeStructure({
      documentId: input.documentId ?? null,
      analysisId: input.analysisId ?? null,
      text: input.text,
      claims,
      claimsWithoutEvidence: claimsWithoutEvidence(claims),
      coverage: computeEvidenceCoverage(claims),
      analyzedAt: new Date().toISOString()
    })

    saveOutline(outline)

    // So Tracer can answer about the draft the user is actually looking at.
    // Screen Watch reports `skip: "self"` while Tracely is foreground, so its
    // own context is always stale for the in-app editor — see outlineContext.
    setInAppOutlineContext({
      documentTitle: getDocument(input.documentId ?? '')?.title ?? 'your draft',
      documentText: input.text,
      outline
    })

    return { outline }
  })

  ipcMain.handle(IPC.STRUCTURE_GET, (_event, raw): StructureGetResponse => {
    const { documentId, text } = getSchema.parse(raw)
    const outline = getStoredOutline(documentId, STRUCTURE_SCHEMA_VERSION)

    // `stale` is reported rather than the outline being withheld: a previous
    // analysis of an edited draft is still worth showing, as long as the panel
    // says so. Silently returning null would read as "never analyzed".
    return { outline, stale: outline !== null && outline.sourceHash !== sourceHashFor(text) }
  })
}
