import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerGlobalHotkey, unregisterGlobalHotkey } from './hotkey'
import { registerIpcHandlers } from './ipc'
import { initDb, persist } from './services/storage/db'
import { getSetting } from './services/storage/settingsRepo'
import { createTray } from './tray'
import { createFloatingWindow } from './windows/floatingWindow'
import { createMainWindow, setQuitting, showMainWindow } from './windows/mainWindow'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.tracely.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    await initDb()

    createMainWindow()
    createFloatingWindow()
    createTray()
    registerIpcHandlers()
    registerGlobalHotkey(getSetting('hotkeyAccelerator'))

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
  })
}
