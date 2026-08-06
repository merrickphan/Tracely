import { join } from 'path'
import { BrowserWindow, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IPC_EVENTS } from '@shared/ipc-channels'
import { getAppIconPath } from '../icon'

// Tracer gets its own BrowserWindow rather than living inside the Screen
// Watch overlay, for one hard reason: the overlay is created with
// `focusable: false` and `setIgnoreMouseEvents(true, { forward: true })` so
// it can never steal focus or clicks from the app being watched (see
// overlayWindow.ts). A window that can't take OS keyboard focus can't host
// a text input, and a tutor you can't type to is not a tutor. So the
// overlay stays exactly as click-through as it was, and Tracer is a normal
// focusable window that opens beside it.
//
// The cost of that choice is that focusing this window means Tracely itself
// is the foreground app, which makes the UIA poll report `skip: "self"` —
// screenWatchService.ts holds its claim state instead of resetting while
// this window is open. See setTracerHoldActive there.

let tracerWindow: BrowserWindow | null = null
// Which claim the window was opened against, if any — read once by the
// renderer via TRACER_GET_CONVERSATION rather than pushed, since it only
// matters at open time.
let pendingFocusedClaimId: string | null = null

const WIDTH = 420
const HEIGHT = 620
const EDGE_MARGIN = 24

export function createTracerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 360,
    minHeight: 420,
    show: false,
    frame: false,
    // Sits above the watched app like the overlay does — but unlike the
    // overlay it's focusable, so the composer can actually receive typing.
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    icon: getAppIconPath(),
    title: 'Tracer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // The overlay raises itself to the 'screen-saver' level (see
  // overlayWindow.ts), which is ABOVE the default always-on-top level — so
  // without matching it here, the click-through overlay would sit on top of
  // Tracer and swallow clicks aimed at the composer whenever the cursor
  // crossed one of its underlines. At equal levels the focused window wins,
  // which is the behavior we want.
  win.setAlwaysOnTop(true, 'screen-saver')

  // Hidden rather than destroyed, same as the floating window — reopening
  // Tracer should be instant and shouldn't re-run the whole renderer boot.
  win.on('close', (event) => {
    event.preventDefault()
    win.hide()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/tracer.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/tracer.html'))
  }

  tracerWindow = win
  win.on('closed', () => {
    tracerWindow = null
  })

  return win
}

export function getTracerWindow(): BrowserWindow | null {
  return tracerWindow
}

/**
 * Whether Tracer is currently on screen. screenWatchService.ts uses this to
 * decide whether a `skip: "self"` UIA result means "the user tabbed away,
 * drop everything" or "the user is talking to Tracer about what's already
 * flagged, hold it".
 */
export function isTracerWindowOpen(): boolean {
  return Boolean(tracerWindow && !tracerWindow.isDestroyed() && tracerWindow.isVisible())
}

/**
 * Whether Tracer currently has OS focus. hoverTracking.ts uses this to stop
 * hit-testing claim underlines while the user is typing to Tracer —
 * otherwise the overlay would keep toggling itself click-capturing over
 * text sitting behind the Tracer window. Focused, not merely visible: the
 * user can leave Tracer open and go back to writing, and hover popovers
 * should work again the moment they do.
 */
export function isTracerWindowFocused(): boolean {
  return Boolean(tracerWindow && !tracerWindow.isDestroyed() && tracerWindow.isFocused())
}

export function takeFocusedClaimId(): string | null {
  const id = pendingFocusedClaimId
  pendingFocusedClaimId = null
  return id
}

/**
 * Opens Tracer anchored to the bottom-right of the display the cursor is
 * on — the same corner the Screen Watch widget anchors to, so it appears
 * next to the thing that launched it, then nudged left so it doesn't cover
 * the widget itself.
 */
export function showTracerWindow(claimId?: string): void {
  const win = tracerWindow ?? createTracerWindow()
  pendingFocusedClaimId = claimId ?? null

  const cursor = screen.getCursorScreenPoint()
  const { x: dx, y: dy, width: dw, height: dh } = screen.getDisplayNearestPoint(cursor).workArea

  // Only reposition on a fresh open — if it's already up, leave it wherever
  // the user dragged it.
  if (!win.isVisible()) {
    const x = dx + dw - WIDTH - EDGE_MARGIN
    const y = dy + dh - HEIGHT - EDGE_MARGIN
    win.setPosition(Math.round(Math.max(dx, x)), Math.round(Math.max(dy, y)))
  }

  win.show()
  win.focus()

  // The window is only hidden between uses, never destroyed, so showing it
  // again fires no renderer mount — without this the second and every later
  // open would still be displaying the conversation and context from
  // whenever it was last dismissed. Sent after show() so the renderer's
  // reload lands against the state it's about to be looked at with.
  win.webContents.send(IPC_EVENTS.TRACER_OPENED)
}

export function hideTracerWindow(): void {
  if (tracerWindow && !tracerWindow.isDestroyed()) tracerWindow.hide()
}
