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

/**
 * Drops sessions belonging to a Supabase project this build does not talk to.
 *
 * supabase-js namespaces its storage key by project ref (`sb-<ref>-auth-token`),
 * so a session issued by a different project is never *used* — it is simply
 * never found. That is safe but confusing, and it happened for real: the
 * preview channel pointed at production until staging existed, so the first
 * staging preview opened onto a data directory holding a live-looking
 * production session it could not touch. The app was signed out; the file said
 * otherwise.
 *
 * Removing them keeps the file honest, and means an expired token for a project
 * we have abandoned does not sit on disk indefinitely.
 */
export function pruneForeignSessions(projectRef: string): void {
  const path = sessionPath()
  if (!existsSync(path) || !projectRef) return
  try {
    const all = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
    const foreign = Object.keys(all).filter((k) => k.startsWith('sb-') && !k.includes(projectRef))
    if (foreign.length === 0) return
    for (const key of foreign) delete all[key]
    if (Object.keys(all).length === 0) unlinkSync(path)
    else writeFileSync(path, JSON.stringify(all))
    console.log(`[auth] dropped ${foreign.length} session(s) from other Supabase project(s)`)
  } catch {
    // A corrupt or unreadable session file is the sign-in path's problem, not
    // this one's. Never let tidying up break startup.
  }
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
