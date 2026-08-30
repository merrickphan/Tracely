// Who the relay should bill this call to, and what that account has paid for.
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

import { DEFAULT_PLAN, type Plan } from '@shared/plan'

let provider: (() => Promise<string | null>) | null = null
let planProvider: (() => Promise<Plan>) | null = null

/**
 * Called once at startup by whoever knows how to get a token — main/index.ts
 * in the app, the harness in the eval.
 */
export function setAccessTokenProvider(fn: () => Promise<string | null>): void {
  provider = fn
}

/**
 * The same registration, for the plan the account is on — see getPlan below.
 */
export function setPlanProvider(fn: () => Promise<Plan>): void {
  planProvider = fn
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

/**
 * Which plan this call is entitled to, defaulting to `free`.
 *
 * Unlike getAccessToken this does NOT throw when unregistered, and the
 * difference is which way each one is wrong when nobody registered anything. A
 * missing token produces a 401 the user cannot act on, so it is loud. A missing
 * plan produces the free tier, which is a working app — and an entry point that
 * spends on the top model because it forgot to register a provider is the one
 * outcome this whole module exists to prevent.
 */
export async function getPlan(): Promise<Plan> {
  if (!planProvider) return DEFAULT_PLAN
  try {
    return await planProvider()
  } catch {
    return DEFAULT_PLAN
  }
}
