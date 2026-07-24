import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

export function getAppIconPath(): string {
  return is.dev ? join(app.getAppPath(), 'build', 'icon.png') : join(process.resourcesPath, 'icon.png')
}
