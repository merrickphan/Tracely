import { join } from 'path'
import { BrowserWindow, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getAppIconPath } from '../icon'
import { hideOverlay } from './overlayWindow'

let floatingWindow: BrowserWindow | null = null

const WIDTH = 380
const HEIGHT = 480

export function createFloatingWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 320,
    minHeight: 360,
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/floating.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/floating.html'))
  }

  win.on('close', (event) => {
    event.preventDefault()
    win.hide()
  })
  win.on('show', hideOverlay)
  win.on('focus', hideOverlay)

  floatingWindow = win
  return win
}

export function getFloatingWindow(): BrowserWindow | null {
  return floatingWindow
}

export function hideFloatingWindow(): void {
  if (floatingWindow?.isVisible()) floatingWindow.hide()
}

export function showFloatingWindow(): void {
  if (!floatingWindow) return
  // Screen Watch sits at the screen-saver level, above this always-on-top
  // popup. Release its native mouse capture before showing a focusable Tracely
  // surface so transparent overlay pixels cannot swallow the popup's clicks.
  hideOverlay()
  floatingWindow.show()
  floatingWindow.focus()
}

export function showFloatingWindowNearCursor(): void {
  const win = floatingWindow
  if (!win) return

  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea
  const [width, height] = win.getSize()

  let x = cursor.x + 12
  let y = cursor.y + 12
  if (x + width > dx + dw) x = dx + dw - width - 12
  if (y + height > dy + dh) y = dy + dh - height - 12

  win.setPosition(Math.round(x), Math.round(y))
  showFloatingWindow()
}
