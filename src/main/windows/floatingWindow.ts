import { join } from 'path'
import { BrowserWindow, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getAppIconPath } from '../icon'

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

  floatingWindow = win
  return win
}

export function getFloatingWindow(): BrowserWindow | null {
  return floatingWindow
}

export function showFloatingWindowNearCursor(): void {
  const win = floatingWindow
  if (!win) return

  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea

  let x = cursor.x + 12
  let y = cursor.y + 12
  if (x + WIDTH > dx + dw) x = dx + dw - WIDTH - 12
  if (y + HEIGHT > dy + dh) y = dy + dh - HEIGHT - 12

  win.setPosition(Math.round(x), Math.round(y))
  win.show()
  win.focus()
}
