import { useState, type FormEvent, type RefObject } from 'react'
import { ArrowRight, Clipboard, LoaderCircle } from 'lucide-react'
import { tracelyApi } from '../../lib/api'
import ModeSelector, { type DashboardMode } from './ModeSelector'

export const MAX_CLAIM_CHARACTERS = 10_000

export default function ClaimInputCard({
  text,
  mode,
  loading,
  error,
  textareaRef,
  onTextChange,
  onModeChange,
  onSubmit
}: {
  text: string
  mode: DashboardMode
  loading: boolean
  error: string | null
  textareaRef: RefObject<HTMLTextAreaElement>
  onTextChange: (text: string) => void
  onModeChange: (mode: DashboardMode) => void
  onSubmit: () => void
}): JSX.Element {
  const [pasting, setPasting] = useState(false)
  const [pasteError, setPasteError] = useState<string | null>(null)

  async function pasteFromClipboard(): Promise<void> {
    setPasting(true)
    setPasteError(null)
    try {
      const response = await tracelyApi.readClipboard()
      onTextChange(response.text.slice(0, MAX_CLAIM_CHARACTERS))
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (caught) {
      setPasteError(caught instanceof Error ? caught.message : 'Unable to read the clipboard.')
    } finally {
      setPasting(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    onSubmit()
  }

  return (
    <section className="dashboard-claim-card" aria-labelledby="claim-input-title">
      <div className="dashboard-card-heading">
        <h2 id="claim-input-title">Check a claim or passage</h2>
        <p>
          Paste text below and Tracely will find the factual claims, search real evidence, and show what holds up.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className={`dashboard-textarea-shell ${error ? 'has-error' : ''}`}>
          <textarea
            ref={textareaRef}
            value={text}
            maxLength={MAX_CLAIM_CHARACTERS}
            aria-label="Claim or passage to check"
            aria-describedby={error ? 'dashboard-input-error' : 'dashboard-character-count'}
            aria-invalid={Boolean(error)}
            placeholder="Paste a claim, paragraph, or research passage here…"
            onChange={(event) => onTextChange(event.target.value.slice(0, MAX_CLAIM_CHARACTERS))}
          />
          <div className="dashboard-textarea-footer">
            <button
              type="button"
              className="dashboard-paste-button"
              disabled={pasting || loading}
              onClick={() => void pasteFromClipboard()}
            >
              <Clipboard size={15} />
              {pasting ? 'Pasting…' : 'Paste'}
            </button>
            <span id="dashboard-character-count" className="dashboard-character-count" aria-live="polite">
              {text.length.toLocaleString()} / 10,000
            </span>
          </div>
        </div>

        {error ? (
          <p id="dashboard-input-error" className="dashboard-form-error" role="alert">
            {error}
          </p>
        ) : pasteError ? (
          <p className="dashboard-form-error" role="alert">
            {pasteError}
          </p>
        ) : null}

        <div className="dashboard-claim-actions">
          <ModeSelector value={mode} onChange={onModeChange} />
          <button
            type="submit"
            className="dashboard-check-button"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? <LoaderCircle className="dashboard-spin" size={18} /> : null}
            {loading ? 'Checking…' : 'Check Text'}
            {!loading ? <ArrowRight size={18} strokeWidth={2.2} /> : null}
          </button>
        </div>
      </form>
    </section>
  )
}
