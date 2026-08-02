import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IPC_EVENTS } from '@shared/ipc-channels'
import type { LocalModelDownloadProgressEvent } from '@shared/ipc-contract'
import { getMainWindow } from '../../windows/mainWindow'

// MIT-licensed, strong instruction-following for its size, small enough for
// usable CPU-only inference (a 7B+ model would make the Live tab's
// underline-as-you-type feel sluggish on machines without a GPU). There's no
// official `microsoft/Phi-4-mini-instruct-GGUF` repo on Hugging Face (that
// URI 401s — HF's generic response for a nonexistent/inaccessible repo);
// bartowski's community quantization is the one that actually resolves —
// verified directly against node-llama-cpp's downloader before using it here.
const MODEL_URI = 'hf:bartowski/microsoft_Phi-4-mini-instruct-GGUF:Q4_K_M'
const MODEL_FILE_NAME = 'phi-4-mini-instruct-q4_k_m.gguf'

export type LocalModelStatus = 'not-downloaded' | 'downloading' | 'ready' | 'error'

let currentStatus: LocalModelStatus = 'not-downloaded'
let downloadPromise: Promise<void> | null = null

function getModelsDir(): string {
  // Dev and packaged builds must not share a directory: a dev-mode download
  // shouldn't silently satisfy a packaged install's "is it ready" check, or
  // vice versa, since the two can run different node-llama-cpp versions.
  return is.dev
    ? join(app.getAppPath(), '.local-models')
    : join(app.getPath('userData'), 'models')
}

export function getModelFilePath(): string {
  return join(getModelsDir(), MODEL_FILE_NAME)
}

export function getLocalModelStatus(): LocalModelStatus {
  return currentStatus
}

export function markLocalModelError(): void {
  currentStatus = 'error'
}

export async function downloadLocalModel(
  onProgress: (downloadedBytes: number, totalBytes: number) => void
): Promise<void> {
  if (downloadPromise) return downloadPromise
  if (currentStatus === 'ready') return

  currentStatus = 'downloading'
  downloadPromise = (async () => {
    try {
      const { createModelDownloader } = await import('node-llama-cpp')
      const downloader = await createModelDownloader({
        modelUri: MODEL_URI,
        dirPath: getModelsDir(),
        fileName: MODEL_FILE_NAME,
        onProgress: (status) => onProgress(status.downloadedSize, status.totalSize)
      })
      await downloader.download()
      currentStatus = 'ready'
    } catch (err) {
      currentStatus = 'error'
      // Without this, a failed download only ever surfaced as "Download
      // failed. Try again." in the UI with zero diagnostic info anywhere —
      // exactly what happened when MODEL_URI pointed at a repo that 401'd.
      console.error('[localModel] download failed:', err)
      throw err
    } finally {
      downloadPromise = null
    }
  })()

  return downloadPromise
}

// Called once at boot so a model downloaded in a previous session is
// recognized as ready without the user re-triggering a download.
export async function checkExistingLocalModel(): Promise<void> {
  try {
    const { existsSync } = await import('fs')
    if (existsSync(getModelFilePath())) {
      currentStatus = 'ready'
    }
  } catch {
    // Leave status as 'not-downloaded' — a failed existence check isn't an
    // error state, it just means the user needs to (re)download.
  }
}

// Fire-and-forget: the model download happens automatically as part of
// install/update rather than requiring the user to find a button in
// Settings — Settings still shows live progress (and a retry option on
// error), it just never has to be the thing that starts it. Must be called
// after the main window exists, since progress events need somewhere to go.
export function autoStartLocalModelDownload(): void {
  if (currentStatus !== 'not-downloaded') return
  downloadLocalModel((downloadedBytes, totalBytes) => {
    const event: LocalModelDownloadProgressEvent = { downloadedBytes, totalBytes }
    getMainWindow()?.webContents.send(IPC_EVENTS.LOCAL_MODEL_DOWNLOAD_PROGRESS, event)
  }).catch(() => {
    // Already logged inside downloadLocalModel; nothing else to do with a
    // background auto-download failure beyond leaving status as 'error' for
    // the Settings UI's retry button to pick up.
  })
}
