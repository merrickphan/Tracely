import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

// Supabase's client asks for a Storage-like object (getItem/setItem/
// removeItem) to persist the refresh token between launches. There is no
// localStorage in the main process, so this backs it with a plain JSON file
// in userData, same pattern as config.ts.
function sessionPath(): string {
  return join(app.getPath('userData'), 'auth-session.json')
}

export const fileSessionStorage = {
  getItem(key: string): string | null {
    const path = sessionPath()
    if (!existsSync(path)) return null
    try {
      const all = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
      return all[key] ?? null
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    const path = sessionPath()
    const all = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>) : {}
    all[key] = value
    writeFileSync(path, JSON.stringify(all))
  },
  removeItem(key: string): void {
    const path = sessionPath()
    if (!existsSync(path)) return
    const all = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
    delete all[key]
    if (Object.keys(all).length === 0) {
      unlinkSync(path)
    } else {
      writeFileSync(path, JSON.stringify(all))
    }
  }
}
