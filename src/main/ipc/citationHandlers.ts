import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { CitationGenerateResponse, CitationListResponse } from '@shared/ipc-contract'
import { formatCitation } from '../services/citations'
import { listCitationsForSource, saveCitation } from '../services/storage/citationsRepo'
import { getSourceById } from '../services/storage/sourcesRepo'

const generateSchema = z.object({
  sourceId: z.string(),
  style: z.enum(['APA', 'MLA', 'Chicago'])
})
const listSchema = z.object({ sourceId: z.string() })

export function registerCitationHandlers(): void {
  ipcMain.handle(IPC.CITATION_GENERATE, (_event, raw): CitationGenerateResponse => {
    const { sourceId, style } = generateSchema.parse(raw)

    // Formatted fresh every time, never read back from the table.
    //
    // This read the stored row first and returned it if present, which made
    // `citations` a cache of a pure function with no version on it. A source
    // cited once kept that text forever, so the formatter fix that stopped
    // putting DOIs on books reached no document that had already cited the
    // book. `formatCitation` is string concatenation — there is nothing here
    // worth the staleness.
    const source = getSourceById(sourceId)
    if (!source) throw new Error('Source not found')

    const citation = formatCitation(source, style)
    // Still written through, because the library lists these rows.
    saveCitation(sourceId, style, citation)
    return { citation }
  })

  ipcMain.handle(IPC.CITATION_LIST, (_event, raw): CitationListResponse => {
    const { sourceId } = listSchema.parse(raw)
    return { citations: listCitationsForSource(sourceId) }
  })
}
