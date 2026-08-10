import { ipcMain, clipboard } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { ClipboardWriteResponse } from '@shared/ipc-contract'

const writeSchema = z.object({ text: z.string() })

export function registerClipboardHandlers(): void {
  ipcMain.handle(IPC.CLIPBOARD_WRITE, (_event, raw): ClipboardWriteResponse => {
    const { text } = writeSchema.parse(raw)
    clipboard.writeText(text)
    return { ok: true }
  })
}
