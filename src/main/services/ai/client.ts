import { getAccessToken } from './identity'

// RELAY_URL/RELAY_TOKEN are inlined at build time by electron.vite.config.ts
// (see the `define` block) — they are not read from user-editable config, so
// there is no runtime path for a user to see or change which API is used.
//
// RELAY_TOKEN is not a secret and is not treated as one. It ships inside
// every installer, so anyone who downloads a release can read it out of the
// asar in a minute. It tells the relay "this is a Tracely build"; it does not
// say who is calling. The signed-in user's Supabase access token does that,
// and the relay verifies it independently before spending anything — see
// resolveUser() in the relay's lib/auth.ts.
declare const __RELAY_URL__: string
declare const __RELAY_TOKEN__: string

/**
 * Whether this build has a relay baked in at all. Lets a caller disable an
 * AI affordance up front (Tracer's composer does this) instead of letting
 * the user type a question and only then hit the "no relay configured"
 * error thrown by callRelay below.
 */
export function isRelayConfigured(): boolean {
  return Boolean(__RELAY_URL__)
}

export class RelayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelayError'
  }
}

// Transient conditions worth one retry: a dropped connection, the relay
// briefly overloaded (503/504), or its own soft rate limit (429, which
// clears within its rolling window) — none of these reached OpenAI, so
// retrying costs no extra tokens. A real 4xx (bad auth, bad request) is
// retried-for-nothing and fails again immediately, so those are not retried.
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
const RETRY_DELAY_MS = 800

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Derived from callRelay rather than repeated. The literal union has to stay
// spelled out in callRelay's own signature because scripts/preflight.mjs reads
// it from the source to decide which routes to verify against production, and
// a second copy here could silently fall behind it.
async function requestOnce<T>(endpoint: Parameters<typeof callRelay>[0], body: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-tracely-token': __RELAY_TOKEN__
  }
  // Fetched per request rather than cached: access tokens expire hourly and
  // the provider hands back a refreshed one, so caching here would reintroduce
  // the expiry problem supabase-js already solves. Omitted entirely when
  // signed out, rather than sent as "Bearer null" — the relay's 401 then says
  // what is actually wrong.
  const token = await getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${__RELAY_URL__}/api/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string
    }
    const error = new RelayError(errorBody.error ?? `Relay request failed (${response.status})`)
    ;(error as RelayError & { status?: number }).status = response.status
    throw error
  }

  return (await response.json()) as T
}

// Widening this union is what tells preflight there is a new endpoint to
// verify against production — scripts/preflight.mjs reads this type rather
// than a hardcoded list, so a release cannot ship a client calling a route the
// relay has not deployed. That check exists because v0.3.73 shipped a headline
// feature whose endpoint 404'd.
export async function callRelay<T>(
  endpoint: 'detect-claims' | 'critique' | 'tracer' | 'correction',
  body: unknown
): Promise<T> {
  if (!__RELAY_URL__) {
    throw new RelayError('This build has no relay configured. Set RELAY_URL/RELAY_TOKEN and rebuild.')
  }

  try {
    return await requestOnce<T>(endpoint, body)
  } catch (error) {
    const status = (error as RelayError & { status?: number }).status
    const retryable = status === undefined || RETRYABLE_STATUS.has(status)
    if (!retryable) throw error
    await delay(RETRY_DELAY_MS)
    return await requestOnce<T>(endpoint, body)
  }
}
