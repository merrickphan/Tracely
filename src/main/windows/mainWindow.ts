import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { windowTitle } from '../appIdentity'
import { getAppIconPath } from '../icon'
import { hideOverlay } from './overlayWindow'

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
    win.show()
  })

  // Screen Watch's transparent window deliberately sits at the screen-saver
  // always-on-top level. Hide it synchronously when main is shown/focused;
  // waiting for the 1.2s UIA poll leaves stale underlines/popovers over this
  // window and, if hover capture was active, blocks its controls too.
  win.on('show', hideOverlay)
  win.on('focus', hideOverlay)

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
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}
