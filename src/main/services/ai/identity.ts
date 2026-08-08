// Who the relay should bill this call to.
//
// A registry rather than a direct import of services/auth/client, because the
// two callers of the AI layer resolve identity in genuinely different ways and
// only one of them can load Electron:
//
//   the app  — Electron, a signed-in Supabase session in userData, tokens
//              refreshed in the background by supabase-js.
//   the eval — plain Node (scripts/evaluate.mjs esbuilds the harness and runs
//              it outside Electron), so `import { app } from 'electron'` would
//              bundle the binary-path shim and blow up at runtime.
//
// services/auth/client imports Electron transitively. Importing it from here
// would put Electron in the eval bundle and break `npm run evaluate` — the
// primary quality gate — to fix an auth problem. Hence the indirection.

let provider: (() => Promise<string | null>) | null = null

/**
 * Called once at startup by whoever knows how to get a token — main/index.ts
 * in the app, the harness in the eval.
 */
export function setAccessTokenProvider(fn: () => Promise<string | null>): void {
  provider = fn
}

/**
 * Null when there is no signed-in session. The caller then sends no
 * Authorization header and the relay answers 401 with its own wording.
 *
 * Deliberately not a throw. Throwing here would run before fetch, which means
 * before scripts/eval-http.mjs's recorder can serve a cassette — and would
 * make replaying a previously recorded eval run, which touches no network and
 * costs nothing, require a live session anyway. Being signed out is a state
 * the relay is already equipped to describe; it is not this layer's job to
 * pre-empt it.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!provider) {
    // A missing provider is a programmer error, not a user state: some entry
    // point started making AI calls without registering identity. Distinct
    // from "signed out" on purpose, and loud, because it would otherwise
    // surface as an inexplicable 401.
    throw new Error('No access-token provider registered — this entry point cannot make AI calls.')
  }
  return await provider()
}
