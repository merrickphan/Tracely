import { queryOne, run } from './db'

const DEFAULTS: Record<string, string> = {
  defaultCitationStyle: 'APA',
  hotkeyAccelerator: 'CommandOrControl+Shift+F',
  // Contact address sent to Crossref as `mailto`, which routes identified
  // callers into its polite pool and throttles anonymous traffic. Crossref
  // only — OpenAlex removed the parameter when it replaced the polite pool
  // with a metered budget, so sending it there is dead weight.
  //
  // A real default rather than '' because nothing ever set it: there is no
  // Settings field for it, so every install ran anonymous against Crossref.
  // Read through politePoolMailto(), not getSetting(), so a stored blank
  // cannot shadow it.
  crossrefMailto: 'info@jointracely.com',
  enableStrengthSummaries: 'false',
  screenWatchEnabled: 'false',
  theme: 'dark',
  accentColor: 'orange',
  density: 'comfortable',
  fontSize: 'medium',
  claimSensitivity: '0.55',
  screenWatchHotkeyAccelerator: 'CommandOrControl+Shift+S',
  // Process image names (e.g. "Discord.exe") Screen Watch IS allowed to
  // read text from — opt-in allowlist, not an opt-out blocklist: nothing
  // works anywhere until the user explicitly picks apps in Settings >
  // Preferences. Comma-separated, case-insensitive. Empty means nothing is
  // enabled yet.
  screenWatchAllowedApps: '',
  // The "Do not show anymore" checkbox on the Save changes dialog (Figma
  // 212:65). Off by default so the dialog appears until the user opts out of
  // it — a confirm nobody can turn off is one they learn to click through
  // without reading, which is worse than not having it.
  suppressSaveConfirm: 'false',
  // Year 12 — the level GRADE_BANDS was written against, so an install that
  // never opens this setting grades exactly as it did before it existed.
  gradingLevel: '12'
}

export function getSetting(key: string): string {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = $key', { $key: key })
  if (row) return row.value
  return DEFAULTS[key] ?? ''
}

/**
 * The address sent to OpenAlex and Crossref to stay in their polite pools.
 *
 * Deliberately not a plain getSetting call. A stored value wins over DEFAULTS,
 * so any install that ever wrote a blank here — and the old default WAS blank —
 * would keep sending anonymous requests forever, silently, no matter what this
 * file says. That is the same shape as the config.json bug that made an .env
 * API key unreadable on every machine that had run the app once.
 *
 * The guard is scoped to this one key rather than applied inside getSetting,
 * because blank is a meaningful value elsewhere: an empty
 * screenWatchAllowedApps means "no apps enabled", and an empty
 * hotkeyAccelerator would be a user disabling their hotkey. Falling back to a
 * default there would override a real choice.
 */
export function politePoolMailto(): string {
  return getSetting('crossrefMailto').trim() || DEFAULTS.crossrefMailto
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
