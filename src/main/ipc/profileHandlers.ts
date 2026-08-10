import { ipcMain, app } from 'electron'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { ProfileGetResponse, ProfileSetResponse } from '@shared/ipc-contract'
import { getSetting, setSetting } from '../services/storage/settingsRepo'

const setSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  bio: z.string().optional(),
  phone: z.string().max(80).optional(),
  avatarDataUrl: z.string().nullable().optional()
})

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg);base64,(.+)$/

function avatarPath(ext: string): string {
  return join(app.getPath('userData'), `avatar.${ext}`)
}

function currentAvatarFile(): string | null {
  for (const ext of ['png', 'jpg', 'jpeg']) {
    const p = avatarPath(ext)
    if (existsSync(p)) return p
  }
  return null
}

function buildProfile(): ProfileGetResponse {
  const file = currentAvatarFile()
  return {
    firstName: getSetting('profileFirstName'),
    lastName: getSetting('profileLastName'),
    bio: getSetting('profileBio'),
    phone: getSetting('profilePhone'),
    // Cache-busted so the renderer's <img> actually reloads after a
    // re-upload replaces the same filename on disk.
    avatarUrl: file ? `file://${file.replace(/\\/g, '/')}?v=${Date.now()}` : null
  }
}

export function registerProfileHandlers(): void {
  ipcMain.handle(IPC.PROFILE_GET, (): ProfileGetResponse => buildProfile())

  ipcMain.handle(IPC.PROFILE_SET, (_event, raw): ProfileSetResponse => {
    const patch = setSchema.parse(raw)

    if (patch.firstName !== undefined) setSetting('profileFirstName', patch.firstName)
    if (patch.lastName !== undefined) setSetting('profileLastName', patch.lastName)
    if (patch.bio !== undefined) setSetting('profileBio', patch.bio)
    if (patch.phone !== undefined) setSetting('profilePhone', patch.phone)

    if (patch.avatarDataUrl === null) {
      for (const ext of ['png', 'jpg', 'jpeg']) {
        const p = avatarPath(ext)
        if (existsSync(p)) unlinkSync(p)
      }
    } else if (patch.avatarDataUrl !== undefined) {
      const match = DATA_URL_RE.exec(patch.avatarDataUrl)
      if (!match) {
        throw new Error('Avatar must be a PNG or JPEG image')
      }
      const [, format, base64] = match
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.length > MAX_AVATAR_BYTES) {
        throw new Error('Avatar image must be 2 MB or smaller')
      }
      // Clear any existing avatar file first so switching from .png to .jpg
      // (or vice versa) doesn't leave a stale file that currentAvatarFile()
      // would find first.
      for (const ext of ['png', 'jpg', 'jpeg']) {
        const p = avatarPath(ext)
        if (existsSync(p)) unlinkSync(p)
      }
      const ext = format === 'jpg' ? 'jpeg' : format
      writeFileSync(avatarPath(ext), bytes)
    }

    return buildProfile()
  })
}
