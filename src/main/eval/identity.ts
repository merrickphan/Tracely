// Signs the eval harness in as a real Tracely user.
//
// The relay bills and rate-limits per account and refuses any call it cannot
// attribute, so the harness needs a genuine Supabase access token like the app
// does. It cannot get one the way the app does: scripts/evaluate.mjs runs this
// on plain node, and services/auth/client reaches Electron for the userData
// path, which would put the Electron binary shim in the eval bundle.
//
// So it borrows the session the desktop app already wrote. Nothing new to
// configure and no second set of credentials to keep somewhere: sign in to
// Tracely once, and the eval authenticates as you. The refresh token in that
// file is exchanged for a fresh access token by supabase-js, exactly as the
// app does, so a stale file still works.

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

declare const __SUPABASE_URL__: string
declare const __SUPABASE_ANON_KEY__: string

// Mirrors Electron's app.getPath('userData'), which is
// %APPDATA%\<productName> on Windows and Application Support on macOS. Only
// these two matter — nobody runs the eval anywhere else.
function userDataDir(appName: string): string | null {
  if (process.platform === 'win32') {
    return process.env.APPDATA ? join(process.env.APPDATA, appName) : null
  }
  if (process.platform === 'darwin') {
    return process.env.HOME ? join(process.env.HOME, 'Library', 'Application Support', appName) : null
  }
  return process.env.HOME ? join(process.env.HOME, '.config', appName) : null
}

// The stable build first, then the preview one — either is a real signed-in
// account, and a machine with only the preview installed should still work.
function sessionFile(): string | null {
  for (const name of ['Tracely', 'Tracely-preview']) {
    const dir = userDataDir(name)
    if (!dir) continue
    const path = join(dir, 'auth-session.json')
    if (existsSync(path)) return path
  }
  return null
}

/**
 * Returns a provider suitable for setAccessTokenProvider, or null when there
 * is no signed-in session to borrow — the caller decides how loudly to
 * complain, because a retrieval-only run does not need one.
 */
export function appSessionTokenProvider(): (() => Promise<string | null>) | null {
  if (!__SUPABASE_URL__ || !__SUPABASE_ANON_KEY__) return null
  const path = sessionFile()
  if (!path) return null

  // Reads and writes the same JSON blob shape services/auth/sessionStore.ts
  // uses, so a refresh performed here is picked up by the app on next launch
  // rather than silently invalidating the session it is holding.
  const storage = {
    getItem(key: string): string | null {
      try {
        return (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>)[key] ?? null
      } catch {
        return null
      }
    },
    setItem(key: string, value: string): void {
      let all: Record<string, string> = {}
      try {
        all = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
      } catch {
        /* corrupt or missing — start fresh */
      }
      all[key] = value
      writeFileSync(path, JSON.stringify(all))
    },
    removeItem(): void {
      // Deliberately inert. The eval must never sign the user out of their
      // own app as a side effect of measuring retrieval quality.
    }
  }

  const client = createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__, {
    auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
  })

  return async () => {
    const { data } = await client.auth.getSession()
    return data.session?.access_token ?? null
  }
}

export function noSessionMessage(): string {
  return [
    'No signed-in Tracely session found. Live relay calls (claim detection,',
    'critique) will come back 401 — launch Tracely, sign in once, then re-run.',
    'Replaying a recorded cassette is unaffected: it never reaches the network,',
    'so it never needs a token.'
  ].join('\n')
}
