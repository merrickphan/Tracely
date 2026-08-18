import { join } from 'path'
import { BrowserWindow, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { FontSize } from '@shared/types'
import type { ResizeHandle } from '@shared/ipc-contract'
import {
  clampDragScale,
  clampWindowScale,
  LAYOUT_WIDTH,
  MAIN_WINDOW_ASPECT,
  MAX_WINDOW_SCALE,
  maximizedScale,
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
 * The width the pointer is asking for, before clamping.
 *
 * Every handle resolves to a width because the aspect ratio is locked — there
 * is only one degree of freedom, so a vertical edge drag has to be converted
 * through the ratio rather than treated as an independent height.
 *
 * The signs are what make each grip pull the way it looks like it should: a
 * handle on the east side grows with a rightward drag, a west handle grows with
 * a leftward one.
 */
function requestedWidth(handle: ResizeHandle, start: ResizeDrag['start'], dx: number, dy: number): number {
  switch (handle) {
    case 'e':
    case 'ne':
    case 'se':
      return start.width + dx
    case 'w':
    case 'nw':
    case 'sw':
      return start.width - dx
    case 's':
      return (start.height + dy) * MAIN_WINDOW_ASPECT
    case 'n':
      return (start.height - dy) * MAIN_WINDOW_ASPECT
  }
}

export function updateWindowResize(dx: number, dy: number): void {
  if (!mainWindow || mainWindow.isDestroyed() || !drag) return
  const { handle, start } = drag

  // Clamped to the DISPLAY, not just to MAX_WINDOW_SCALE. The aspect ratio is
  // locked, so a size taken from the width alone can be far taller than the
  // screen — at 2.5 on a 2560x1392 work area the window is 1585px tall and the
  // bottom 193px of the app is simply below the edge of the monitor. See
  // clampDragScale.
  //
  // The work area is re-read on every move rather than sampled at drag start:
  // a window dragged across a monitor boundary mid-resize is a real thing to
  // do, and `getDisplayMatching` is a cheap synchronous lookup.
  const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea
  const scale = clampDragScale(requestedWidth(handle, start, dx, dy) / LAYOUT_WIDTH, workArea)
  const { width, height } = sizeForScale(scale)

  // The anchor is the opposite corner, held still. Without this every drag
  // would also move the window: growing from the top-left grip would push the
  // card down and right rather than up and left, which reads as the window
  // running away from the cursor.
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
 * `win.maximize()` fills the work area, and this window scales rather than
 * reflows — so on a 4K display that is 28px body text and a 62px heading. What
 * the button does instead is grow to the largest aspect-correct size that fits,
 * capped at MAX_COMFORTABLE_SCALE, and toggle back to wherever the user had it.
 *
 * The previous scale is remembered rather than recomputed, so restore returns
 * to the size that was actually dragged to, not to the default.
 */
let restoreScale: number | null = null

export function toggleMaximizeMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [currentWidth] = mainWindow.getSize()
  const current = currentWidth / LAYOUT_WIDTH
  const target = maximizedScale(screen.getDisplayMatching(mainWindow.getBounds()).workArea)

  // Within a hair of the maximized size counts as maximized, because the
  // window is sized in whole pixels and the scale will not round-trip exactly.
  if (restoreScale !== null && Math.abs(current - target) < 0.01) {
    const back = restoreScale
    restoreScale = null
    resizeToScale(back)
    return
  }

  restoreScale = current
  resizeToScale(target)
}

/** Whether the window is currently at its maximized size, for the button's
 *  icon. Derived rather than tracked: a drag can leave it at any size, and a
 *  flag would then disagree with what is on screen. */
export function isMainWindowMaximized(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const [width] = mainWindow.getSize()
  const target = maximizedScale(screen.getDisplayMatching(mainWindow.getBounds()).workArea)
  return Math.abs(width / LAYOUT_WIDTH - target) < 0.01
}
