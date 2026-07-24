import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type {
  LibraryGetResponse,
  LibraryListResponse,
  LibraryRemoveResponse,
  LibrarySaveResponse,
  LibraryUpdateResponse
} from '@shared/ipc-contract'
import { listCitationsForSource } from '../services/storage/citationsRepo'
import {
  getLibraryItem,
  listLibrary,
  removeLibraryItem,
  saveToLibrary,
  updateLibraryItem
} from '../services/storage/libraryRepo'

const saveSchema = z.object({
  sourceId: z.string(),
  claimId: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional()
})
const listSchema = z.object({ search: z.string().optional(), tag: z.string().optional() })
const idSchema = z.object({ id: z.string() })
const updateSchema = z.object({
  id: z.string(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional()
})

export function registerLibraryHandlers(): void {
  ipcMain.handle(IPC.LIBRARY_SAVE, (_event, raw): LibrarySaveResponse => {
    const input = saveSchema.parse(raw)
    return { item: saveToLibrary(input) }
  })

  ipcMain.handle(IPC.LIBRARY_LIST, (_event, raw): LibraryListResponse => {
    const { search, tag } = listSchema.parse(raw)
    return { items: listLibrary(search, tag) }
  })

  ipcMain.handle(IPC.LIBRARY_GET, (_event, raw): LibraryGetResponse => {
    const { id } = idSchema.parse(raw)
    const item = getLibraryItem(id)
    if (!item) throw new Error('Library item not found')
    return { item, citations: listCitationsForSource(item.sourceId) }
  })

  ipcMain.handle(IPC.LIBRARY_UPDATE, (_event, raw): LibraryUpdateResponse => {
    const { id, notes, tags } = updateSchema.parse(raw)
    return { item: updateLibraryItem(id, notes, tags) }
  })

  ipcMain.handle(IPC.LIBRARY_REMOVE, (_event, raw): LibraryRemoveResponse => {
    const { id } = idSchema.parse(raw)
    removeLibraryItem(id)
    return { ok: true }
  })
}
