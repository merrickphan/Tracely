import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IPC_EVENTS } from '@shared/ipc-channels'
import { registerGlobalHotkey, registerScreenWatchHotkey, unregisterGlobalHotkey, unregisterScreenWatchHotkey } from './hotkey'
import { registerIpcHandlers } from './ipc'
import { handleOAuthRedirect } from './services/auth/client'
import { initScreenWatch, shutdownScreenWatch } from './services/screenWatch/screenWatchService'
import { initDb, persist } from './services/storage/db'
import { setAppPaths } from './services/storage/paths'
import { getSetting } from './services/storage/settingsRepo'
import { createTray } from './tray'
import { initAutoUpdater } from './updater'
import { createFloatingWindow } from './windows/floatingWindow'
import { createMainWindow, getMainWindow, setQuitting, showMainWindow } from './windows/mainWindow'
import { createTracerWindow } from './windows/tracerWindow'

// Google's OAuth consent screen opens in the user's real default browser
// (Electron can't embed it), then redirects to this custom scheme to hand
// control back to the app.
const OAUTH_PROTOCOL = 'tracely'

function handleOAuthUrl(url: string): void {
  if (!url.startsWith(`${OAUTH_PROTOCOL}://auth-callback`)) return
  showMainWindow()
  console.log('[auth] OAuth redirect received, exchanging code…')
  handleOAuthRedirect(url)
    .then(() => {
      console.log('[auth] OAuth redirect handled successfully')
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[auth] OAuth redirect failed:', message)
      // A failure here (e.g. an expired/already-used code, or a session
      // storage mismatch) previously vanished into the main-process log
      // with nothing shown in the app — LoginView listens for this so the
      // user gets a real, retryable error instead of silence.
      getMainWindow()?.webContents.send(IPC_EVENTS.AUTH_OAUTH_ERROR, message)
    })
}

if (!app.isDefaultProtocolClient(OAUTH_PROTOCOL)) {
  app.setAsDefaultProtocolClient(OAUTH_PROTOCOL)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // Windows/Linux: a protocol-URL launch relaunches the exe, which the
  // single-instance lock redirects into this 'second-instance' event on the
  // already-running instance, with the URL as one of the argv entries.
  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    const url = argv.find((arg) => arg.startsWith(`${OAUTH_PROTOCOL}://`))
    if (url) handleOAuthUrl(url)
  })

  // macOS delivers protocol launches via this event instead of argv.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleOAuthUrl(url)
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.tracely.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Must precede initDb and anything else that touches storage — every
    // write location now resolves through storage/paths.ts rather than
    // calling Electron directly, so that the same modules can run headless
    // under scripts/evaluate.mjs.
    setAppPaths({
      dataDir: app.getPath('userData'),
      appRoot: app.getAppPath(),
      resourcesDir: app.isPackaged ? process.resourcesPath : null
    })

    await initDb()

    createMainWindow()
    createFloatingWindow()
    // Created hidden at boot like the floating window, so the first "Ask
    // Tracer" click opens instantly instead of paying for a renderer boot.
    createTracerWindow()
    createTray()
    registerIpcHandlers()
    registerGlobalHotkey(getSetting('hotkeyAccelerator'))
    registerScreenWatchHotkey(getSetting('screenWatchHotkeyAccelerator'))
    initAutoUpdater()
    initScreenWatch()

    // Cold start via the protocol (app wasn't already running) delivers the
    // URL as a plain argv entry instead of 'second-instance'/'open-url'.
    const coldStartUrl = process.argv.find((arg) => arg.startsWith(`${OAUTH_PROTOCOL}://`))
    if (coldStartUrl) handleOAuthUrl(coldStartUrl)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    // Tracely keeps running in the tray so the global hotkey stays live even
    // if the main window is closed.
  })

  app.on('before-quit', () => {
    setQuitting(true)
    persist()
  })

  app.on('will-quit', () => {
    unregisterGlobalHotkey()
    unregisterScreenWatchHotkey()
    shutdownScreenWatch()
  })
}
