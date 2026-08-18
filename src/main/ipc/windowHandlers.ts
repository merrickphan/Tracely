import { app, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type {
  AppGetBuildInfoResponse,
  ShellOpenExternalResponse,
  WindowIsMaximizedResponse,
  WindowMinimizeResponse,
  WindowResizeMoveResponse,
  WindowToggleMaximizeResponse,
  WindowResizeStartResponse,
  WindowTargetResponse
} from '@shared/ipc-contract'
import { isPreviewBuild } from '../appIdentity'
import { getFloatingWindow, showFloatingWindow } from '../windows/floatingWindow'
import {
  beginWindowResize,
  getMainWindow,
  isMainWindowMaximized,
  minimizeMainWindow,
  showMainWindow,
  toggleMaximizeMainWindow,
  updateWindowResize
} from '../windows/mainWindow'

const targetSchema = z.object({ target: z.enum(['main', 'floating']) })
const urlSchema = z.object({ url: z.string().url() })
const resizeStartSchema = z.object({ handle: z.enum(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) })
// Bounded rather than a bare number. These arrive once per pointer frame from a
// window that is deliberately unprivileged, and a NaN or an Infinity would
// reach setBounds — which throws, on the main process, during a drag.
const resizeMoveSchema = z.object({
  dx: z.number().finite().min(-20000).max(20000),
  dy: z.number().finite().min(-20000).max(20000)
})

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

  ipcMain.handle(IPC.WINDOW_RESIZE_START, (_event, raw): WindowResizeStartResponse => {
    beginWindowResize(resizeStartSchema.parse(raw).handle)
    return { ok: true }
  })

  ipcMain.handle(IPC.WINDOW_RESIZE_MOVE, (_event, raw): WindowResizeMoveResponse => {
    const { dx, dy } = resizeMoveSchema.parse(raw)
    updateWindowResize(dx, dy)
    return { ok: true }
  })

  ipcMain.handle(IPC.WINDOW_MINIMIZE, (): WindowMinimizeResponse => {
    minimizeMainWindow()
    return { ok: true }
  })

  ipcMain.handle(IPC.WINDOW_TOGGLE_MAXIMIZE, (): WindowToggleMaximizeResponse => {
    toggleMaximizeMainWindow()
    return { maximized: isMainWindowMaximized() }
  })

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, (): WindowIsMaximizedResponse => ({
    maximized: isMainWindowMaximized()
  }))

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, raw): ShellOpenExternalResponse => {
    const { url } = urlSchema.parse(raw)
    shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle(IPC.APP_GET_BUILD_INFO, (): AppGetBuildInfoResponse => ({
    version: app.getVersion(),
    isPreview: isPreviewBuild()
  }))
}
