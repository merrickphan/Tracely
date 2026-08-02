import { queryOne, run } from './db'

const DEFAULTS: Record<string, string> = {
  defaultCitationStyle: 'APA',
  hotkeyAccelerator: 'CommandOrControl+Shift+F',
  crossrefMailto: '',
  enableStrengthSummaries: 'false',
  screenWatchEnabled: 'false',
  theme: 'dark',
  accentColor: 'orange',
  density: 'comfortable',
  claimSensitivity: '0.55',
  screenWatchHotkeyAccelerator: 'CommandOrControl+Shift+S',
  // Process image names (e.g. "Discord.exe") Screen Watch is NOT allowed to
  // read text from — default-allow (works anywhere, like Grammarly),
  // opt-out for chat/DM apps so casual conversations aren't read without
  // any setup. Comma-separated, case-insensitive. Empty means "block
  // nothing" — truly everywhere.
  screenWatchBlockedApps: 'Discord.exe,Slack.exe,Teams.exe,WhatsApp.exe,Signal.exe,Telegram.exe,Messenger.exe',
  localModelEnabled: 'false'
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
