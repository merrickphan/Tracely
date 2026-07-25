// RELAY_URL/RELAY_TOKEN are inlined at build time by electron.vite.config.ts
// (see the `define` block) — they are not read from user-editable config, so
// there is no runtime path for a user to see or change which API is used.
declare const __RELAY_URL__: string
declare const __RELAY_TOKEN__: string

export class RelayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelayError'
  }
}

export async function callRelay<T>(endpoint: 'detect-claims' | 'critique', body: unknown): Promise<T> {
  if (!__RELAY_URL__) {
    throw new RelayError('This build has no relay configured. Set RELAY_URL/RELAY_TOKEN and rebuild.')
  }

  const response = await fetch(`${__RELAY_URL__}/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tracely-token': __RELAY_TOKEN__
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string
    }
    throw new RelayError(errorBody.error ?? `Relay request failed (${response.status})`)
  }

  return (await response.json()) as T
}
