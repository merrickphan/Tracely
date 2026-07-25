import { useState } from 'react'
import type { LibraryItem } from '@shared/types'
import { tracelyApi } from '../lib/api'
import Button from './Button'
import CitationBlock from './CitationBlock'

export default function SourceListItem({
  item,
  onRemoved
}: {
  item: LibraryItem
  onRemoved: (id: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function remove(): Promise<void> {
    setRemoving(true)
    try {
      await tracelyApi.removeLibraryItem(item.id)
      onRemoved(item.id)
    } finally {
      setRemoving(false)
    }
  }

  const { source } = item

  return (
    <div className="source-list-item">
      <div className="source-title" onClick={() => setExpanded((v) => !v)}>
        {source.title}
      </div>
      <div className="evidence-meta">
        {source.year ? `${source.year} · ` : ''}
        {source.venue ?? source.provider}
      </div>
      {item.tags.length ? (
        <div className="tag-row">
          {item.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {item.notes ? <p className="muted">{item.notes}</p> : null}
      <div className="evidence-actions">
        <Button variant="ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Hide citation' : 'Cite'}
        </Button>
        <Button variant="danger" onClick={remove} disabled={removing}>
          Remove
        </Button>
      </div>
      {expanded ? <CitationBlock sourceId={source.id} /> : null}
    </div>
  )
}
