import { useState } from 'react'
import type { EvidenceItem } from '@shared/types'
import { folioApi } from '../lib/api'
import Button from './Button'
import CitationBlock from './CitationBlock'

function authorNames(item: EvidenceItem): string {
  if (!item.source.authors.length) return 'Unknown author'
  return item.source.authors
    .slice(0, 3)
    .map((a) => (a.given ? `${a.given} ${a.family}` : a.family))
    .join(', ')
}

export default function EvidenceCard({
  item,
  claimId
}: {
  item: EvidenceItem
  claimId: string
}): JSX.Element {
  const [showCitation, setShowCitation] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function saveToLibrary(): Promise<void> {
    setSaving(true)
    try {
      await folioApi.saveToLibrary(item.source.id, claimId)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const { source } = item

  return (
    <div className="evidence-card">
      <div className="evidence-title">
        {source.url ? (
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
        ) : (
          source.title
        )}
      </div>
      <div className="evidence-meta">
        {authorNames(item)}
        {source.year ? ` · ${source.year}` : ''}
        {source.venue ? ` · ${source.venue}` : ''}
        {source.venueType ? ` · ${source.venueType}` : ''}
      </div>
      {source.abstract ? <p className="evidence-abstract">{source.abstract.slice(0, 280)}…</p> : null}
      <div className="evidence-actions">
        <Button variant="ghost" onClick={() => setShowCitation((v) => !v)}>
          {showCitation ? 'Hide citation' : 'Cite'}
        </Button>
        <Button variant="ghost" onClick={saveToLibrary} disabled={saving || saved}>
          {saved ? 'Saved' : 'Save to Library'}
        </Button>
      </div>
      {showCitation ? <CitationBlock sourceId={source.id} /> : null}
    </div>
  )
}
