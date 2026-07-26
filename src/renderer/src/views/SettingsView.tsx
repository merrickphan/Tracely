import { useEffect, useState } from 'react'
import type { AppSettings, CitationStyle, Theme } from '@shared/types'
import type { ScreenWatchStatus } from '@shared/ipc-contract'
import Button from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import { tracelyApi } from '../lib/api'
import { applyTheme } from '../lib/theme'

export default function SettingsView(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [confirmClear, setConfirmClear] = useState<null | 'history' | 'all'>(null)
  const [clearedMessage, setClearedMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [screenWatch, setScreenWatch] = useState<ScreenWatchStatus | null>(null)

  useEffect(() => {
    tracelyApi
      .getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    tracelyApi.getScreenWatchStatus().then(setScreenWatch)
    return tracelyApi.onScreenWatchStatus(setScreenWatch)
  }, [])

  async function toggleScreenWatch(enabled: boolean): Promise<void> {
    const status = await tracelyApi.setScreenWatchEnabled(enabled)
    setScreenWatch(status)
  }

  async function save(patch: Parameters<typeof tracelyApi.setSettings>[0]): Promise<void> {
    setError(null)
    try {
      const updated = await tracelyApi.setSettings(patch)
      setSettings(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function changeTheme(theme: Theme): void {
    applyTheme(theme)
    setSettings((s) => (s ? { ...s, theme } : s))
    void save({ theme })
  }

  async function clearHistory(includeLibrary: boolean): Promise<void> {
    await tracelyApi.clearHistory(includeLibrary)
    setConfirmClear(null)
    setClearedMessage(includeLibrary ? 'History and library cleared.' : 'History cleared.')
    setTimeout(() => setClearedMessage(null), 3000)
  }

  if (!settings) {
    return <div className="settings-view">{error ? <p className="error-text">{error}</p> : <p>Loading…</p>}</div>
  }

  return (
    <div className="settings-view">
      <section className="settings-section">
        <h3>Appearance</h3>
        <label>
          Theme
          <select value={settings.theme} onChange={(e) => changeTheme(e.target.value as Theme)}>
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h3>Preferences</h3>
        <label>
          Default citation style
          <select
            value={settings.defaultCitationStyle}
            onChange={(e) => save({ defaultCitationStyle: e.target.value as CitationStyle })}
          >
            <option value="APA">APA</option>
            <option value="MLA">MLA</option>
            <option value="Chicago">Chicago</option>
          </select>
        </label>
        <label>
          Floating assistant hotkey
          <input
            type="text"
            value={settings.hotkeyAccelerator}
            onChange={(e) => setSettings({ ...settings, hotkeyAccelerator: e.target.value })}
            onBlur={(e) => save({ hotkeyAccelerator: e.target.value })}
          />
        </label>
      </section>

      <section className="settings-section">
        <h3>Screen Watch</h3>
        <p className="muted">
          When on, Tracely reads the text of whatever field is focused in other apps (via Windows
          accessibility APIs, not a screenshot) and underlines flagged claims directly on your
          screen — works in any app by default, like Grammarly. Apps on the blocklist below are
          skipped entirely: no text is ever read from them, and nothing is sent anywhere.
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={screenWatch?.enabled ?? false}
            onChange={(e) => toggleScreenWatch(e.target.checked)}
          />
          Enable Screen Watch
        </label>
        <label>
          Toggle hotkey
          <input
            type="text"
            value={settings.screenWatchHotkeyAccelerator}
            onChange={(e) => setSettings({ ...settings, screenWatchHotkeyAccelerator: e.target.value })}
            onBlur={(e) => save({ screenWatchHotkeyAccelerator: e.target.value })}
          />
        </label>
        <label>
          Blocked apps (process names, comma-separated)
          <input
            type="text"
            value={settings.screenWatchBlockedApps}
            onChange={(e) => setSettings({ ...settings, screenWatchBlockedApps: e.target.value })}
            onBlur={(e) => save({ screenWatchBlockedApps: e.target.value })}
            placeholder="Discord.exe, Slack.exe, Teams.exe"
          />
        </label>
        <p className="muted">
          Defaults block Discord, Slack, Teams, WhatsApp, Signal, Telegram, and Messenger. It
          won&apos;t work in apps like Google Docs that render text as pixels instead of exposing
          it to accessibility tools, regardless of this list.
        </p>
        {screenWatch?.enabled ? (
          <p className="muted">
            {screenWatch.active
              ? `Watching ${screenWatch.processName ?? 'the focused app'} — ${screenWatch.claimCount} claim${screenWatch.claimCount === 1 ? '' : 's'} flagged`
              : screenWatch.blockedApp
                ? `${screenWatch.blockedApp} is on your blocklist, so it's not being read.`
                : 'No supported text field is currently focused.'}
          </p>
        ) : null}
        {screenWatch?.lastError ? <p className="error-text">Screen Watch error: {screenWatch.lastError}</p> : null}
      </section>

      <section className="settings-section">
        <h3>Privacy</h3>
        <p className="muted">
          Tracely sends text to the Tracely relay when you click Analyze, Find Evidence, or
          Critique, and — only in apps on the Screen Watch allowlist above — automatically while
          you write. It's never sent anywhere else, and evidence search only ever queries academic
          APIs (OpenAlex, Crossref, Semantic Scholar, PubMed).
        </p>
        <div className="input-row">
          <Button variant="danger" onClick={() => setConfirmClear('history')}>
            Clear Analysis History
          </Button>
          <Button variant="danger" onClick={() => setConfirmClear('all')}>
            Clear History + Library
          </Button>
        </div>
        {clearedMessage ? <p className="muted">{clearedMessage}</p> : null}
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      {confirmClear ? (
        <ConfirmDialog
          title="Clear local data"
          message={
            confirmClear === 'all'
              ? 'This permanently deletes all analyses, cached results, and your saved source library from this computer.'
              : 'This permanently deletes analyses and cached results. Your saved library will be kept.'
          }
          confirmLabel="Delete"
          onConfirm={() => clearHistory(confirmClear === 'all')}
          onCancel={() => setConfirmClear(null)}
        />
      ) : null}
    </div>
  )
}
