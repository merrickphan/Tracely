import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { FontSize } from '@shared/types'
import { mainWindowSize } from '@shared/windowSize'
import { windowTitle } from '../appIdentity'
import { getSetting } from '../services/storage/settingsRepo'
import { getAppIconPath } from '../icon'
import { hideFloatingWindow } from './floatingWindow'
import { hideOverlay } from './overlayWindow'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

export function setQuitting(value: boolean): void {
  isQuitting = value
}

/** Reads the persisted font size, tolerating an unset or junk value. */
function currentFontSize(): FontSize {
  const raw = getSetting('fontSize')
  return raw === 'small' || raw === 'large' ? raw : 'medium'
}

/**
 * Resizes the window to fit the current font size, keeping it centred.
 *
 * Font size is applied as CSS `zoom` on the document root, so at `large`
 * everything renders 12% bigger — which a fixed 870x606 window can only clip.
 * Called on boot and whenever the setting changes.
 */
export function applyMainWindowFontSize(fontSize: FontSize): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { width, height } = mainWindowSize(fontSize)
  const [current] = mainWindow.getSize()
  if (current === width) return
  // setSize before center: centring reads the size it is given, and a
  // resizable:false window still accepts a programmatic resize.
  mainWindow.setSize(width, height)
  mainWindow.center()
}

export function createMainWindow(): BrowserWindow {
  // The Figma frame's own size plus a gutter, scaled by the font-size setting —
  // the app IS the frame, not a resizable OS window with the frame floating
  // inside it. No minimize/maximize either: the design has no such chrome, only
  // its own in-content close button (see HomeView/AnalyzeView).
  const { width, height } = mainWindowSize(currentFontSize())
  const win = new BrowserWindow({
    width,
    height,
    // Without this, Electron falls back to OS default placement (often
    // hugging a screen edge rather than the middle) since no x/y is given.
    center: true,
    // Still not user-resizable; `applyMainWindowFontSize` resizes it
    // programmatically, which Electron allows regardless of this flag.
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
