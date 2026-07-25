import { app, Menu, nativeImage, Tray } from 'electron'
import { getAppIconPath } from './icon'
import { checkForUpdatesNow } from './updater'
import { showMainWindow } from './windows/mainWindow'

let tray: Tray | null = null

export function createTray(): Tray {
  const icon = nativeImage.createFromPath(getAppIconPath()).resize({ width: 32, height: 32 })
  tray = new Tray(icon)
  tray.setToolTip('Tracely')

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Tracely', click: () => showMainWindow() },
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
  )

  tray.on('click', () => showMainWindow())

  return tray
}
