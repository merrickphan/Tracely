import { Fragment, useEffect, useRef, useState } from 'react'
import type { AccentColor, AppSettings, Density, Theme } from '@shared/types'
import type { ProfileInfo, ScannedApp, ScreenWatchStatus } from '@shared/ipc-contract'
import Button from '../components/Button'
import SettingsField from '../components/SettingsField'
import { UserIcon, SunIcon, SlidersIcon, SignOutIcon, BackIcon } from '../components/icons'
import { tracelyApi } from '../lib/api'
import { applyTheme } from '../lib/theme'
import { applyAccentColor, applyDensity } from '../lib/appearance'
import type { Tab } from '../App'

const ACCENT_COLORS: { id: AccentColor; label: string; swatch: string }[] = [
  { id: 'orange', label: 'Orange', swatch: 'linear-gradient(135deg, #ffaf01, #ff6a00)' },
  { id: 'blue', label: 'Blue', swatch: 'linear-gradient(135deg, #60a5fa, #3b82f6)' },
  { id: 'green', label: 'Green', swatch: 'linear-gradient(135deg, #4ade80, #22c55e)' },
  { id: 'purple', label: 'Purple', swatch: 'linear-gradient(135deg, #c084fc, #a855f7)' }
]

// Figma's mockup also specified Account/Notifications/Security/Integrations/
// Billing, but those had no real backend (Tracely is local-first with no
// server, accounts, OAuth, or payments) and were previously implemented as
// static sample data wired to nothing. Removed on explicit instruction
// rather than kept as decoration — only sections with a real backend stay:
// Profile (local display prefs + avatar file), Appearance (real theme/
// accent/density), Preferences (real Screen Watch app allow/block list).
type Section = 'profile' | 'appearance' | 'preferences'

const NAV: { id: Section; label: string; icon: (props: { size?: number }) => JSX.Element }[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'appearance', label: 'Appearance', icon: SunIcon },
  { id: 'preferences', label: 'Preferences', icon: SlidersIcon }
]

export default function SettingsView({ onNavigate }: { onNavigate: (tab: Tab) => void }): JSX.Element {
  const [section, setSection] = useState<Section>('profile')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    tracelyApi
      .getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

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

  function changeAccentColor(accentColor: AccentColor): void {
    applyAccentColor(accentColor)
    setSettings((s) => (s ? { ...s, accentColor } : s))
    void save({ accentColor })
  }

  function changeDensity(density: Density): void {
    applyDensity(density)
    setSettings((s) => (s ? { ...s, density } : s))
    void save({ density })
  }

  const [appearanceSaving, setAppearanceSaving] = useState(false)

  async function saveAppearance(): Promise<void> {
    if (!settings) return
    setAppearanceSaving(true)
    try {
      await save({ theme: settings.theme, accentColor: settings.accentColor, density: settings.density })
    } finally {
      setAppearanceSaving(false)
    }
  }

  // Real, locally-persisted (see profileHandlers.ts) — not tied to any
  // account, just local display preferences + an avatar image file.
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    tracelyApi
      .getProfile()
      .then(setProfile)
      .catch((err) => setProfileError(err instanceof Error ? err.message : String(err)))
  }, [])

  async function saveProfile(): Promise<void> {
    if (!profile) return
    setProfileSaving(true)
    setProfileError(null)
    try {
      const updated = await tracelyApi.setProfile({
        firstName: profile.firstName,
        lastName: profile.lastName,
        username: profile.username,
        bio: profile.bio
      })
      setProfile(updated)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err))
    } finally {
      setProfileSaving(false)
    }
  }

  function handleAvatarFile(file: File): void {
    if (file.size > 2 * 1024 * 1024) {
      setProfileError('Avatar image must be 2 MB or smaller')
      return
    }
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setProfileError('Avatar must be a JPG or PNG image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setProfileError(null)
      tracelyApi
        .setProfile({ avatarDataUrl: dataUrl })
        .then(setProfile)
        .catch((err) => setProfileError(err instanceof Error ? err.message : String(err)))
    }
    reader.readAsDataURL(file)
  }

  // --- Preferences: Screen Watch on/off (moved here from the Home page
  // heading, which used to double as a click-to-toggle control) + the app
  // allow/block list, backed by the same screenWatchBlockedApps setting and
  // settings:scanInstalledApps IPC that already existed before this UI
  // surface was added.
  const [screenWatch, setScreenWatch] = useState<ScreenWatchStatus | null>(null)
  const [screenWatchToggling, setScreenWatchToggling] = useState(false)
  const [installedApps, setInstalledApps] = useState<ScannedApp[] | null>(null)
  const [manualApp, setManualApp] = useState('')
  const [prefsError, setPrefsError] = useState<string | null>(null)

  useEffect(() => {
    tracelyApi.getScreenWatchStatus().then(setScreenWatch)
    return tracelyApi.onScreenWatchStatus(setScreenWatch)
  }, [])

  async function toggleScreenWatch(): Promise<void> {
    if (!screenWatch || screenWatchToggling) return
    setScreenWatchToggling(true)
    try {
      const status = await tracelyApi.setScreenWatchEnabled(!screenWatch.enabled)
      setScreenWatch(status)
    } finally {
      setScreenWatchToggling(false)
    }
  }

  useEffect(() => {
    if (section !== 'preferences' || installedApps !== null) return
    tracelyApi
      .scanInstalledApps()
      .then((res) => setInstalledApps(res.found))
      .catch((err) => setPrefsError(err instanceof Error ? err.message : String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  const blockedApps = (settings?.screenWatchBlockedApps ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Scanned apps (with a real display name) plus any blocked exe that
  // wasn't found by the scan (e.g. manually added, or a portable app) —
  // those fall back to showing their exe name as the label since there's
  // no friendly name known for them.
  const scanned = installedApps ?? []
  const scannedExeSet = new Set(scanned.map((a) => a.exe.toLowerCase()))
  const knownApps = [
    ...scanned,
    ...blockedApps.filter((exe) => !scannedExeSet.has(exe.toLowerCase())).map((exe) => ({ name: exe, exe }))
  ].sort((a, b) => a.name.localeCompare(b.name))

  async function setAppAllowed(exe: string, allowed: boolean): Promise<void> {
    setPrefsError(null)
    const current = new Set(blockedApps.map((a) => a.toLowerCase()))
    if (allowed) current.delete(exe.toLowerCase())
    else current.add(exe.toLowerCase())
    try {
      await save({ screenWatchBlockedApps: Array.from(current).join(',') })
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : String(err))
    }
  }

  async function addManualApp(): Promise<void> {
    const exe = manualApp.trim()
    if (!exe) return
    setManualApp('')
    if (!knownApps.some((a) => a.exe.toLowerCase() === exe.toLowerCase())) {
      setInstalledApps((prev) => [...(prev ?? []), { name: exe, exe }])
    }
    // Newly-added apps default to allowed (not in the blocklist) unless
    // they're already blocked — no change needed unless the name matches
    // an existing blocked entry, in which case it already renders blocked.
  }

  if (!settings) {
    return <div className="settings-view">{error ? <p className="error-text">{error}</p> : <p>Loading…</p>}</div>
  }

  return (
    <div className="settings-view">
      <div className="settings-shell">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-header">
            <button className="settings-back-link" onClick={() => onNavigate('home')}>
              <BackIcon /> Back
            </button>
            <h2>Settings</h2>
          </div>
          <nav className="settings-nav">
            {NAV.map((n) => (
              <Fragment key={n.id}>
                <button
                  className={`settings-nav-item ${section === n.id ? 'active' : ''}`}
                  onClick={() => setSection(n.id)}
                >
                  <n.icon size={15} />
                  {n.label}
                </button>
              </Fragment>
            ))}
          </nav>
          <div className="settings-sidebar-footer">
            <button className="settings-signout">
              <SignOutIcon size={15} /> Sign out
            </button>
          </div>
        </aside>

        <div className="settings-panel">
          {section === 'profile' && profile ? (
            <>
              <div className="settings-panel-header">
                <h3>Profile</h3>
                <p>How others see you across the platform.</p>
              </div>
              <div className="settings-avatar-row">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" className="settings-avatar settings-avatar-photo" />
                ) : (
                  <div className="settings-avatar">
                    {(profile.firstName[0] ?? '') + (profile.lastName[0] ?? '') || '?'}
                  </div>
                )}
                <div className="settings-avatar-meta">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleAvatarFile(file)
                      e.target.value = ''
                    }}
                  />
                  <button
                    className="settings-avatar-upload"
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    Upload photo
                  </button>
                  <p>JPG or PNG · max 2 MB</p>
                </div>
              </div>
              <div className="settings-panel-grid">
                <SettingsField label="First name">
                  <input
                    value={profile.firstName}
                    placeholder="First name"
                    onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                  />
                </SettingsField>
                <SettingsField label="Last name">
                  <input
                    value={profile.lastName}
                    placeholder="Last name"
                    onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                  />
                </SettingsField>
                <SettingsField label="Username" full>
                  <input
                    value={profile.username}
                    placeholder="@username"
                    onChange={(e) => setProfile({ ...profile, username: e.target.value })}
                  />
                </SettingsField>
                <SettingsField label="Bio" full>
                  <textarea
                    value={profile.bio}
                    placeholder="Say something about yourself"
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                  />
                </SettingsField>
              </div>
              {profileError ? <p className="error-text">{profileError}</p> : null}
              <Button variant="dark" onClick={saveProfile} disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          ) : null}

          {section === 'appearance' ? (
            <>
              <div className="settings-panel-header">
                <h3>Appearance</h3>
                <p>Customize how Tracely looks for you.</p>
              </div>
              <div className="settings-panel-grid">
                <SettingsField label="Theme">
                  <select value={settings.theme} onChange={(e) => changeTheme(e.target.value as Theme)}>
                    <option value="system">System default</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </SettingsField>
                <SettingsField label="Accent color">
                  <div className="accent-swatch-row">
                    {ACCENT_COLORS.map((c) => (
                      <button
                        key={c.id}
                        className={`accent-swatch ${settings.accentColor === c.id ? 'accent-swatch-active' : ''}`}
                        style={{ background: c.swatch }}
                        title={c.label}
                        onClick={() => changeAccentColor(c.id)}
                      />
                    ))}
                  </div>
                </SettingsField>
                <SettingsField label="Font size">
                  <select disabled defaultValue="Medium">
                    <option>Small</option>
                    <option>Medium</option>
                    <option>Large</option>
                  </select>
                </SettingsField>
                <SettingsField label="Density">
                  <select value={settings.density} onChange={(e) => changeDensity(e.target.value as Density)}>
                    <option value="comfortable">Comfortable spacing across lists and cards</option>
                    <option value="compact">Compact spacing across lists and cards</option>
                  </select>
                </SettingsField>
              </div>
              <Button variant="dark" onClick={saveAppearance} disabled={appearanceSaving}>
                {appearanceSaving ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          ) : null}

          {section === 'preferences' ? (
            <>
              <div className="settings-panel-header">
                <h3>Preferences</h3>
                <p>Turn Screen Watch on or off, and choose which apps it's allowed to read text from.</p>
              </div>
              <label className="settings-toggle-row">
                <div>
                  <div className="settings-toggle-row-title">Screen Watch</div>
                  <div className="settings-toggle-row-subtitle">
                    {screenWatch?.enabled ? 'On — reading focused apps for flagged claims.' : 'Off.'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={screenWatch?.enabled ?? false}
                  disabled={!screenWatch || screenWatchToggling}
                  onChange={toggleScreenWatch}
                />
              </label>
              <div className="settings-app-list">
                {installedApps === null ? (
                  <p className="muted">Scanning installed apps…</p>
                ) : knownApps.length === 0 ? (
                  <p className="muted">No apps found. Add one by name below.</p>
                ) : (
                  knownApps.map((app: ScannedApp) => {
                    const allowed = !blockedApps.some((b) => b.toLowerCase() === app.exe.toLowerCase())
                    return (
                      <label key={app.exe} className="settings-app-row">
                        <input
                          type="checkbox"
                          checked={allowed}
                          onChange={(e) => void setAppAllowed(app.exe, e.target.checked)}
                        />
                        <span className="settings-app-row-text">
                          <span className="settings-app-row-name">{app.name}</span>
                          {app.name !== app.exe ? <span className="settings-app-row-exe">{app.exe}</span> : null}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
              <div className="settings-app-add">
                <input
                  value={manualApp}
                  placeholder="Add an app by .exe name (e.g. notepad.exe)"
                  onChange={(e) => setManualApp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addManualApp()
                  }}
                />
                <Button variant="secondary" onClick={addManualApp}>
                  Add
                </Button>
              </div>
              {prefsError ? <p className="error-text">{prefsError}</p> : null}
              <p className="muted settings-app-note">
                Unchecked apps are on Screen Watch&rsquo;s blocklist and never have their text read. Chat apps
                (Discord, Slack, Teams, WhatsApp, Signal, Telegram, Messenger) are blocked by default.
              </p>
            </>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </div>
    </div>
  )
}
