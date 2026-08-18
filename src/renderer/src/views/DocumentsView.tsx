import { useEffect, useState } from 'react'
import type { DocumentListItem } from '@shared/types'
import type { Tab } from '../App'
import { gradeFor } from '../components/essayGrade'
import { tracelyApi } from '../lib/api'
import { documentSort, gradedOn, type DocumentSort } from '../components/documentSort'

/**
 * Every essay Tracely has graded — Figma "DocumentsPage" (58:172).
 *
 * This replaced the Analyze view's landing, which was a text field and a
 * "Create Document" button. That screen asked for a name before it would let
 * anyone type, and it was the only way back to work you had already done: the
 * documents existed in SQLite but nothing listed them, so reopening a draft
 * meant it happening to be the most recent one. The frame answers both — the
 * grid IS the list, and "+ New document" starts an "Untitled document" and goes
 * straight to the editor, where the title is editable inline.
 *
 * Every measurement below is the frame's own, read with get_design_context
 * rather than taken off a screenshot: 181.5x200 cards on a 197.5px pitch, a
 * 122px thumbnail, a 34x22 chip at 6px radius, 13px titles and 11px dates.
 *
 * The grade is not computed here. `gradeFor` is the same function the Screen
 * Watch grade panel and the in-app modal use, so one draft cannot carry two
 * letters across three surfaces — the same rule as problemCopy.ts.
 */

/** The frame's card geometry. A grid, not absolute positions: the design lays
 *  four columns at a fixed pitch, and a grid reproduces that while letting the
 *  row count follow the data instead of the mockup's eight. */
const CARD_WIDTH = 181.5
const CARD_GAP = 16
const THUMB_HEIGHT = 122

/** The chip's two palettes, read off the frame: green for the A band, amber for
 *  everything below it. The design only draws those two, and inventing a third
 *  for C/D/F is exactly the near-miss-palette mistake CLAUDE.md records. */
const CHIP_GREEN = { bg: '#e9f6ec', fg: '#168449' }
const CHIP_AMBER = { bg: '#fef5e9', fg: '#cb5c19' }

function chipColors(letter: string): { bg: string; fg: string } {
  return letter.startsWith('A') ? CHIP_GREEN : CHIP_AMBER
}

/**
 * The skeleton bars in the card's thumbnail.
 *
 * The frame draws five grey bars at fixed widths rather than a rendering of the
 * document, and they are kept as drawn. A real thumbnail would mean
 * rasterising the body HTML per card on every open of this page, and the design
 * is not trying to show the text — it is showing that the card is a document.
 */
const THUMB_BARS = [110.25, 133.875, 94.5, 126, 78.75]

function DocumentCard({
  document: doc,
  onOpen
}: {
  document: DocumentListItem
  onOpen: () => void
}): JSX.Element {
  const grade = doc.score === null ? null : gradeFor(doc.score)
  const chip = grade ? chipColors(grade.letter) : null

  return (
    <button className="docs-card" onClick={onOpen} title={`Open ${doc.title}`}>
      <span className="docs-card-thumb" aria-hidden="true">
        {THUMB_BARS.map((width, i) => (
          <span key={i} className="docs-card-bar" style={{ width }} />
        ))}
        {grade && chip ? (
          <span className="docs-card-chip" style={{ background: chip.bg, color: chip.fg }}>
            {grade.letter}
          </span>
        ) : null}
      </span>
      <span className="docs-card-title">{doc.title}</span>
      {/* "Not graded yet" rather than an empty line or a dash: a draft nothing
          has read is a normal state, and the card should say which state it is
          in rather than leaving a gap where every other card has a date. */}
      <span className="docs-card-date">
        {doc.gradedAt ? `Graded ${gradedOn(doc.gradedAt)}` : 'Not graded yet'}
      </span>
    </button>
  )
}

export default function DocumentsView({
  onNavigate,
  onOpenDocument
}: {
  onNavigate: (tab: Tab) => void
  /** Null means "start a new one". The editor owns creation; this page only
   *  decides which document it should open with. */
  onOpenDocument: (id: string | null) => void
}): JSX.Element {
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null)
  const [sort, setSort] = useState<DocumentSort>('recent')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    tracelyApi
      .listDocuments()
      .then((res) => {
        if (!cancelled) setDocuments(res.documents)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const sorted = documents ? documentSort(documents, sort) : []

  return (
    <div className="docs-view">
      <button className="docs-back" onClick={() => onNavigate('home')}>
        ← Back
      </button>

      <div className="docs-head">
        <div className="docs-head-text">
          <h1 className="docs-title">Documents</h1>
          <p className="docs-subtitle">Every essay Tracely has graded, in one place.</p>
        </div>
        <div className="docs-head-actions">
          <button className="docs-new" onClick={() => onOpenDocument(null)}>
            + New document
          </button>
          {/* A real <select>. The frame draws a pill with a chevron, which is
              what a select already is — and building a custom menu here would
              mean re-implementing keyboard handling for a control the platform
              gives us correct. */}
          <select
            className="docs-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as DocumentSort)}
            aria-label="Sort documents"
          >
            <option value="recent">Recently opened</option>
            <option value="graded">Recently graded</option>
            <option value="score">Highest score</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {documents === null && !error ? <p className="muted docs-empty">Loading…</p> : null}

      {documents !== null && documents.length === 0 ? (
        <p className="muted docs-empty">
          No documents yet. Start one and Tracely will grade it as you write.
        </p>
      ) : null}

      <div className="docs-grid">
        {sorted.map((doc) => (
          <DocumentCard key={doc.id} document={doc} onOpen={() => onOpenDocument(doc.id)} />
        ))}
      </div>
    </div>
  )
}

export { CARD_WIDTH, CARD_GAP, THUMB_HEIGHT }
