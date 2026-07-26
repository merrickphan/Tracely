import { queryOne, run } from './db'

const DEFAULTS: Record<string, string> = {
  defaultCitationStyle: 'APA',
  hotkeyAccelerator: 'CommandOrControl+Shift+F',
  crossrefMailto: '',
  enableStrengthSummaries: 'false',
  screenWatchEnabled: 'false',
  theme: 'dark',
  screenWatchHotkeyAccelerator: 'CommandOrControl+Shift+S',
  // Process image names (e.g. "WINWORD.EXE") Screen Watch is allowed to read
  // text from. Comma-separated, case-insensitive. Empty means "nowhere" —
  // fail closed rather than silently watching whatever app happens to be
  // focused, since that's exactly the "scanning my Discord DMs" problem this
  // allowlist exists to prevent.
  screenWatchAllowedApps: 'WINWORD.EXE,notepad.exe,msedge.exe,chrome.exe'
}

export function getSetting(key: string): string {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = $key', { $key: key })
  if (row) return row.value
  return DEFAULTS[key] ?? ''
}

export function setSetting(key: string, value: string): void {
  run('INSERT INTO settings (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = $value', {
    $key: key,
    $value: value
  })
}

export function getAllSettingsRaw(): Record<string, string> {
  const result: Record<string, string> = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    result[key] = getSetting(key)
  }
  return result
}
