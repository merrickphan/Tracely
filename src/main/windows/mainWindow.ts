import { join } from 'path'
import { BrowserWindow, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { FontSize } from '@shared/types'
import {
  clampWindowScale,
  LAYOUT_WIDTH,
  MAIN_WINDOW_ASPECT,
  MAX_WINDOW_SCALE,
  MIN_WINDOW_SCALE,
  sizeForScale,
  WINDOW_FONT_SCALE
} from '@shared/windowSize'
import { windowTitle } from '../appIdentity'
import { getSetting, setSetting } from '../services/storage/settingsRepo'
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

/** Where the user last left the window. A plain key rather than an AppSettings
 *  field: this is window state, not a preference anyone sets, and it has no
 *  business in the Settings IPC contract. */
const SCALE_KEY = 'mainWindowScale'
const POSITION_KEY = 'mainWindowPosition'

function savedScale(): number | null {
  const raw = Number(getSetting(SCALE_KEY))
  return Number.isFinite(raw) && raw > 0 ? clampWindowScale(raw) : null
}

/**
 * The scale the window should open at.
 *
 * The user's dragged size wins over the font-size setting, because it is the
 * more recent and more deliberate statement of the same thing — and being
 * handed back a window you already resized is the whole point of remembering
 * it. Font size still moves it (see applyMainWindowFontSize), which is what
 * keeps that setting meaningful rather than dead.
 */
function startingScale(fontSize: FontSize): number {
  return savedScale() ?? WINDOW_FONT_SCALE[fontSize] ?? 1
}

/**
 * Resizes the window when the font-size setting changes.
 *
 * RELATIVE, not absolute. Snapping to `mainWindowSize(fontSize)` would throw
 * away a size the user had dragged to every time they touched the setting, and
 * the two controls would fight: one says "make everything bigger", the other
 * says "make the window bigger", and on this UI those are the same operation.
 * Multiplying by the ratio composes them instead, so a user on a large monitor
 * who scaled the window up and then chose `large` gets a proportionally larger
 * window rather than being yanked back to 1006px.
 */
export function applyMainWindowFontSize(fontSize: FontSize): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const previous = savedScale() ?? 1
  const previousFont = lastFontScale
  lastFontScale = WINDOW_FONT_SCALE[fontSize] ?? 1
  const next = clampWindowScale((previous * lastFontScale) / previousFont)
  if (Math.abs(next - previous) < 0.001) return
  resizeToScale(next)
}

function resizeToScale(scale: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { width, height } = sizeForScale(scale)
  // setSize before center: centring reads the size it is given.
  mainWindow.setSize(width, height)
  mainWindow.center()
  persistScale(scale)
}

/** The font scale the current window size already has baked into it. */
let lastFontScale = 1

function persistScale(scale: number): void {
  setSetting(SCALE_KEY, String(clampWindowScale(scale)))
}

/**
 * The remembered position, but only if it is still on a screen.
 *
 * A window restored onto a monitor that has since been unplugged is invisible
 * and — because this app has no taskbar minimize and no window menu — genuinely
 * unrecoverable without clearing settings. The test is that the window's own
 * rectangle overlaps some display's work area by a usable amount, not that its
 * origin is inside one: a window whose top-left sits just off the left edge is
 * fine and common, one that is entirely off is not.
 *
 * Returns null to mean "centre it", which is what the window did before this
 * existed.
 */
function savedPosition(width: number, height: number): { x: number; y: number } | null {
  const raw = getSetting(POSITION_KEY)
  const [x, y] = raw.split(',').map(Number)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null

  // Enough of the window to grab and drag back. The card is the drag handle and
  // its top edge is where a user reaches for, so this is deliberately generous.
  const VISIBLE_MARGIN = 120
  const onScreen = screen.getAllDisplays().some((display) => {
    const a = display.workArea
    return (
      x + width - VISIBLE_MARGIN > a.x &&
      x + VISIBLE_MARGIN < a.x + a.width &&
      y + height - VISIBLE_MARGIN > a.y &&
      // The TOP edge specifically: a window dragged below the bottom of the
      // screen leaves nothing draggable above the taskbar.
      y >= a.y - 8 &&
      y < a.y + a.height - VISIBLE_MARGIN
    )
  })
  return onScreen ? { x: Math.round(x), y: Math.round(y) } : null
}

export function createMainWindow(): BrowserWindow {
  // The Figma frame's own size plus a gutter, scaled by the font-size setting —
  // the app IS the frame, not a resizable OS window with the frame floating
  // inside it. No minimize/maximize either: the design has no such chrome, only
  // its own in-content close button (see HomeView/AnalyzeView).
  const fontSize = currentFontSize()
  lastFontScale = WINDOW_FONT_SCALE[fontSize] ?? 1
  const scale = startingScale(fontSize)
  const { width, height } = sizeForScale(scale)
  const position = savedPosition(width, height)
  const win = new BrowserWindow({
    width,
    height,
    ...(position ?? {}),
    // Without this, Electron falls back to OS default placement (often
    // hugging a screen edge rather than the middle) since no x/y is given.
    // Skipped when a remembered position is being restored.
    center: position === null,
    // Resizes by SCALING, not by reflowing — the layout is a fixed-coordinate
    // Figma transcription, so the aspect ratio is locked below and the renderer
    // derives its zoom from the width. See shared/windowSize.ts.
    resizable: true,
    // Still no maximize. With the aspect ratio locked, maximizing can only
    // letterbox the card inside a screen-shaped window, and the design has no
    // chrome to restore it from — the tray and the in-content close button are
    // the whole vocabulary.
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


  // Locked so the layout box keeps its one shape at every size. Set after
  // construction rather than passed in: `aspectRatio` is not a constructor
  // option, and on Windows it governs the frame rather than the content area —
  // which for a frameless window are the same rectangle.
  win.setAspectRatio(MAIN_WINDOW_ASPECT)
  win.setMinimumSize(...Object.values(sizeForScale(MIN_WINDOW_SCALE)) as [number, number])
  win.setMaximumSize(...Object.values(sizeForScale(MAX_WINDOW_SCALE)) as [number, number])

  // Remember where the user put it, and how big. Debounced because `resize`
  // fires continuously through a drag and `setSetting` writes the whole SQLite
  // database to disk on every call (see storage/db.ts persist) — one write per
  // frame of a resize would be the most expensive thing in the app.
  let saveTimer: NodeJS.Timeout | undefined
  const remember = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      const [w] = win.getSize()
      const [x, y] = win.getPosition()
      persistScale(w / LAYOUT_WIDTH)
      setSetting(POSITION_KEY, `${Math.round(x)},${Math.round(y)}`)
    }, 400)
  }
  win.on('resize', remember)
  win.on('move', remember)

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
