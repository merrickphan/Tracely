import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getAppIconPath } from '../icon'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

export function setQuitting(value: boolean): void {
  isQuitting = value
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    // Fixed to the Figma design's own frame size (870x606) — the app IS
    // the frame, not a resizable OS window with the frame floating inside
    // it. No minimize/maximize either: the design has no such chrome, only
    // its own in-content close button (see HomeView/AnalyzeView).
    width: 870,
    height: 606,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    frame: false,
    // Transparent so only the CSS-rounded card is visible — otherwise the
    // OS window itself stays a plain opaque rectangle behind/around the
    // rounded content and its square corners show through.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
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
