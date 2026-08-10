import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProfileInfo, ScannedApp, ScreenWatchStatus } from '@shared/ipc-contract'
import type { AccentColor, AppSettings, AuthUser, Density, FontSize, Theme } from '@shared/types'
import Button from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import DangerZone from '../components/DangerZone'
import SettingsField from '../components/SettingsField'
import { applyAccentColor, applyDensity, applyFontSize } from '../lib/appearance'
import { tracelyApi } from '../lib/api'
import { applyTheme } from '../lib/theme'
import type { Tab } from '../App'

type Section =
  | 'profile'
  | 'appearance'
  | 'preferences'
  | 'notifications'
  | 'security'
  | 'integrations'
  | 'billing'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security', label: 'Security' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'billing', label: 'Billing' }
]

const ACCENT_COLORS: { id: AccentColor; label: string; color: string }[] = [
  { id: 'orange', label: 'Orange', color: '#ff4f00' },
  { id: 'blue', label: 'Blue', color: '#3b82f6' },
  { id: 'green', label: 'Green', color: '#22c55e' },
  { id: 'purple', label: 'Purple', color: '#a855f7' }
]

function UnavailableValue({ children }: { children: string }): JSX.Element {
  return <div className="settings-static-value is-unavailable">{children}</div>
}

export default function SettingsView({
  onNavigate,
  embedded = false
}: {
  onNavigate: (tab: Tab) => void
  embedded?: boolean
}): JSX.Element {
  const [section, setSection] = useState<Section>('profile')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [screenWatch, setScreenWatch] = useState<ScreenWatchStatus | null>(null)
  const [installedApps, setInstalledApps] = useState<ScannedApp[] | null>(null)
  const [manualApp, setManualApp] = useState('')
  const [username, setUsername] = useState('')
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [preferencesError, setPreferencesError] = useState<string | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [appearanceSaving, setAppearanceSaving] = useState(false)
  const [screenWatchToggling, setScreenWatchToggling] = useState(false)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [signOutBusy, setSignOutBusy] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void Promise.all([tracelyApi.getSettings(), tracelyApi.getProfile(), tracelyApi.getAuthUser()])
      .then(([nextSettings, nextProfile, auth]) => {
        setSettings(nextSettings)
        setProfile(nextProfile)
        setAuthUser(auth.user)
        setUsername(auth.user?.username ?? '')
      })
      .catch((caught) => setLoadingError(caught instanceof Error ? caught.message : String(caught)))
  }, [])

  useEffect(() => {
    void tracelyApi.getScreenWatchStatus().then(setScreenWatch).catch((caught) => {
      setPreferencesError(caught instanceof Error ? caught.message : String(caught))
    })
    return tracelyApi.onScreenWatchStatus(setScreenWatch)
  }, [])

  useEffect(() => tracelyApi.onAuthStateChanged(setAuthUser), [])

  useEffect(() => {
    if (section !== 'preferences' || installedApps !== null) return
    void tracelyApi
      .scanInstalledApps()
      .then((response) => setInstalledApps(response.found))
      .catch((caught) => setPreferencesError(caught instanceof Error ? caught.message : String(caught)))
  }, [installedApps, section])

  const allowedApps = useMemo(
    () =>
      (settings?.screenWatchAllowedApps ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    [settings?.screenWatchAllowedApps]
  )

  const knownApps = useMemo(() => {
    const scanned = installedApps ?? []
    const scannedExe = new Set(scanned.map((app) => app.exe.toLowerCase()))
    return [
      ...scanned,
      ...allowedApps
        .filter((exe) => !scannedExe.has(exe.toLowerCase()))
        .map((exe) => ({ name: exe, exe }))
    ].sort((left, right) => left.name.localeCompare(right.name))
  }, [allowedApps, installedApps])

  async function saveProfile(): Promise<void> {
    if (!profile || profileSaving) return
    setProfileSaving(true)
    setProfileError(null)
    try {
      const updated = await tracelyApi.setProfile({
        firstName: profile.firstName,
        lastName: profile.lastName,
        bio: profile.bio,
        phone: profile.phone
      })
      setProfile(updated)

      if (authUser && profile.firstName.trim() && profile.firstName.trim() !== authUser.firstName) {
        const response = await tracelyApi.updateAuthName(profile.firstName.trim())
        setAuthUser(response.user)
      }
      const requestedUsername = username.trim()
      if (authUser && requestedUsername && requestedUsername !== (authUser.username ?? '')) {
        const response = await tracelyApi.updateAuthUsername(requestedUsername)
        setAuthUser(response.user)
      }
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setProfileSaving(false)
    }
  }

  async function saveAppearance(): Promise<void> {
    if (!settings || appearanceSaving) return
    setAppearanceSaving(true)
    setLoadingError(null)
    try {
      setSettings(
        await tracelyApi.setSettings({
          theme: settings.theme,
          accentColor: settings.accentColor,
          density: settings.density,
          fontSize: settings.fontSize
        })
      )
    } catch (caught) {
      setLoadingError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setAppearanceSaving(false)
    }
  }

  function changeTheme(theme: Theme): void {
    applyTheme(theme)
    setSettings((current) => (current ? { ...current, theme } : current))
  }

  function changeAccentColor(accentColor: AccentColor): void {
    applyAccentColor(accentColor)
    setSettings((current) => (current ? { ...current, accentColor } : current))
  }

  function changeFontSize(fontSize: FontSize): void {
    applyFontSize(fontSize)
    setSettings((current) => (current ? { ...current, fontSize } : current))
  }

  function changeDensity(density: Density): void {
    applyDensity(density)
    setSettings((current) => (current ? { ...current, density } : current))
  }

  function handleAvatarFile(file: File): void {
    if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) {
      setProfileError('Choose a JPG or PNG image no larger than 2 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      void tracelyApi
        .setProfile({ avatarDataUrl: String(reader.result) })
        .then(setProfile)
        .catch((caught) => setProfileError(caught instanceof Error ? caught.message : String(caught)))
    }
    reader.readAsDataURL(file)
  }

  async function toggleScreenWatch(): Promise<void> {
    if (!screenWatch || screenWatchToggling) return
    setScreenWatchToggling(true)
    setPreferencesError(null)
    try {
      setScreenWatch(await tracelyApi.setScreenWatchEnabled(!screenWatch.enabled))
    } catch (caught) {
      setPreferencesError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setScreenWatchToggling(false)
    }
  }

  async function setAppAllowed(exe: string, allowed: boolean): Promise<void> {
    if (!settings) return
    const next = new Set(allowedApps.map((value) => value.toLowerCase()))
    if (allowed) next.add(exe.toLowerCase())
    else next.delete(exe.toLowerCase())
    setPreferencesError(null)
    try {
      setSettings(await tracelyApi.setSettings({ screenWatchAllowedApps: [...next].join(',') }))
    } catch (caught) {
      setPreferencesError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  function addManualApp(): void {
    const exe = manualApp.trim()
    if (!exe) return
    if (!knownApps.some((app) => app.exe.toLowerCase() === exe.toLowerCase())) {
      setInstalledApps((current) => [...(current ?? []), { name: exe, exe }])
    }
    setManualApp('')
  }

  async function signOut(): Promise<void> {
    setSignOutBusy(true)
    try {
      await tracelyApi.signOut()
    } finally {
      setSignOutBusy(false)
      setConfirmingSignOut(false)
    }
  }

  if (!settings || !profile) {
    return (
      <div className="dashboard-settings-loading" role="status">
        {loadingError ?? 'Loading settings…'}
      </div>
    )
  }

  return (
    <div className={`dashboard-settings ${embedded ? 'is-embedded' : ''}`}>
      {!embedded ? (
        <button type="button" className="dashboard-back-button" onClick={() => onNavigate('home')}>
          Back
        </button>
      ) : null}
      <header className="dashboard-page-heading">
        <h1>Settings</h1>
        <p>Manage your Tracely profile, appearance, privacy, and preferences.</p>
      </header>

      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            className={section === item.id ? 'is-active' : ''}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="settings-content-card" aria-live="polite">
        {section === 'profile' ? (
          <div className="settings-panel-content">
            <div className="settings-panel-header">
              <h2>Profile</h2>
              <p>Update your personal details.</p>
            </div>
            <div className="settings-avatar-row">
              {profile.avatarUrl ? (
                <img className="settings-avatar" src={profile.avatarUrl} alt="Current profile" />
              ) : (
                <span className="settings-avatar" aria-hidden="true">
                  {(profile.firstName[0] ?? authUser?.firstName?.[0] ?? '?').toUpperCase()}
                </span>
              )}
              <div>
                <input
                  ref={avatarInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) handleAvatarFile(file)
                    event.target.value = ''
                  }}
                />
                <button type="button" className="settings-upload-button" onClick={() => avatarInputRef.current?.click()}>
                  Change photo
                </button>
                <p>JPG or PNG, up to 2 MB.</p>
              </div>
            </div>
            <div className="settings-panel-grid">
              <SettingsField label="First name">
                <input
                  value={profile.firstName}
                  autoComplete="given-name"
                  onChange={(event) => setProfile({ ...profile, firstName: event.target.value })}
                />
              </SettingsField>
              <SettingsField label="Last name">
                <input
                  value={profile.lastName}
                  autoComplete="family-name"
                  onChange={(event) => setProfile({ ...profile, lastName: event.target.value })}
                />
              </SettingsField>
              <SettingsField label="Username" full>
                <input
                  id="profile-username"
                  value={username}
                  autoComplete="username"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </SettingsField>
              <SettingsField label="Bio" full>
                <textarea
                  value={profile.bio}
                  rows={3}
                  onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
                />
              </SettingsField>
              <SettingsField label="Email address">
                <input value={authUser?.email ?? ''} readOnly aria-readonly="true" />
              </SettingsField>
              <SettingsField label="Phone number">
                <input
                  value={profile.phone}
                  type="tel"
                  autoComplete="tel"
                  onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
                />
              </SettingsField>
            </div>
            {profileError ? <p className="dashboard-form-error">{profileError}</p> : null}
            <div className="settings-actions">
              <Button variant="dark" onClick={() => void saveProfile()} disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save changes'}
              </Button>
              {authUser ? (
                <Button variant="secondary" onClick={() => setConfirmingSignOut(true)}>
                  Sign out
                </Button>
              ) : null}
            </div>
            {authUser ? <DangerZone user={authUser} /> : null}
          </div>
        ) : null}

        {section === 'appearance' ? (
          <div className="settings-panel-content">
            <div className="settings-panel-header">
              <h2>Appearance</h2>
              <p>Customize how Tracely looks for you.</p>
            </div>
            <div className="settings-panel-grid">
              <SettingsField label="Theme">
                <select value={settings.theme} onChange={(event) => changeTheme(event.target.value as Theme)}>
                  <option value="system">System default</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </SettingsField>
              <SettingsField label="Accent color">
                <div className="settings-color-options" role="radiogroup" aria-label="Accent color">
                  {ACCENT_COLORS.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      role="radio"
                      aria-checked={settings.accentColor === color.id}
                      aria-label={color.label}
                      className={settings.accentColor === color.id ? 'is-selected' : ''}
                      style={{ backgroundColor: color.color }}
                      onClick={() => changeAccentColor(color.id)}
                    />
                  ))}
                </div>
              </SettingsField>
              <SettingsField label="Font size" full>
                <select value={settings.fontSize} onChange={(event) => changeFontSize(event.target.value as FontSize)}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </SettingsField>
              <SettingsField label="Density" full>
                <select value={settings.density} onChange={(event) => changeDensity(event.target.value as Density)}>
                  <option value="comfortable">Comfortable spacing across lists and cards</option>
                  <option value="compact">Compact spacing across lists and cards</option>
                </select>
              </SettingsField>
            </div>
            <Button variant="dark" onClick={() => void saveAppearance()} disabled={appearanceSaving}>
              {appearanceSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        ) : null}

        {section === 'preferences' ? (
          <div className="settings-panel-content">
            <div className="settings-panel-header">
              <h2>Preferences</h2>
              <p>Turn Screen Watch on or off, and choose which apps it may read text from.</p>
            </div>
            <label className="settings-toggle-row">
              <span>
                <strong>Screen Watch</strong>
                <small>{screenWatch?.enabled ? 'On — reading focused apps for flagged claims.' : 'Off — not reading app text.'}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={screenWatch?.enabled ?? false}
                disabled={!screenWatch || screenWatchToggling}
                onChange={() => void toggleScreenWatch()}
              />
            </label>
            <div className="settings-app-grid" aria-label="Supported applications">
              {installedApps === null ? <p className="settings-muted">Scanning installed applications…</p> : null}
              {installedApps !== null && knownApps.length === 0 ? (
                <p className="settings-muted">No supported applications were found. Add an executable name below.</p>
              ) : null}
              {knownApps.map((app) => (
                <label key={app.exe} className="settings-app-option">
                  <input
                    type="checkbox"
                    checked={allowedApps.some((allowed) => allowed.toLowerCase() === app.exe.toLowerCase())}
                    onChange={(event) => void setAppAllowed(app.exe, event.target.checked)}
                  />
                  <span>{app.name}</span>
                </label>
              ))}
            </div>
            <form
              className="settings-add-app"
              onSubmit={(event) => {
                event.preventDefault()
                addManualApp()
              }}
            >
              <label className="sr-only" htmlFor="settings-add-app-input">Add an application</label>
              <input
                id="settings-add-app-input"
                value={manualApp}
                placeholder="Add an app by executable name"
                onChange={(event) => setManualApp(event.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={!manualApp.trim()}>Add</Button>
            </form>
            <p className="settings-privacy-note">
              Screen Watch only reads text in apps you explicitly allow. Nothing is enabled until you select it.
            </p>
            {preferencesError ? <p className="dashboard-form-error">{preferencesError}</p> : null}
          </div>
        ) : null}

        {section === 'notifications' ? (
          <div className="settings-panel-content">
            <div className="settings-panel-header">
              <h2>Notifications</h2>
              <p>Notification delivery is not available in this desktop build yet.</p>
            </div>
            <div className="settings-panel-grid">
              <SettingsField label="Email notifications"><UnavailableValue>Unavailable</UnavailableValue></SettingsField>
              <SettingsField label="Push notifications"><UnavailableValue>Unavailable</UnavailableValue></SettingsField>
              <SettingsField label="SMS alerts" full><UnavailableValue>Unavailable</UnavailableValue></SettingsField>
              <SettingsField label="Notification schedule" full><UnavailableValue>Unavailable</UnavailableValue></SettingsField>
            </div>
            <Button variant="dark" disabled>Save changes</Button>
          </div>
        ) : null}

        {section === 'security' ? (
          <div className="settings-panel-content">
            <div className="settings-panel-header">
              <h2>Security</h2>
              <p>Account identity is verified by the current authentication provider.</p>
            </div>
            <div className="settings-panel-grid">
              <SettingsField label="Two-factor authentication"><UnavailableValue>Not exposed by the current auth provider</UnavailableValue></SettingsField>
              <SettingsField label="Recovery email"><UnavailableValue>Not configured</UnavailableValue></SettingsField>
              <SettingsField label="Active sessions" full><UnavailableValue>Session details are not available in the app</UnavailableValue></SettingsField>
              <SettingsField label="Recent login activity" full><UnavailableValue>Login history is not available in the app</UnavailableValue></SettingsField>
            </div>
            <Button variant="dark" disabled>Save changes</Button>
          </div>
        ) : null}

        {section === 'integrations' ? (
          <div className="settings-panel-content">
            <div className="settings-panel-header">
              <h2>Integrations</h2>
              <p>Connected services will appear here when integration support is available.</p>
            </div>
            <div className="settings-panel-grid">
              <SettingsField label="Google Calendar"><UnavailableValue>Coming soon — not connected</UnavailableValue></SettingsField>
              <SettingsField label="Nextdoor"><UnavailableValue>Coming soon — not connected</UnavailableValue></SettingsField>
              <SettingsField label="Gmail" full><UnavailableValue>Coming soon — not connected</UnavailableValue></SettingsField>
            </div>
            <Button variant="dark" disabled>Save changes</Button>
          </div>
        ) : null}

        {section === 'billing' ? (
          <div className="settings-panel-content">
            <div className="settings-panel-header">
              <h2>Billing</h2>
              <p>Billing has not been configured for this desktop application.</p>
            </div>
            <div className="settings-panel-grid">
              <SettingsField label="Plan"><UnavailableValue>No billing plan available</UnavailableValue></SettingsField>
              <SettingsField label="Next invoice"><UnavailableValue>Not available</UnavailableValue></SettingsField>
              <SettingsField label="Payment method" full><UnavailableValue>Not available</UnavailableValue></SettingsField>
              <SettingsField label="Billing history" full><UnavailableValue>No invoices available</UnavailableValue></SettingsField>
            </div>
            <Button variant="dark" disabled>Manage billing</Button>
          </div>
        ) : null}

        {loadingError ? <p className="dashboard-form-error">{loadingError}</p> : null}
      </section>

      {confirmingSignOut ? (
        <ConfirmDialog
          title="Sign out?"
          message="You will need to sign back in to use Tracely again."
          confirmLabel="Sign out"
          busy={signOutBusy}
          onConfirm={() => void signOut()}
          onCancel={() => setConfirmingSignOut(false)}
        />
      ) : null}
    </div>
  )
}
