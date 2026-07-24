import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { HistoryClearResponse } from '@shared/ipc-contract'
import { clearAnalysisHistory, resetDatabase } from '../services/storage/db'

const clearSchema = z.object({ includeLibrary: z.boolean() })

export function registerHistoryHandlers(): void {
  ipcMain.handle(IPC.HISTORY_CLEAR, (_event, raw): HistoryClearResponse => {
    const { includeLibrary } = clearSchema.parse(raw)
    if (includeLibrary) {
      resetDatabase()
    } else {
      clearAnalysisHistory()
    }
    return { ok: true }
  })
}
