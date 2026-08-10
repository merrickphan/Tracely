import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { windowTitle } from '../appIdentity'
import { getAppIconPath } from '../icon'
import { hideFloatingWindow } from './floatingWindow'
import { hideOverlay } from './overlayWindow'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

export function setQuitting(value: boolean): void {
  isQuitting = value
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    // The signed-in dashboard uses a desktop sidebar/content layout. Start at
    // the reference canvas size while allowing the responsive renderer to
    // adapt down to a compact laptop-sized window.
    width: 1360,
    height: 860,
    minWidth: 760,
    minHeight: 600,
    resizable: true,
    maximizable: true,
    minimizable: true,
    show: false,
    frame: false,
    // The dashboard fills the whole window, so an opaque warm-white backing
    // avoids transparency artifacts while resizing or maximizing.
    transparent: false,
    backgroundColor: '#fbfaf7',
    hasShadow: true,
    title: windowTitle(),
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })


  // A page's <title> replaces the window title the moment it loads, so the
  // `title` option above was being silently overwritten by 'Tracely' from the
  // HTML — which is why a preview build still called itself Tracely in the
  // taskbar and Alt-Tab. Found by launching both builds and reading the real
  // window titles; the code looked correct.
  win.on('page-title-updated', (event) => event.preventDefault())
  win.on('ready-to-show', () => {
    hideOverlay()
    hideFloatingWindow()
    win.show()
  })

  // Screen Watch's transparent window deliberately sits at the screen-saver
  // always-on-top level. Hide it synchronously when main is shown/focused;
  // waiting for the 1.2s UIA poll leaves stale underlines/popovers over this
  // window and, if hover capture was active, blocks its controls too.
  const prepareMainWindow = (): void => {
    hideOverlay()
    hideFloatingWindow()
  }
  win.on('show', prepareMainWindow)
  win.on('focus', prepareMainWindow)

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
    hideOverlay()
    hideFloatingWindow()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}
