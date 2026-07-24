import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { CitationGenerateResponse, CitationListResponse } from '@shared/ipc-contract'
import { formatCitation } from '../services/citations'
import { getCitation, listCitationsForSource, saveCitation } from '../services/storage/citationsRepo'
import { getSourceById } from '../services/storage/sourcesRepo'

const generateSchema = z.object({
  sourceId: z.string(),
  style: z.enum(['APA', 'MLA', 'Chicago'])
})
const listSchema = z.object({ sourceId: z.string() })

export function registerCitationHandlers(): void {
  ipcMain.handle(IPC.CITATION_GENERATE, (_event, raw): CitationGenerateResponse => {
    const { sourceId, style } = generateSchema.parse(raw)

    const cached = getCitation(sourceId, style)
    if (cached) return { citation: cached.formattedText }

    const source = getSourceById(sourceId)
    if (!source) throw new Error('Source not found')

    const citation = formatCitation(source, style)
    saveCitation(sourceId, style, citation)
    return { citation }
  })

  ipcMain.handle(IPC.CITATION_LIST, (_event, raw): CitationListResponse => {
    const { sourceId } = listSchema.parse(raw)
    return { citations: listCitationsForSource(sourceId) }
  })
}
