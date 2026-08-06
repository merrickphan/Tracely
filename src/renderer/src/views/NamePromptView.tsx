import { useState } from 'react'
import type { AuthUser } from '@shared/types'
import figmaLogo from '../assets/figma-logo.png'
import { tracelyApi } from '../lib/api'

// Shown instead of the main app for the rare signed-in account that has no
// first name on file yet — a legacy password account from before this field
// existed, or a Google account with no name set. Same gate mechanism as
// LoginView, just one field.
export default function NamePromptView({ onDone }: { onDone: (user: AuthUser) => void }): JSX.Element {
  const [firstName, setFirstName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    if (!firstName.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await tracelyApi.updateAuthName(firstName.trim())
      if (res.user) onDone(res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="home-view">
      <div className="home-canvas login-canvas">
        <div className="login-card">
          <div className="login-brand">
            <img src={figmaLogo} alt="" className="login-logo" />
            <span className="login-title">Tracely</span>
          </div>
          <p className="login-name-prompt-copy">One last thing — what should Tracely call you?</p>
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <label className="login-field">
              <span>Your name</span>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                autoComplete="given-name"
                autoFocus
              />
            </label>
            <button type="submit" className="btn btn-primary login-submit" disabled={!firstName.trim() || busy}>
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </form>
          {error ? <p className="error-text login-message">{error}</p> : null}
        </div>
      </div>
    </div>
  )
}
