import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IPC_EVENTS } from '@shared/ipc-channels'
import type { WindowMaximizeChangedEvent } from '@shared/ipc-contract'
import { getAppIconPath } from '../icon'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

export function setQuitting(value: boolean): void {
  isQuitting = value
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    // Custom-drawn title bar (see App.tsx's app-header) instead of the OS
    // chrome, so window controls can match the rest of the UI rather than
    // standing out as a mismatched native element.
    frame: false,
    title: 'Tracely',
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('maximize', () => {
    const payload: WindowMaximizeChangedEvent = { maximized: true }
    win.webContents.send(IPC_EVENTS.WINDOW_MAXIMIZE_CHANGED, payload)
  })
  win.on('unmaximize', () => {
    const payload: WindowMaximizeChangedEvent = { maximized: false }
    win.webContents.send(IPC_EVENTS.WINDOW_MAXIMIZE_CHANGED, payload)
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = win
  win.on('closed', () => {
    mainWindow = null
  })

  return win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function showMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}
