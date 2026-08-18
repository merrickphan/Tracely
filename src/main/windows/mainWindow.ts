import { join } from 'path'
import { BrowserWindow, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { FontSize } from '@shared/types'
import type { ResizeHandle } from '@shared/ipc-contract'
import {
  clampWindowBounds,
  LAYOUT_HEIGHT,
  LAYOUT_WIDTH,
  maximizedBounds,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_EDGE_MARGIN
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
const SIZE_KEY = 'mainWindowSize'
const POSITION_KEY = 'mainWindowPosition'

/**
 * The size the user last left the window at.
 *
 * A width and a height, because the window no longer has one degree of freedom
 * — see the note in shared/windowSize.ts. SCALE_KEY is still read, once, so an
 * install that has been remembering a scale opens at the size that scale meant
 * instead of snapping back to the default; nothing writes it any more.
 */
function savedSize(): { width: number; height: number } | null {
  const raw = getSetting(SIZE_KEY)
  const [w, h] = raw.split(',').map(Number)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h }
  }
  const legacy = Number(getSetting(SCALE_KEY))
  if (Number.isFinite(legacy) && legacy > 0) {
    return { width: Math.round(LAYOUT_WIDTH * legacy), height: Math.round(LAYOUT_HEIGHT * legacy) }
  }
  return null
}

function persistSize(width: number, height: number): void {
  setSetting(SIZE_KEY, `${Math.round(width)},${Math.round(height)}`)
}

/**
 * The font-size setting no longer touches the window, and that is the change.
 *
 * It used to resize it, because the two really were the same operation: a
 * `zoom` derived from the window's width meant "bigger text" and "bigger
 * window" were one control wearing two hats, and they had to be composed or
 * they fought. With the zoom back on the setting alone (renderer/lib/
 * appearance.ts) they are independent — larger text simply means less fits in
 * whatever window you have chosen, exactly as in any other application.
 *
 * Kept as an exported no-op rather than deleted: it is called from the settings
 * handler, and a signature change there is a bigger edit than this needs.
 */
export function applyMainWindowFontSize(_fontSize: FontSize): void {
  // Deliberately nothing.
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
  const workArea = screen.getPrimaryDisplay().workArea
  const { width, height } = clampWindowBounds(
    savedSize() ?? { width: LAYOUT_WIDTH, height: LAYOUT_HEIGHT },
    workArea
  )
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
    // Still no NATIVE maximize: with the aspect ratio locked it could only
    // letterbox the card inside a screen-shaped window. The title-bar button
    // does something different and better — see toggleMaximizeMainWindow.
    maximizable: false,
    // Minimizable now, because there is a button for it. It was off when the
    // window had no chrome at all and nothing could reach it.
    minimizable: true,
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


  // No aspect lock. It existed because the layout box had one shape and the
  // zoom absorbed the difference; with the UI no longer scaling, width and
  // height are independent and the window behaves like any other. No maximum
  // either — the work-area clamp in the resize path is the real bound, and a
  // fixed maximum would be wrong the moment a second monitor appeared.
  win.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

  // Remember where the user put it, and how big. Debounced because `resize`
  // fires continuously through a drag and `setSetting` writes the whole SQLite
  // database to disk on every call (see storage/db.ts persist) — one write per
  // frame of a resize would be the most expensive thing in the app.
  let saveTimer: NodeJS.Timeout | undefined
  const remember = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      const [w, h] = win.getSize()
      const [x, y] = win.getPosition()
      persistSize(w, h)
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

// -- manual resizing ---------------------------------------------------------
//
// The OS will not do this one. A frameless window normally still gets Windows'
// invisible resize border, but this window is also `transparent: true`, and a
// transparent frameless window does not receive the non-client hit-test that
// border depends on — measured by dragging every corner of a real build with
// `resizable: true` set and nothing catching. So the grips are drawn in the
// renderer (components/ResizeGrips.tsx) and the movement is applied here.
//
// All of the arithmetic is on this side on purpose. The renderer is inside a
// CSS `zoom` that this very drag is changing, so it cannot convert its own
// coordinates to screen pixels reliably; the window's real bounds only exist
// here. The renderer's whole contribution is a compass direction and a pointer
// delta.

interface ResizeDrag {
  handle: ResizeHandle
  /** The window as it was when the drag began. Every frame is computed from
   *  this, never from the current bounds — see WindowResizeMoveRequest on why
   *  accumulating per-frame deltas drifts at the clamps. */
  start: { x: number; y: number; width: number; height: number }
}

let drag: ResizeDrag | null = null

export function beginWindowResize(handle: ResizeHandle): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { x, y, width, height } = mainWindow.getBounds()
  drag = { handle, start: { x, y, width, height } }
}

/**
 * The size the pointer is asking for, before clamping.
 *
 * Width and height independently, which is the change: with the aspect ratio
 * unlocked there are two degrees of freedom and a vertical drag is a height
 * rather than a width to be converted through a ratio.
 *
 * The signs are what make each grip pull the way it looks like it should — an
 * east handle grows with a rightward drag, a west handle with a leftward one —
 * and a corner is simply both of its edges at once.
 */
function requestedSize(
  handle: ResizeHandle,
  start: ResizeDrag['start'],
  dx: number,
  dy: number
): { width: number; height: number } {
  const growsEast = handle === 'e' || handle === 'ne' || handle === 'se'
  const growsWest = handle === 'w' || handle === 'nw' || handle === 'sw'
  const growsSouth = handle === 's' || handle === 'se' || handle === 'sw'
  const growsNorth = handle === 'n' || handle === 'ne' || handle === 'nw'

  return {
    width: growsEast ? start.width + dx : growsWest ? start.width - dx : start.width,
    height: growsSouth ? start.height + dy : growsNorth ? start.height - dy : start.height
  }
}

export function updateWindowResize(dx: number, dy: number): void {
  if (!mainWindow || mainWindow.isDestroyed() || !drag) return
  const { handle, start } = drag

  // Still clamped to the DISPLAY. A window taller than the screen puts its own
  // resize grips under the taskbar, and this app has no title bar to drag it
  // back by — that bound survives the aspect ratio it was written alongside.
  //
  // The work area is re-read on every move rather than sampled at drag start:
  // dragging across a monitor boundary mid-resize is a real thing to do, and
  // `getDisplayMatching` is a cheap synchronous lookup.
  const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea
  const { width, height } = clampWindowBounds(requestedSize(handle, start, dx, dy), workArea)

  // The anchor is the opposite edge, held still. Without this every drag would
  // also move the window: growing from the top-left grip would push the card
  // down and right rather than up and left, which reads as the window running
  // away from the cursor.
  const holdsRight = handle === 'w' || handle === 'nw' || handle === 'sw'
  const holdsBottom = handle === 'n' || handle === 'nw' || handle === 'ne'

  mainWindow.setBounds({
    x: Math.round(holdsRight ? start.x + start.width - width : start.x),
    y: Math.round(holdsBottom ? start.y + start.height - height : start.y),
    width,
    height
  })
}


// -- window controls ---------------------------------------------------------

export function minimizeMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.minimize()
}

/**
 * The title bar's maximize button, which deliberately does not maximize.
 *
 * `win.maximize()` on a frameless transparent window is unreliable on Windows
 * and would also snap to the very edges, burying the resize grips this app has
 * instead of a title bar. So the button sets the work area less that margin,
 * and toggles back to wherever the user had it.
 *
 * The previous SIZE is remembered rather than recomputed, so restore returns to
 * what was actually dragged to and not to the default.
 */
let restoreSize: { width: number; height: number } | null = null

/** Whole pixels, so a round-trip through setBounds compares equal. */
function sameSize(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  return Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2
}

function applySize({ width, height }: { width: number; height: number }): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setSize(width, height)
  mainWindow.center()
  persistSize(width, height)
}

export function toggleMaximizeMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [width, height] = mainWindow.getSize()
  const current = { width, height }
  const target = maximizedBounds(screen.getDisplayMatching(mainWindow.getBounds()).workArea)

  if (restoreSize !== null && sameSize(current, target)) {
    const back = restoreSize
    restoreSize = null
    applySize(back)
    return
  }

  restoreSize = current
  applySize(target)
}

/** Whether the window is currently at its maximized size, for the button's
 *  icon. Derived rather than tracked: a drag can leave it at any size, and a
 *  flag would then disagree with what is on screen. */
export function isMainWindowMaximized(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const [width, height] = mainWindow.getSize()
  return sameSize(
    { width, height },
    maximizedBounds(screen.getDisplayMatching(mainWindow.getBounds()).workArea)
  )
}
