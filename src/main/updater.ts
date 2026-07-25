import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater, NsisUpdater } from 'electron-updater'
import { getMainWindow } from './windows/mainWindow'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

let checking = false
let manualCheck = false
let initialized = false

function showMessageBox(
  win: BrowserWindow | null,
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return // no update feed while running `npm run dev`
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  // Installer is unsigned, so skip the publisher-certificate check (there is none to verify).
  ;(autoUpdater as NsisUpdater).verifyUpdateCodeSignature = () => Promise.resolve(null)

  autoUpdater.on('update-available', (info) => {
    manualCheck = false
    const win = getMainWindow()
    showMessageBox(win, {
      type: 'info',
      title: 'Update available',
      message: `Tracely ${info.version} is available (you have ${app.getVersion()}).`,
      detail: 'Download it now? Tracely will restart to install once it finishes downloading.',
      buttons: ['Download', 'Not now'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate()
      }
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const win = getMainWindow()
    showMessageBox(win, {
      type: 'info',
      title: 'Update ready',
      message: `Tracely ${info.version} has been downloaded.`,
      detail: 'Restart now to install it?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err)
    if (manualCheck) {
      showMessageBox(getMainWindow(), {
        type: 'error',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail: err.message
      })
    }
    checking = false
    manualCheck = false
  })

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      showMessageBox(getMainWindow(), {
        type: 'info',
        title: 'No updates',
        message: `You're up to date.`,
        detail: `Tracely ${app.getVersion()} is the latest version.`
      })
    }
    checking = false
    manualCheck = false
  })

  runCheck(false)
  setInterval(() => runCheck(false), CHECK_INTERVAL_MS)
}

export function checkForUpdatesNow(): void {
  if (!app.isPackaged) {
    showMessageBox(getMainWindow(), {
      type: 'info',
      title: 'Not available in dev mode',
      message: 'Update checks only run in the installed app, not `npm run dev`.'
    })
    return
  }
  runCheck(true)
}

function runCheck(manual: boolean): void {
  if (checking) return
  checking = true
  manualCheck = manual
  autoUpdater.checkForUpdates().catch(() => {
    // handled by the 'error' event
  })
}
