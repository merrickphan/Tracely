import { useState } from 'react'
import type { AuthUser } from '@shared/types'
import Button from './Button'
import ConfirmDialog from './ConfirmDialog'
import { tracelyApi } from '../lib/api'

// Rendered at the very bottom of the Profile section, below everything
// else — irreversible account actions belong last, not competing for
// attention with routine edits like name/bio at the top of the page.
export default function DangerZone({ user }: { user: AuthUser }): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function deleteAccount(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await tracelyApi.deleteAuthAccount()
      // Success drives the gate back to LoginView via the auth-state-changed
      // event, so there's no "success" branch to reset local state here.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="danger-zone">
      <div className="danger-zone-header">
        <h4>Danger Zone</h4>
      </div>
      <div className="danger-zone-row">
        <div>
          <div className="danger-zone-row-title">Delete account</div>
          <div className="danger-zone-row-subtitle">
            Permanently deletes your Tracely account and signs you out everywhere. This cannot be undone.
          </div>
        </div>
        <Button variant="danger" onClick={() => setConfirming(true)} disabled={busy}>
          Delete account
        </Button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}

      {confirming ? (
        <ConfirmDialog
          title="Delete your account?"
          message={`This permanently deletes ${user.email ?? 'your account'} and everything tied to it — this cannot be undone. Type DELETE to confirm.`}
          confirmLabel="Delete account"
          danger
          busy={busy}
          requireText="DELETE"
          onConfirm={deleteAccount}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  )
}
