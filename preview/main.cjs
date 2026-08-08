// Electron main process for the preview harness ONLY.
//
// This is not the Tracely app: no database, no IPC handlers, no tray, no
// global hotkey, no Screen Watch. It opens one ordinary window pointed at
// the harness page, which then loads the real renderer entries in iframes
// against a mocked IPC bridge. Nothing here is ever packaged — electron-
// builder ships `out/**/*` only, and this file is never built into out/.
const { app, BrowserWindow, shell } = require('electron')

const URL = process.env.TRACELY_PREVIEW_URL || 'http://localhost:5199/preview.html'

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    show: false,
    backgroundColor: '#131317',
    title: 'Tracely Preview',
    webPreferences: {
      // No preload: the mock bridge is installed inside each iframe by
      // preview/vite.config.mts, not from the main process. Keeping this
      // window's own context bare makes it obvious the harness has no
      // privileged access to anything.
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())
  win.loadURL(URL)

  // A previewed surface calling shell.openExternal is stubbed out in the
  // mock, but a plain <a target="_blank"> would still try to open a window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Unlike the real app (which lives in the tray so the global hotkey keeps
// working), the preview should just exit when you close it.
app.on('window-all-closed', () => app.quit())
