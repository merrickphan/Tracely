import { useState } from 'react'
import type { CitationStyle } from '@shared/types'
import { folioApi } from '../lib/api'
import Button from './Button'

const STYLES: CitationStyle[] = ['APA', 'MLA', 'Chicago']

export default function CitationBlock({ sourceId }: { sourceId: string }): JSX.Element {
  const [style, setStyle] = useState<CitationStyle>('APA')
  const [citation, setCitation] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate(nextStyle: CitationStyle): Promise<void> {
    setStyle(nextStyle)
    setLoading(true)
    setError(null)
    setCopied(false)
    try {
      const res = await folioApi.generateCitation(sourceId, nextStyle)
      setCitation(res.citation)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function copy(): Promise<void> {
    if (!citation) return
    await folioApi.writeClipboard(citation)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="citation-block">
      <div className="citation-style-picker">
        {STYLES.map((s) => (
          <Button
            key={s}
            variant={s === style && citation ? 'primary' : 'ghost'}
            onClick={() => generate(s)}
            disabled={loading}
          >
            {s}
          </Button>
        ))}
      </div>
      {loading ? <p className="muted">Generating…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {citation ? (
        <div className="citation-result">
          <code>{citation}</code>
          <Button variant="ghost" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
