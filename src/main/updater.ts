import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater, NsisUpdater } from 'electron-updater'
import { getMainWindow } from './windows/mainWindow'
import { isPreviewBuild } from './appIdentity'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

let checking = false
let manualCheck = false
let initialized = false

/**
 * A message box the user can actually see.
 *
 * `dialog.showMessageBox(win, …)` is MODAL TO `win`. A hidden parent therefore
 * produces a hidden dialog: the promise is pending, the box exists, and nothing
 * appears on screen. The parentless overload has no such problem — it opens its
 * own top-level window.
 *
 * That distinction is the whole bug. Every dialog in this file answers an action
 * the user took from the TRAY, which is the one place they reach when the main
 * window is closed to the background — so the case where the window is hidden
 * is not an edge case here, it is the normal one. Found 2026-08-16: "Check for
 * Updates…" on a running Preview did nothing at all, and the reply had been
 * rendered modal to a window that was not on screen.
 *
 * Deliberately NOT fixed by calling showMainWindow(). The same helper serves the
 * automatic six-hourly check, and a background timer that yanks the main window
 * open to say "you're up to date" is worse than the silence it replaces.
 */
function showMessageBox(
  win: BrowserWindow | null,
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  const visible = win !== null && !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  return visible ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return // no update feed while running `npm run dev`
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  // Installer is unsigned, so skip the publisher-certificate check (there is none to verify).
  ;(autoUpdater as NsisUpdater).verifyUpdateCodeSignature = () => Promise.resolve(null)

  autoUpdater.on('update-available', (info) => {
    // `checking` was only ever reset on 'error' and 'update-not-available'.
    // Once an update WAS found, it stayed true forever and every later
    // Check for Updates... from the tray became a silent no-op, because
    // runCheck early-returns on it.
    checking = false
    const wasManual = manualCheck
    manualCheck = false

    // A preview build must never install a stable release.
    //
    // Tracely Preview is a separate application, not a channel of Tracely — its
    // own appId, install directory and database. electron-updater does not know
    // that. It treats `alpha` and `beta` as ranked channels of one app and will
    // offer a prerelease client any newer STABLE release, which is correct for
    // one app with two channels and wrong here: accepting it installs production
    // Tracely and leaves Preview untouched, so Preview never moves again.
    //
    // On 2026-08-14 that stranded a Preview on 0.3.83-beta.2 with
    // Tracely-Setup-0.3.84.exe queued in its updater cache, three builds behind
    // while APPROVALS rows said the work was "in Preview".
    //
    // `-c.publish.channel=preview` in package.json is what actually keeps them
    // apart. This asserts the same rule somewhere it cannot be undone by editing
    // one CLI flag in one npm script, because the failure is invisible: nothing
    // errors, the wrong app just installs.
    if (isPreviewBuild() && !info.version.includes('-')) {
      console.warn(`[updater] ignoring stable ${info.version} — this is a preview build`)
      if (wasManual) {
        showMessageBox(getMainWindow(), {
          type: 'info',
          title: 'No preview updates',
          message: `You're on the newest preview.`,
          detail: `Tracely ${info.version} is a production release, and Preview only installs preview builds.`
        })
      }
      return
    }

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
    checking = false
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
