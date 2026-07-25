import { useEffect, useState } from 'react'
import type { LibraryItem } from '@shared/types'
import SourceListItem from '../components/SourceListItem'
import { tracelyApi } from '../lib/api'

export default function LibraryView(): JSX.Element {
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load(): Promise<void> {
    try {
      const res = await tracelyApi.listLibrary(search || undefined)
      setItems(res.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleRemoved(id: string): void {
    setItems((prev) => prev?.filter((i) => i.id !== id) ?? null)
  }

  return (
    <div className="library-view">
      <div className="library-search">
        <input
          type="text"
          placeholder="Search saved sources…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {items && items.length === 0 ? (
        <p className="muted">No saved sources yet. Save evidence from the Analyze tab to build your library.</p>
      ) : null}
      {items ? (
        <div className="library-list">
          {items.map((item) => (
            <SourceListItem key={item.id} item={item} onRemoved={handleRemoved} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
