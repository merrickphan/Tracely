import { useEffect, useState } from 'react'
import type { AppSettings, CitationStyle, Theme } from '@shared/types'
import type { ScreenWatchStatus } from '@shared/ipc-contract'
import Button from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import { tracelyApi } from '../lib/api'
import { applyTheme } from '../lib/theme'

// Only real desktop apps (their own process, own .exe) can be individually
// blocked — Screen Watch identifies apps by process name. Google Docs,
// Google Drive, Notion's web app, etc. all run inside a browser process, so
// there's no way to block just one of them without blocking the whole
// browser; that limitation is called out in the copy below rather than
// pretending a checkbox for "Google Docs" would do anything.
//
// Broader than just "apps to block" — this is every writing/document/
// reference app Tracely knows the process name for, since Screen Watch is
// meant to work in exactly these, so a bigger list here means more of what
// people actually use shows up as a recognizable option instead of an
// unlabeled "Other apps" entry. Which ones actually render as checked
// (found on this machine) is determined by scanInstalledApps() at runtime.
const CURATED_BLOCKABLE_APPS: { label: string; exe: string }[] = [
  { label: 'Discord', exe: 'Discord.exe' },
  { label: 'Slack', exe: 'Slack.exe' },
  { label: 'Microsoft Teams', exe: 'ms-teams.exe' },
  { label: 'WhatsApp', exe: 'WhatsApp.exe' },
  { label: 'Signal', exe: 'Signal.exe' },
  { label: 'Telegram', exe: 'Telegram.exe' },
  { label: 'Messenger', exe: 'Messenger.exe' },
  { label: 'Microsoft Word', exe: 'WINWORD.EXE' },
  { label: 'Microsoft Excel', exe: 'EXCEL.EXE' },
  { label: 'Microsoft PowerPoint', exe: 'POWERPNT.EXE' },
  { label: 'Microsoft OneNote', exe: 'ONENOTE.EXE' },
  { label: 'Microsoft Outlook', exe: 'OUTLOOK.EXE' },
  { label: 'LibreOffice', exe: 'soffice.exe' },
  { label: 'WPS Office', exe: 'wps.exe' },
  { label: 'Notion (desktop app)', exe: 'Notion.exe' },
  { label: 'Obsidian', exe: 'Obsidian.exe' },
  { label: 'Evernote', exe: 'Evernote.exe' },
  { label: 'Scrivener', exe: 'Scrivener.exe' },
  { label: 'Typora', exe: 'Typora.exe' },
  { label: 'Zotero', exe: 'zotero.exe' },
  { label: 'Mendeley Reference Manager', exe: 'Mendeley Reference Manager.exe' },
  { label: 'Adobe Acrobat', exe: 'Acrobat.exe' },
  { label: 'Adobe Acrobat Reader', exe: 'AcroRd32.exe' },
  { label: 'Foxit PDF Reader', exe: 'FoxitPDFReader.exe' },
  { label: 'Visual Studio Code', exe: 'Code.exe' },
  { label: 'Sublime Text', exe: 'sublime_text.exe' },
  { label: 'Notepad++', exe: 'notepad++.exe' },
  { label: 'Spotify', exe: 'Spotify.exe' },
  { label: 'Google Chrome (entire browser)', exe: 'chrome.exe' },
  { label: 'Microsoft Edge (entire browser)', exe: 'msedge.exe' },
  { label: 'Mozilla Firefox (entire browser)', exe: 'firefox.exe' }
]
const CURATED_EXE_LOWER = new Set(CURATED_BLOCKABLE_APPS.map((a) => a.exe.toLowerCase()))

function parseAppList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function SettingsView(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [confirmClear, setConfirmClear] = useState<null | 'history' | 'all'>(null)
  const [clearedMessage, setClearedMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [screenWatch, setScreenWatch] = useState<ScreenWatchStatus | null>(null)
  const [extraAppsText, setExtraAppsText] = useState('')
  const [installedExeLower, setInstalledExeLower] = useState<Set<string> | null>(null)

  useEffect(() => {
    tracelyApi
      .getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    tracelyApi
      .scanInstalledApps()
      .then((res) => setInstalledExeLower(new Set(res.found.map((f) => f.toLowerCase()))))
      .catch(() => setInstalledExeLower(new Set()))
  }, [])

  useEffect(() => {
    tracelyApi.getScreenWatchStatus().then(setScreenWatch)
    return tracelyApi.onScreenWatchStatus(setScreenWatch)
  }, [])

  useEffect(() => {
    if (!settings) return
    const blocked = parseAppList(settings.screenWatchBlockedApps)
    const extras = blocked.filter((b) => !CURATED_EXE_LOWER.has(b.toLowerCase()))
    setExtraAppsText(extras.join(', '))
    // Only re-sync from the curated/extra split when settings load or the
    // blocklist changes elsewhere (e.g. checkbox toggles) — not on every
    // render, so typing in the free-text field isn't fought over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.screenWatchBlockedApps])

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

  function toggleCuratedApp(exe: string, checked: boolean): void {
    if (!settings) return
    const current = parseAppList(settings.screenWatchBlockedApps)
    const withoutThis = current.filter((b) => b.toLowerCase() !== exe.toLowerCase())
    const next = checked ? [...withoutThis, exe] : withoutThis
    void save({ screenWatchBlockedApps: next.join(',') })
  }

  function saveExtraApps(): void {
    if (!settings) return
    const curatedChecked = parseAppList(settings.screenWatchBlockedApps).filter((b) =>
      CURATED_EXE_LOWER.has(b.toLowerCase())
    )
    const extras = parseAppList(extraAppsText)
    void save({ screenWatchBlockedApps: [...curatedChecked, ...extras].join(',') })
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

  const blockedLower = new Set(parseAppList(settings.screenWatchBlockedApps).map((b) => b.toLowerCase()))
  const sortedApps = installedExeLower
    ? [...CURATED_BLOCKABLE_APPS].sort((a, b) => {
        const aIn = installedExeLower.has(a.exe.toLowerCase()) ? 0 : 1
        const bIn = installedExeLower.has(b.exe.toLowerCase()) ? 0 : 1
        return aIn - bIn
      })
    : CURATED_BLOCKABLE_APPS

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
          screen — works in any app by default, like Grammarly. Apps you check below are skipped
          entirely: no text is ever read from them, and nothing is sent anywhere.
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

        <p className="settings-label-heading">
          Blocked apps
          {installedExeLower === null ? <span className="muted"> — scanning what's installed…</span> : null}
        </p>
        <div className="app-checklist">
          {sortedApps.map((app) => {
            const isInstalled = installedExeLower?.has(app.exe.toLowerCase()) ?? false
            return (
              <label key={app.exe} className="checkbox-row app-checklist-item">
                <input
                  type="checkbox"
                  checked={blockedLower.has(app.exe.toLowerCase())}
                  onChange={(e) => toggleCuratedApp(app.exe, e.target.checked)}
                />
                {app.label}
                {isInstalled ? <span className="app-checklist-installed-dot" title="Installed on this computer" /> : null}
              </label>
            )
          })}
        </div>
        <p className="muted">
          Apps marked with a dot were detected as installed on this computer (via Start Menu
          shortcuts — portable installs may be missed). Everything else is still selectable in
          case detection missed it.
        </p>
        <label>
          Other apps (process names, comma-separated)
          <input
            type="text"
            value={extraAppsText}
            onChange={(e) => setExtraAppsText(e.target.value)}
            onBlur={saveExtraApps}
            placeholder="SomeApp.exe"
          />
        </label>
        <p className="muted">
          Screen Watch identifies apps by their process, so only apps with their own desktop
          program can be blocked individually — a browser can only be blocked as a whole (the
          &quot;entire browser&quot; options above), not one site within it. That means Google
          Docs, Google Drive, and Notion&apos;s web app can&apos;t be excluded on their own; block
          the browser you use them in if you need that. Separately, the whole Google Workspace
          suite — Docs, Sheets, and Slides — won&apos;t work with Screen Watch at all, blocked or
          not: they render their editing surface as pixels instead of exposing real text to
          accessibility tools, which Tracely relies on to read anything. Windows never sees a real
          text field to attach to, so there&apos;s nothing for Tracely to read no matter what.
        </p>
        {screenWatch?.enabled ? (
          <p className="muted">
            {screenWatch.active
              ? `Watching ${screenWatch.processName ?? 'the focused app'} — ${screenWatch.claimCount} claim${screenWatch.claimCount === 1 ? '' : 's'} flagged`
              : screenWatch.blockedApp
                ? `${screenWatch.blockedApp} is blocked, so it's not being read.`
                : 'No supported text field is currently focused.'}
          </p>
        ) : null}
        {screenWatch?.lastError ? <p className="error-text">Screen Watch error: {screenWatch.lastError}</p> : null}
      </section>

      <section className="settings-section">
        <h3>Privacy</h3>
        <p className="muted">
          Tracely sends text to the Tracely relay when you click Analyze, Find Evidence, or
          Critique, and — everywhere except apps on the Screen Watch blocklist above —
          automatically while you write. It's never sent anywhere else, and evidence search only
          ever queries academic APIs (OpenAlex, Crossref, Semantic Scholar, PubMed).
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
