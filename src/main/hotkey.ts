import { clipboard, globalShortcut } from 'electron'
import { IPC_EVENTS } from '@shared/ipc-channels'
import type { FloatingClipboardCapturedEvent } from '@shared/ipc-contract'
import { getFloatingWindow, showFloatingWindowNearCursor } from './windows/floatingWindow'

let registeredAccelerator: string | null = null

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

export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+F'
