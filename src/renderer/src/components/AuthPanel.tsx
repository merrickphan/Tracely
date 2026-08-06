import { useState } from 'react'
import type { AuthUser } from '@shared/types'
import Button from './Button'
import { tracelyApi } from '../lib/api'

// The app requires signing in before the main UI is reachable at all (see
// App.tsx), so by the time this renders there is always a real user — this
// is the account-identity surface (email, username). Sign out lives only in
// the sidebar footer (one control, not two); account deletion lives in
// DangerZone at the bottom of the Profile section, not up here.
export default function AuthPanel({ user }: { user: AuthUser }): JSX.Element {
  const [username, setUsername] = useState(user.username ?? '')
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameSaved, setUsernameSaved] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)

  const trimmedUsername = username.trim()
  const usernameDirty = trimmedUsername.length > 0 && trimmedUsername !== (user.username ?? '')

  async function saveUsername(): Promise<void> {
    if (!usernameDirty || usernameSaving) return
    setUsernameSaving(true)
    setUsernameError(null)
    try {
      await tracelyApi.updateAuthUsername(trimmedUsername)
      setUsernameSaved(true)
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : String(err))
    } finally {
      setUsernameSaving(false)
    }
  }

  return (
    <div className="auth-panel">
      <div className="settings-panel-header">
        <h3>Account</h3>
        <p>Your real, unique Tracely account.</p>
      </div>

      <div className="auth-panel-row">
        <span className="auth-panel-row-label">Email</span>
        <span className="auth-panel-row-value">{user.email ?? '—'}</span>
      </div>

      <form
        className="auth-panel-row"
        onSubmit={(e) => {
          e.preventDefault()
          void saveUsername()
        }}
      >
        <span className="auth-panel-row-label">Username</span>
        <div className="auth-panel-username-edit">
          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              setUsernameSaved(false)
              setUsernameError(null)
            }}
            placeholder="Choose a username"
            maxLength={255}
          />
          <Button type="submit" variant="secondary" disabled={!usernameDirty || usernameSaving}>
            {usernameSaving ? 'Saving…' : usernameSaved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </form>
      {usernameError ? (
        <p className="error-text">{usernameError}</p>
      ) : (
        <p className="muted auth-panel-hint">Defaults to your email until you set your own.</p>
      )}
    </div>
  )
}
