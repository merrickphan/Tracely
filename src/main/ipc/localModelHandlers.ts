import { ipcMain } from 'electron'
import { IPC, IPC_EVENTS } from '@shared/ipc-channels'
import type {
  LocalModelDownloadProgressEvent,
  LocalModelDownloadStartResponse,
  LocalModelStatusGetResponse
} from '@shared/ipc-contract'
import { downloadLocalModel, getLocalModelStatus } from '../services/ai/modelDownload'
import { getMainWindow } from '../windows/mainWindow'

export function registerLocalModelHandlers(): void {
  ipcMain.handle(IPC.LOCAL_MODEL_STATUS_GET, (): LocalModelStatusGetResponse => ({
    status: getLocalModelStatus()
  }))

  ipcMain.handle(IPC.LOCAL_MODEL_DOWNLOAD_START, async (): Promise<LocalModelDownloadStartResponse> => {
    try {
      await downloadLocalModel((downloadedBytes, totalBytes) => {
        const event: LocalModelDownloadProgressEvent = { downloadedBytes, totalBytes }
        getMainWindow()?.webContents.send(IPC_EVENTS.LOCAL_MODEL_DOWNLOAD_PROGRESS, event)
      })
    } catch {
      // Swallowed here on purpose — getLocalModelStatus() below already
      // reflects 'error' (set by downloadLocalModel's catch), which is what
      // the Settings UI actually renders from. The renderer treats the
      // resolved status, not a thrown IPC error, as the source of truth.
    }
    return { status: getLocalModelStatus() }
  })
}
