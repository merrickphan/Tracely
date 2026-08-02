import { join } from 'path'
import { BrowserWindow, type Rectangle } from 'electron'
import { is } from '@electron-toolkit/utils'
import { logScreenWatch } from '../services/screenWatch/debugLog'

let overlayWindow: BrowserWindow | null = null
let currentBoundsKey: string | null = null

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setIgnoreMouseEvents(true, { forward: true })
  win.setAlwaysOnTop(true, 'screen-saver')

  // Temporary diagnostic: the overlay's logo image has been reported not
  // rendering, with no clear cause found by static code review (no CSP, no
  // obvious asset-path issue). Forwarding the renderer's console into the
  // same screenwatch-debug.log lets that be diagnosed from real data
  // instead of another guess — see the explicit Image() load probe in
  // OverlayApp.tsx that logs success/failure for this exact asset.
  win.webContents.on('console-message', (_event, level, message) => {
    logScreenWatch(`[overlay console L${level}] ${message}`)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  win.on('closed', () => {
    overlayWindow = null
  })

  overlayWindow = win
  return win
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow
}

// Sized/positioned to the focused app's own window rect (logical/DIP
// pixels, already scale-converted by the caller) rather than the whole
// display — so underlines and the widget only ever draw over the app
// that's actually focused, not wherever else happens to share the monitor.
export function showOverlayOnWindow(bounds: Rectangle): BrowserWindow {
  const win = overlayWindow ?? createOverlayWindow()

  const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
  if (currentBoundsKey !== key) {
    win.setBounds(bounds)
    currentBoundsKey = key
  }

  if (!win.isVisible()) win.showInactive()
  return win
}

export function hideOverlay(): void {
  if (overlayWindow?.isVisible()) overlayWindow.hide()
}
