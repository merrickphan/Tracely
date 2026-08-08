import { app, Menu, nativeImage, Tray } from 'electron'
import { appDisplayName } from './appIdentity'
import { getAppIconPath } from './icon'
import { isScreenWatchEnabled, startScreenWatch, stopScreenWatch } from './services/screenWatch/screenWatchService'
import { checkForUpdatesNow } from './updater'
import { showMainWindow } from './windows/mainWindow'

let tray: Tray | null = null

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show Tracely', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: isScreenWatchEnabled() ? 'Tracely: On (click to turn off)' : 'Tracely: Off (click to turn on)',
      click: () => {
        if (isScreenWatchEnabled()) stopScreenWatch()
        else startScreenWatch()
        tray?.setContextMenu(buildMenu())
      }
    },
    { type: 'separator' },
    { label: 'Check for Updates…', click: () => checkForUpdatesNow() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.exit(0)
      }
    }
  ])
}

export function createTray(): Tray {
  const icon = nativeImage.createFromPath(getAppIconPath()).resize({ width: 32, height: 32 })
  tray = new Tray(icon)
  tray.setToolTip(appDisplayName())
  tray.setContextMenu(buildMenu())
  tray.on('click', () => showMainWindow())

  return tray
}
