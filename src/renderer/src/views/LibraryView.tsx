import { useCallback, useEffect, useState } from 'react'
import type { LibraryItem } from '@shared/types'
import type { Tab } from '../App'
import Button from '../components/Button'
import CitationBlock from '../components/CitationBlock'
import ConfirmDialog from '../components/ConfirmDialog'
import { BackIcon } from '../components/icons'
import { tracelyApi } from '../lib/api'

// The reader for a subsystem that was write-only.
//
// `library.save` had one caller (EvidenceCard's "Save to Library"), and
// `list` / `get` / `update` / `remove` had none — implemented all the way down
// through preload, IPC, handler and repo, and unreachable from any screen. So
// saving a source wrote a row nobody could ever see again, and the button
// flipped to a permanent disabled "Saved" with no way to undo it.
//
// Nothing new was needed in the main process for this: the repo already
// supports search and tag filtering.

function authorLine(item: LibraryItem): string {
  const authors = item.source.authors
  if (authors.length === 0) return 'Unknown author'
  const names = authors.slice(0, 3).map((a) => (a.given ? `${a.given} ${a.family}` : a.family))
  return authors.length > 3 ? `${names.join(', ')} et al.` : names.join(', ')
}

function savedOn(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function LibraryRow({
  item,
  onRemove,
  onNotesSaved
}: {
  item: LibraryItem
  onRemove: () => void
  onNotesSaved: (updated: LibraryItem) => void
}): JSX.Element {
  const [showCitation, setShowCitation] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notes, setNotes] = useState(item.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveNotes(): Promise<void> {
    setSavingNotes(true)
    setError(null)
    try {
      const res = await tracelyApi.updateLibraryItem(item.id, notes)
      onNotesSaved(res.item)
      setEditingNotes(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingNotes(false)
    }
  }

  const { source } = item

  return (
    <article className="library-row">
      <div className="library-row-head">
        <h3 className="library-row-title">
          {source.url ? (
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title}
            </a>
          ) : (
            source.title
          )}
        </h3>
        <span className="library-row-saved">{savedOn(item.savedAt)}</span>
      </div>

      <p className="library-row-meta">
        {authorLine(item)}
        {source.year ? ` · ${source.year}` : ''}
        {source.venue ? ` · ${source.venue}` : ''}
        {/* Only shown when it is actually known to be open access — an absent
            oaStatus means "not checked", not "paywalled". */}
        {source.oaStatus && source.oaStatus !== 'closed' ? (
          <span className="library-row-oa">Free to read</span>
        ) : null}
      </p>

      {editingNotes ? (
        <div className="library-row-notes-edit">
          <textarea
            value={notes}
            placeholder="Why did you save this?"
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="library-row-actions">
            <Button variant="dark" onClick={saveNotes} disabled={savingNotes}>
              {savingNotes ? 'Saving…' : 'Save note'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setNotes(item.notes ?? '')
                setEditingNotes(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : item.notes ? (
        <p className="library-row-notes">{item.notes}</p>
      ) : null}

      {item.tags.length > 0 ? (
        <div className="library-row-tags">
          {item.tags.map((t) => (
            <span key={t} className="library-row-tag">
              {t}
            </span>
          ))}
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <div className="library-row-actions">
        <Button variant="secondary" onClick={() => setShowCitation((v) => !v)}>
          {showCitation ? 'Hide citation' : 'Cite'}
        </Button>
        {!editingNotes ? (
          <Button variant="secondary" onClick={() => setEditingNotes(true)}>
            {item.notes ? 'Edit note' : 'Add note'}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onRemove}>
          Remove
        </Button>
      </div>

      {showCitation ? <CitationBlock sourceId={source.id} /> : null}
    </article>
  )
}

export default function LibraryView({ onNavigate }: { onNavigate: (tab: Tab) => void }): JSX.Element {
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<LibraryItem | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  const load = useCallback(async (query: string): Promise<void> => {
    setError(null)
    try {
      const res = await tracelyApi.listLibrary(query.trim() || undefined)
      setItems(res.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setItems([])
    }
  }, [])

  useEffect(() => {
    void load('')
  }, [load])

  // Debounced so typing does not re-query the database on every keystroke —
  // every db.run() re-serializes the whole SQLite image (see storage/db.ts).
  useEffect(() => {
    const id = window.setTimeout(() => void load(search), 220)
    return () => window.clearTimeout(id)
  }, [search, load])

  async function confirmRemove(): Promise<void> {
    if (!removing) return
    setRemoveBusy(true)
    try {
      await tracelyApi.removeLibraryItem(removing.id)
      setItems((prev) => (prev ?? []).filter((i) => i.id !== removing.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoveBusy(false)
      setRemoving(null)
    }
  }

  return (
    <div className="library-view">
      <button className="analyze-back" onClick={() => onNavigate('home')}>
        <BackIcon size={13} />
        Back
      </button>

      <section className="library-body">
        <header className="library-header">
          <h2>Library</h2>
          <p className="muted">
            Sources you saved while checking a claim. Everything here is stored on this machine only.
          </p>
        </header>

        <input
          className="library-search"
          value={search}
          placeholder="Search titles, authors and notes…"
          onChange={(e) => setSearch(e.target.value)}
        />

        {error ? <p className="error-text">{error}</p> : null}

        {items === null ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted library-empty">
            {search.trim()
              ? `Nothing saved matches “${search.trim()}”.`
              : 'Nothing saved yet. When Tracely finds evidence for a claim, “Save to Library” on a source keeps it here.'}
          </p>
        ) : (
          items.map((item) => (
            <LibraryRow
              key={item.id}
              item={item}
              onRemove={() => setRemoving(item)}
              onNotesSaved={(updated) =>
                setItems((prev) => (prev ?? []).map((i) => (i.id === updated.id ? updated : i)))
              }
            />
          ))
        )}
      </section>

      {removing ? (
        <ConfirmDialog
          title="Remove from library?"
          message={`“${removing.source.title}” will be removed. The source itself stays in any analysis that used it.`}
          confirmLabel="Remove"
          danger
          busy={removeBusy}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </div>
  )
}
