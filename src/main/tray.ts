import { app, Menu, nativeImage, Tray } from 'electron'
import { getAppIconPath } from './icon'
import { showMainWindow } from './windows/mainWindow'

let tray: Tray | null = null

export function createTray(): Tray {
  const icon = nativeImage.createFromPath(getAppIconPath()).resize({ width: 32, height: 32 })
  tray = new Tray(icon)
  tray.setToolTip('Folio')

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Folio', click: () => showMainWindow() },
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
