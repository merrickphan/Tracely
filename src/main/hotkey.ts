import { clipboard, globalShortcut } from 'electron'
import { IPC_EVENTS } from '@shared/ipc-channels'
import type { FloatingClipboardCapturedEvent } from '@shared/ipc-contract'
import { isScreenWatchEnabled, startScreenWatch, stopScreenWatch } from './services/screenWatch/screenWatchService'
import { getFloatingWindow, showFloatingWindowNearCursor } from './windows/floatingWindow'

let registeredAccelerator: string | null = null
let registeredScreenWatchAccelerator: string | null = null

function onHotkeyPressed(): void {
  const text = clipboard.readText().trim()
  if (!text) return

  showFloatingWindowNearCursor()

  const win = getFloatingWindow()
  const payload: FloatingClipboardCapturedEvent = { text }
  win?.webContents.send(IPC_EVENTS.FLOATING_CLIPBOARD_CAPTURED, payload)
}

export function registerGlobalHotkey(accelerator: string): boolean {
  if (registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator)
    registeredAccelerator = null
  }

  const ok = globalShortcut.register(accelerator, onHotkeyPressed)
  if (ok) {
    registeredAccelerator = accelerator
  }
  return ok
}

export function unregisterGlobalHotkey(): void {
  if (registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator)
    registeredAccelerator = null
  }
}

function onScreenWatchHotkeyPressed(): void {
  if (isScreenWatchEnabled()) stopScreenWatch()
  else startScreenWatch()
}

export function registerScreenWatchHotkey(accelerator: string): boolean {
  if (registeredScreenWatchAccelerator) {
    globalShortcut.unregister(registeredScreenWatchAccelerator)
    registeredScreenWatchAccelerator = null
  }

  const ok = globalShortcut.register(accelerator, onScreenWatchHotkeyPressed)
  if (ok) {
    registeredScreenWatchAccelerator = accelerator
  }
  return ok
}

export function unregisterScreenWatchHotkey(): void {
  if (registeredScreenWatchAccelerator) {
    globalShortcut.unregister(registeredScreenWatchAccelerator)
    registeredScreenWatchAccelerator = null
  }
}

export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+F'
