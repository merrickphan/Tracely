import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { ScreenWatchGetStatusResponse, ScreenWatchSetEnabledResponse } from '@shared/ipc-contract'
import { getScreenWatchStatus, startScreenWatch, stopScreenWatch } from '../services/screenWatch/screenWatchService'

const setEnabledSchema = z.object({ enabled: z.boolean() })

export function registerScreenWatchHandlers(): void {
  ipcMain.handle(IPC.SCREENWATCH_SET_ENABLED, (_event, raw): ScreenWatchSetEnabledResponse => {
    const { enabled } = setEnabledSchema.parse(raw)
    if (enabled) startScreenWatch()
    else stopScreenWatch()
    return getScreenWatchStatus()
  })

  ipcMain.handle(IPC.SCREENWATCH_GET_STATUS, (): ScreenWatchGetStatusResponse => {
    return getScreenWatchStatus()
  })
}
