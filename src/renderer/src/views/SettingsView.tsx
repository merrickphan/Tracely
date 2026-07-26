import { useEffect, useState } from 'react'
import type { AppSettings, CitationStyle } from '@shared/types'
import type { ScreenWatchStatus } from '@shared/ipc-contract'
import Button from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import { tracelyApi } from '../lib/api'

export default function SettingsView(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [semanticScholarKey, setSemanticScholarKey] = useState('')
  const [saving, setSaving] = useState(false)
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
    setSaving(true)
    setError(null)
    try {
      const updated = await tracelyApi.setSettings(patch)
      setSettings(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function saveSemanticScholarKey(): Promise<void> {
    if (!semanticScholarKey) return
    await save({ semanticScholarApiKey: semanticScholarKey })
    setSemanticScholarKey('')
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
        <h3>AI</h3>
        <p className="muted">
          Tracely's AI provider and models are configured by the app developer and can't be changed
          here.
        </p>
      </section>

      <section className="settings-section">
        <h3>Evidence Search</h3>
        <label>
          Semantic Scholar API key (optional) {settings.hasSemanticScholarKey ? <span className="muted">(saved)</span> : null}
          <div className="input-row">
            <input
              type="password"
              value={semanticScholarKey}
              onChange={(e) => setSemanticScholarKey(e.target.value)}
            />
            <Button variant="primary" onClick={saveSemanticScholarKey} disabled={!semanticScholarKey}>
              Save
            </Button>
          </div>
        </label>
        <label>
          Crossref contact email (polite pool)
          <input
            type="email"
            value={settings.crossrefMailto}
            onChange={(e) => setSettings({ ...settings, crossrefMailto: e.target.value })}
            onBlur={(e) => save({ crossrefMailto: e.target.value })}
          />
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
        <h3>Screen Watch (experimental)</h3>
        <p className="muted">
          When on, Tracely reads the text of whatever field is currently focused in other apps
          (via Windows accessibility APIs — not a screenshot) and underlines flagged claims directly
          on your screen, like a real-time grammar checker. This sends that text to the Tracely relay
          automatically as you write, without you clicking Analyze. Off by default. Works in apps that
          expose their text to accessibility tools (Word, WordPad, most native Windows apps) — it
          won't see text in apps that render it as pixels instead, such as Google Docs.
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={screenWatch?.enabled ?? false}
            onChange={(e) => toggleScreenWatch(e.target.checked)}
          />
          Enable Screen Watch
        </label>
        {screenWatch?.enabled ? (
          <p className="muted">
            {screenWatch.active
              ? `Watching ${screenWatch.processName ?? 'the focused app'} — ${screenWatch.claimCount} claim${screenWatch.claimCount === 1 ? '' : 's'} flagged`
              : 'No supported text field is currently focused.'}
          </p>
        ) : null}
        {screenWatch?.lastError ? <p className="error-text">Screen Watch error: {screenWatch.lastError}</p> : null}
      </section>

      <section className="settings-section">
        <h3>Privacy</h3>
        <p className="muted">
          Tracely sends text to the Tracely relay when you click Analyze, Find Evidence, or Critique;
          in the Live tab, automatically after a pause in typing; and, if Screen Watch is on, from
          whatever other app is focused. It's never sent anywhere else, and evidence search only ever
          queries academic APIs (OpenAlex, Crossref, Semantic Scholar, PubMed).
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
