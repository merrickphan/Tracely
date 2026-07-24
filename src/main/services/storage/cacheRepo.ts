import { queryOne, run } from './db'

interface CacheRow {
  response_json: string
  expires_at: string | null
}

export function getCached<T>(key: string): T | null {
  const row = queryOne<CacheRow>('SELECT response_json, expires_at FROM request_cache WHERE cache_key = $key', {
    $key: key
  })
  if (!row) return null
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null
  return JSON.parse(row.response_json) as T
}

export function setCached(key: string, type: string, value: unknown, ttlMs?: number): void {
  const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null
  run(
    `INSERT INTO request_cache (cache_key, cache_type, response_json, created_at, expires_at)
     VALUES ($key, $type, $value, $now, $expires)
     ON CONFLICT(cache_key) DO UPDATE SET response_json = $value, created_at = $now, expires_at = $expires`,
    {
      $key: key,
      $type: type,
      $value: JSON.stringify(value),
      $now: new Date().toISOString(),
      $expires: expiresAt
    }
  )
}
