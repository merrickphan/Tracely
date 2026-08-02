import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC, IPC_EVENTS } from '@shared/ipc-channels'
import type {
  FloatingClipboardCapturedEvent,
  ScreenWatchAnalyzeClaimResponse,
  ScreenWatchGetStatusResponse,
  ScreenWatchSetActivePopoverRectResponse,
  ScreenWatchSetEnabledResponse,
  ScreenWatchSetWidgetExpandedResponse,
  ScreenWatchWidgetDragEndResponse,
  ScreenWatchWidgetDragStartResponse
} from '@shared/ipc-contract'
import {
  getScreenWatchStatus,
  setActivePopoverRect,
  setWidgetDragEnd,
  setWidgetDragStart,
  setWidgetExpanded,
  startScreenWatch,
  stopScreenWatch
} from '../services/screenWatch/screenWatchService'
import { getFloatingWindow, showFloatingWindowNearCursor } from '../windows/floatingWindow'

const setEnabledSchema = z.object({ enabled: z.boolean() })
const analyzeClaimSchema = z.object({ text: z.string().min(1) })
const setWidgetExpandedSchema = z.object({ expanded: z.boolean() })
const widgetDragEndSchema = z.object({ x: z.number(), y: z.number() })
const rectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const setActivePopoverRectSchema = z.object({ claimId: z.string().nullable(), rect: rectSchema.nullable() })

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

  ipcMain.handle(IPC.SCREENWATCH_ANALYZE_CLAIM, (_event, raw): ScreenWatchAnalyzeClaimResponse => {
    const { text } = analyzeClaimSchema.parse(raw)
    // Reuses the same clipboard-capture flow the global hotkey uses — the
    // floating window already knows how to take a chunk of text and run a
    // full analysis on it, so there's no separate code path to maintain.
    showFloatingWindowNearCursor()
    const win = getFloatingWindow()
    const payload: FloatingClipboardCapturedEvent = { text }
    win?.webContents.send(IPC_EVENTS.FLOATING_CLIPBOARD_CAPTURED, payload)
    return { ok: true }
  })

  ipcMain.handle(IPC.SCREENWATCH_SET_WIDGET_EXPANDED, (_event, raw): ScreenWatchSetWidgetExpandedResponse => {
    const { expanded } = setWidgetExpandedSchema.parse(raw)
    setWidgetExpanded(expanded)
    return { ok: true }
  })

  ipcMain.handle(IPC.SCREENWATCH_WIDGET_DRAG_START, (): ScreenWatchWidgetDragStartResponse => {
    setWidgetDragStart()
    return { ok: true }
  })

  ipcMain.handle(IPC.SCREENWATCH_WIDGET_DRAG_END, (_event, raw): ScreenWatchWidgetDragEndResponse => {
    const { x, y } = widgetDragEndSchema.parse(raw)
    setWidgetDragEnd({ x, y })
    return { ok: true }
  })

  ipcMain.handle(IPC.SCREENWATCH_SET_ACTIVE_POPOVER_RECT, (_event, raw): ScreenWatchSetActivePopoverRectResponse => {
    const { claimId, rect } = setActivePopoverRectSchema.parse(raw)
    setActivePopoverRect(claimId, rect)
    return { ok: true }
  })
}
