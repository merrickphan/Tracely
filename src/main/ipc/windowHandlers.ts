import { ipcMain, shell } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { ShellOpenExternalResponse, WindowTargetResponse } from '@shared/ipc-contract'
import { getFloatingWindow, showFloatingWindow } from '../windows/floatingWindow'
import { getMainWindow, showMainWindow } from '../windows/mainWindow'

const targetSchema = z.object({ target: z.enum(['main', 'floating']) })
const urlSchema = z.object({ url: z.string().url() })

function resolveWindow(target: 'main' | 'floating') {
  return target === 'main' ? getMainWindow() : getFloatingWindow()
}

export function registerWindowHandlers(): void {
  ipcMain.handle(IPC.WINDOW_HIDE, (_event, raw): WindowTargetResponse => {
    const { target } = targetSchema.parse(raw)
    resolveWindow(target)?.hide()
    return { ok: true }
  })

  ipcMain.handle(IPC.WINDOW_SHOW, (_event, raw): WindowTargetResponse => {
    const { target } = targetSchema.parse(raw)
    if (target === 'main') {
      showMainWindow()
    } else {
      showFloatingWindow()
    }
    return { ok: true }
  })

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, raw): ShellOpenExternalResponse => {
    const { url } = urlSchema.parse(raw)
    shell.openExternal(url)
    return { ok: true }
  })
}
