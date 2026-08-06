import { useEffect, useState } from 'react'
import type { AuthUser } from '@shared/types'
import figmaLogo from '../assets/figma-logo.png'
import { tracelyApi } from '../lib/api'

// The full-screen gate shown before anything else in the main window —
// nothing past this point is reachable while signed out. Google accounts
// arrive with a name already; password accounts collect one here so
// HomeView always has a real first name to greet with (see App.tsx's
// firstName-missing fallback for the rare account that still lacks one).
export default function LoginView({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }): JSX.Element {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  // Separate from `busy`: the Google flow hands off to the system browser,
  // and if the OAuth attempt fails there (e.g. a provider misconfigured on
  // Supabase's side), the app has no way to find out — nothing ever calls
  // back. So this only reflects the brief moment of asking the main process
  // to open the browser, never blocks retrying, and the notice below always
  // comes with a way to dismiss it and try again.
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Google's OAuth redirect completes entirely in the main process (see
  // main/index.ts) — this is the only way a failure there (expired code,
  // storage mismatch, etc.) ever reaches this screen instead of vanishing
  // into the main-process log with the button stuck on "Opening browser…".
  useEffect(
    () =>
      tracelyApi.onAuthOAuthError((message) => {
        setNotice(null)
        setError(message)
      }),
    []
  )

  const canSubmit =
    !busy && email.trim() && password.length >= 6 && (mode === 'signIn' || firstName.trim().length > 0)

  function resetMessages(): void {
    setError(null)
    setNotice(null)
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return
    resetMessages()
    setBusy(true)
    try {
      if (mode === 'signIn') {
        const res = await tracelyApi.signIn(email.trim(), password)
        if (res.user) onSignedIn(res.user)
      } else {
        const res = await tracelyApi.signUp(email.trim(), password, firstName.trim())
        if (res.user) {
          onSignedIn(res.user)
        } else {
          setNotice('Check your email to confirm your account, then sign in.')
          setMode('signIn')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function googleSignIn(): Promise<void> {
    resetMessages()
    setGoogleBusy(true)
    try {
      await tracelyApi.signInWithGoogle()
      setNotice('Continue in the browser window that just opened, then come back here.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGoogleBusy(false)
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

          <div className="login-tabs">
            <button className={mode === 'signIn' ? 'active' : ''} onClick={() => setMode('signIn')}>
              Login
            </button>
            <button className={mode === 'signUp' ? 'active' : ''} onClick={() => setMode('signUp')}>
              Create Account
            </button>
          </div>

          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            {mode === 'signUp' ? (
              <label className="login-field">
                <span>Your name</span>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  autoComplete="given-name"
                />
              </label>
            ) : null}
            <label className="login-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <label className="login-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              />
            </label>

            <button type="submit" className="btn btn-primary login-submit" disabled={!canSubmit}>
              {busy ? 'Please wait…' : mode === 'signIn' ? 'Login' : 'Create Account'}
            </button>
          </form>

          <div className="login-divider">
            <span>or</span>
          </div>

          <button className="btn btn-secondary login-google" onClick={googleSignIn} disabled={googleBusy}>
            {googleBusy ? 'Opening browser…' : 'Continue with Google'}
          </button>

          {error ? (
            <p className="error-text login-message">
              {error}{' '}
              <button type="button" className="login-message-retry" onClick={resetMessages}>
                Try again
              </button>
            </p>
          ) : null}
          {notice ? (
            <p className="muted login-message">
              {notice}{' '}
              <button type="button" className="login-message-retry" onClick={resetMessages}>
                Dismiss
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
