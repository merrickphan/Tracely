import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * "Save changes" — Figma 212:65 (Frame 5).
 *
 * Its own component rather than a variant of ConfirmDialog, because the two
 * disagree about which button is loud and only one of them can be right per
 * dialog. ConfirmDialog guards destructive, irreversible actions (sign out,
 * delete account, clear all data) and gives the quiet ghost treatment to Cancel
 * and the heavy one to Confirm. This frame does the opposite: Cancel is the
 * orange gradient pill and Confirm is grey.
 *
 * That inversion is the design's, and it is kept, because saving is not
 * destructive and the frame is explicit about it. Making ConfirmDialog capable
 * of both would have put a bright, inviting Cancel one prop away from the
 * delete-account dialog, which is not a mistake worth leaving lying around.
 *
 * The "Do not show anymore" tick persists to `suppressSaveConfirm` in settings,
 * so the confirm can be switched off for good. A confirmation nobody can
 * disable is one people learn to click through without reading.
 */
export default function SaveChangesDialog({
  message = 'Are you sure you want to save your changes?',
  busy = false,
  onConfirm,
  onCancel
}: {
  message?: string
  busy?: boolean
  /** `suppress` is the checkbox state at the moment Confirm was pressed. */
  onConfirm: (suppress: boolean) => void
  onCancel: () => void
}): JSX.Element {
  const [suppress, setSuppress] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div
        className="modal-card savechanges-card"
        role="alertdialog"
        aria-modal="true"
        aria-label="Save changes"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 className="savechanges-title">Save changes</h4>
        <p className="savechanges-message">{message}</p>

        <label className="savechanges-check">
          <input
            type="checkbox"
            checked={suppress}
            onChange={(e) => setSuppress(e.target.checked)}
            disabled={busy}
          />
          <span className="savechanges-box" aria-hidden="true" />
          Do not show anymore
        </label>

        <div className="savechanges-actions">
          <button className="savechanges-btn cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="savechanges-btn confirm" onClick={() => onConfirm(suppress)} disabled={busy}>
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
