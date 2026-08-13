import { useCallback, useEffect, useRef, useState } from 'react'
import type { Claim, DocumentRecord } from '@shared/types'
import ClaimCard from '../components/ClaimCard'
import Button from '../components/Button'
import TextArea from '../components/TextArea'
import { DocumentIcon, ClipboardIcon, CloseIcon, BackIcon } from '../components/icons'
import { tracelyApi } from '../lib/api'
import type { Tab } from '../App'

type SourceType = 'document' | 'text'

// No "URL / Link" tile. It never fetched anything: selecting it only changed
// the placeholder, and submitting sent the URL *string* to the paid relay as
// prose — which sentence-splits into one "sentence" of URL characters, finds no
// checkable claim, and shows "No checkable claims detected in this text." So it
// cost money to produce a false negative, while the CTA said "Import Link" and
// the progress bar said "Reading source content".
//
// Building it for real needs an HTML extraction dependency and would widen the
// "academic APIs + relay only" network promise in CLAUDE.md to arbitrary URLs.
// That is a design decision, not a bug fix. Screen Watch already reads whatever
// page you actually have open.
const SOURCE_TILES: { id: SourceType; label: string; icon: (props: { size?: number }) => JSX.Element }[] = [
  { id: 'document', label: 'Document', icon: DocumentIcon },
  { id: 'text', label: 'Paste text', icon: ClipboardIcon }
]

const SOURCE_PLACEHOLDER: Record<SourceType, string> = {
  document: 'Name your document…',
  text: 'Paste your text here…'
}

const SOURCE_CTA: Record<SourceType, string> = {
  document: 'Create Document',
  text: 'Begin analysis'
}

// The real detectClaims call is a single opaque request with no backend
// sub-progress to report. Rather than faking fixed percentages on a timer
// (which either stalls at "100% complete" while still waiting, or finishes
// before the real call does), the bar's percent tracks actual elapsed time
// with an asymptotic curve that approaches but never reaches 100% — it only
// ever disappears when the real response has actually landed.
const ANALYZING_EXPECTED_MS = 6000
const ANALYZING_TICK_MS = 200
const ANALYZING_MAX_PERCENT = 96

function AnalyzingPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedMs((ms) => ms + ANALYZING_TICK_MS)
    }, ANALYZING_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const percent = Math.round((1 - Math.exp(-elapsedMs / ANALYZING_EXPECTED_MS)) * ANALYZING_MAX_PERCENT)

  return (
    <>
      <button className="analyze-close" onClick={onClose} aria-label="Close">
        <CloseIcon size={16} />
      </button>
      <div className="analyzing-panel">
        <div className="analyzing-spinner-ring" />
        <h3>Detecting claims</h3>
        {/*
          Says what this stage actually does. It was "Analyzing your source" over
          a four-item checklist reading "Reading source content",
          "Cross-referencing credible sources" and "Generating citations" — none
          of which happen here. This is one relay call that finds claims;
          evidence search and citations run later, on demand. In an app whose
          product promise is not overstating what the evidence says, a progress
          bar narrating work it is not doing is the worst possible place to fake
          it. The percentage stays: it tracks real elapsed time on an asymptotic
          curve and only disappears when the response actually lands.
        */}
        <p>Tracely is reading your text for checkable claims.</p>
        <div className="analyzing-progress-track">
          <div className="analyzing-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="analyzing-progress-label">{percent}%</p>
      </div>
    </>
  )
}

const FONT_FAMILIES = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana']
const FONT_SIZES = [10, 11, 12, 14, 16, 18, 24, 32]
const TEXT_COLORS = ['#212121', '#d93025', '#e37400', '#188038', '#1967d2', '#8430ce']
type Align = 'left' | 'center' | 'right'

// Matches the Figma "Untitled Doc" frame: a real writing surface (name +
// body actually persist and are what gets analyzed), with "AI Insights"
// wired to the same real detectClaims call the other source types use.
// Formatting (font, size, bold/italic/underline, color, alignment) is real
// too — applied via document.execCommand against the contentEditable body,
// the same mechanism every execCommand-based web editor (Gmail compose,
// etc.) still relies on in Chromium. The body is intentionally uncontrolled
// (DOM-managed, not React state) because a controlled contentEditable would
// reset the cursor position on every keystroke re-render.
function DocumentEditor({
  docName,
  onDocNameChange,
  onBack,
  onRunInsights,
  insightsLoading,
  claims,
  error,
  initialDoc,
  onSaved
}: {
  docName: string
  onDocNameChange: (v: string) => void
  onBack: () => void
  onRunInsights: (bodyText: string) => void
  insightsLoading: boolean
  claims: Claim[] | null
  error: string | null
  /** The document being reopened, or null for a new one. */
  initialDoc: DocumentRecord | null
  /** Every successful save, so the parent's idea of "the latest document"
   *  cannot go stale — it fetches once, and without this, leaving and
   *  re-entering the editor restored the body as it was at app start. */
  onSaved: (doc: DocumentRecord) => void
}): JSX.Element {
  const editorRef = useRef<HTMLDivElement>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const alignMenuRef = useRef<HTMLDivElement>(null)

  const [wordCount, setWordCount] = useState(0)
  const [fontFamily, setFontFamily] = useState('Arial')
  const [fontSize, setFontSize] = useState(11)
  const [format, setFormat] = useState({ bold: false, italic: false, underline: false })
  const [align, setAlign] = useState<Align>('left')
  const [alignMenuOpen, setAlignMenuOpen] = useState(false)

  // Pull the toolbar's lit/unlit state from the browser's own command state,
  // which is the only thing that actually knows it — execCommand('bold') with
  // a collapsed caret sets a *pending* typing style, so there is nothing in
  // the DOM to read and nothing React can derive it from.
  const syncFormatState = useCallback((): void => {
    const editor = editorRef.current
    if (!editor || document.activeElement !== editor) return
    const bold = document.queryCommandState('bold')
    const italic = document.queryCommandState('italic')
    const underline = document.queryCommandState('underline')
    // Functional + identity-preserving, because this also runs on every
    // keystroke: returning a fresh object literal unconditionally would
    // re-render the editor on each character for no reason.
    setFormat((prev) =>
      prev.bold === bold && prev.italic === italic && prev.underline === underline
        ? prev
        : { bold, italic, underline }
    )
    setAlign(
      document.queryCommandState('justifyCenter')
        ? 'center'
        : document.queryCommandState('justifyRight')
          ? 'right'
          : 'left'
    )
  }, [])

  useEffect(() => {
    function handleSelectionChange(): void {
      const editor = editorRef.current
      if (!editor || document.activeElement !== editor) return
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        savedRangeRef.current = sel.getRangeAt(0).cloneRange()
      }
      syncFormatState()
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [syncFormatState])

  useEffect(() => {
    if (!alignMenuOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (alignMenuRef.current && !alignMenuRef.current.contains(e.target as Node)) {
        setAlignMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [alignMenuOpen])

  function focusAndRestore(): void {
    const editor = editorRef.current
    if (!editor) return
    // Toolbar buttons use onMouseDown preventDefault so the editor never
    // actually loses focus/selection when clicked — re-applying the last
    // saved Range unconditionally would clobber that still-live selection
    // with a stale one (its nodes may no longer match after a prior
    // execCommand mutated the DOM, e.g. wrapping text in <b>), breaking
    // every format command after the first. Only restore when focus truly
    // left the editor (e.g. after picking a color from the native input).
    if (document.activeElement === editor) return
    editor.focus()
    const sel = window.getSelection()
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges()
      sel.addRange(savedRangeRef.current)
    }
  }

  function exec(command: string, value?: string): void {
    focusAndRestore()
    document.execCommand(command, false, value)
    // Toggling at a collapsed caret changes no selection, so no
    // 'selectionchange' event follows and the toolbar would stay unlit while
    // the command is genuinely active. Read the state back directly instead.
    syncFormatState()
  }

  function applyFontSize(px: number): void {
    setFontSize(px)
    focusAndRestore()
    // execCommand only accepts legacy sizes 1-7; apply one, then rewrite the
    // <font size="7"> it produces into a real px-based <span> so it composes
    // with the rest of the styling instead of the browser's fixed HTML sizes.
    document.execCommand('fontSize', false, '7')
    editorRef.current?.querySelectorAll('font[size="7"]').forEach((el) => {
      const span = document.createElement('span')
      span.style.fontSize = `${px}px`
      while (el.firstChild) span.appendChild(el.firstChild)
      el.replaceWith(span)
    })
  }

  function handleInput(): void {
    const editor = editorRef.current
    if (!editor) return
    const text = editor.innerText
    if (!text.trim() && editor.innerHTML !== '') {
      editor.innerHTML = ''
    }
    bodyHtmlRef.current = editor.innerHTML
    setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0)
    // Typing can end a pending style (Enter starts a fresh block), so the
    // toolbar has to follow the caret, not just explicit toolbar clicks.
    syncFormatState()
    queueSave()
  }

  const bodyText = (): string => editorRef.current?.innerText ?? ''

  // ---- Persistence -------------------------------------------------------
  //
  // The body lives in an uncontrolled contentEditable node (a controlled one
  // would reset the caret on every keystroke), which meant it existed ONLY in
  // that node: pressing Back unmounted the component and destroyed the work
  // with no warning, and reopening gave a blank editor.
  //
  // Autosave rather than a save button, because the thing that lost work was
  // a navigation the user had no reason to think was destructive.

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>(initialDoc ? 'saved' : 'idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read inside the debounced timer without making it a dependency.
  const docNameRef = useRef(docName)
  docNameRef.current = docName

  // The id of the row being written, in a ref rather than state.
  //
  // It was state, read through `flushSave`'s closure, and that produced a
  // duplicate document on the very first autosave by two separate routes:
  //
  //  1. Setting it changed `flushSave`'s identity, which re-ran the unmount
  //     effect below. Its cleanup saw `saveTimer.current` still holding the id
  //     of the timer that had *already fired* (a fired timeout's id stays
  //     truthy) and read that as "work is pending", calling the previous
  //     `flushSave` — still closed over `docId === null`, so it INSERTed again.
  //  2. Any keystroke while the first save was in flight scheduled a timer
  //     bound to the then-current closure, also with `docId === null`. It fired
  //     after the id had arrived and INSERTed a second row regardless.
  //
  // A ref fixes both at once: there is one authoritative id, no stale copy of
  // it can exist, and `flushSave` stops changing identity.
  const docIdRef = useRef<string | null>(initialDoc?.id ?? null)
  // Saves are chained rather than allowed to overlap. Two concurrent saves on
  // a new document would both read a null id and both INSERT — the same bug a
  // third way, and one a ref alone does not close.
  const inFlightRef = useRef<Promise<void>>(Promise.resolve())
  /**
   * The editor's HTML as of the last input event.
   *
   * `flushSave` cannot rely on `editorRef.current` alone. React detaches refs
   * during deletion but runs passive effect cleanups AFTER that, so by the time
   * the unmount cleanup below fires, `editorRef.current` is already null and
   * the save it exists to perform returns immediately without writing. Typing
   * and pressing Back inside the 900ms debounce lost the edit outright.
   *
   * Mirroring the html here costs one assignment per input event and makes the
   * flush independent of whether the node is still mounted.
   */
  const bodyHtmlRef = useRef<string>(initialDoc?.bodyHtml ?? '')

  const flushSave = useCallback((): Promise<void> => {
    const run = async (): Promise<void> => {
      // Prefer the live node when it is still mounted, since it is the truth;
      // fall back to the mirror when it is not, which is exactly the unmount
      // case this save has to survive.
      const bodyHtml = editorRef.current?.innerHTML ?? bodyHtmlRef.current
      // Never create a row for an editor the user opened and never typed in.
      if (!docIdRef.current && !bodyHtml.trim() && !docNameRef.current.trim()) return
      setSaveState('saving')
      try {
        const res = await tracelyApi.saveDocument({
          id: docIdRef.current,
          title: docNameRef.current,
          bodyHtml
        })
        // Before the awaits below, so anything queued behind this save already
        // sees an UPDATE target rather than inserting its own row.
        docIdRef.current = res.document.id
        onSaved(res.document)
        setSaveState('saved')
      } catch {
        // Leave the indicator off "saved" rather than claiming a save that did
        // not happen. The next keystroke retries.
        setSaveState('idle')
      }
    }
    // `run` on both settlements: one failed save must not stall the chain.
    const next = inFlightRef.current.then(run, run)
    inFlightRef.current = next
    return next
  }, [onSaved])

  // 900ms: long enough that a burst of typing is one write, short enough that
  // almost nothing is at risk. Every db.run() re-serializes the entire SQLite
  // image (storage/db.ts), so per-keystroke saving would rewrite the whole
  // database file per character.
  const queueSave = useCallback((): void => {
    setSaveState('idle')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      // Cleared before running, not after: the unmount cleanup treats a
      // truthy ref as "there is still pending work to flush", and a fired
      // timer's id stays truthy forever otherwise.
      saveTimer.current = null
      void flushSave()
    }, 900)
  }, [flushSave])

  // Restore the last document into the uncontrolled node exactly once.
  useEffect(() => {
    if (initialDoc && editorRef.current) {
      editorRef.current.innerHTML = initialDoc.bodyHtml
      handleInput()
    }
    // Mount only: re-running would clobber whatever the user has since typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A pending debounce must not be lost to unmount — that is the exact case
  // this whole section exists to fix. `flushSave` is identity-stable now, so
  // this runs on real unmount only, rather than re-running (and re-flushing)
  // every time the document id changed.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
        void flushSave()
      }
    }
  }, [flushSave])

  return (
    <div className="docedit-view">
      <div className="docedit-toolbar">
        <button className="docedit-back" onClick={onBack}>
          <BackIcon size={12} />
          Back
        </button>
        <div className="docedit-divider" />
        <DocumentIcon size={16} className="docedit-icon" />
        <input
          className="docedit-name"
          placeholder="Doc name"
          value={docName}
          onChange={(e) => {
            onDocNameChange(e.target.value)
            // Renaming is an edit too — it used to feed nothing but this input.
            queueSave()
          }}
        />
        <div className="docedit-divider" />
        <select
          className="docedit-fontname"
          value={fontFamily}
          onChange={(e) => {
            setFontFamily(e.target.value)
            exec('fontName', e.target.value)
          }}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          className="docedit-fontsize"
          value={fontSize}
          onChange={(e) => applyFontSize(Number(e.target.value))}
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          className={`docedit-toolbtn bold ${format.bold ? 'active' : ''}`}
          aria-pressed={format.bold}
          title="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('bold')}
        >
          B
        </button>
        <button
          className={`docedit-toolbtn underline ${format.underline ? 'active' : ''}`}
          aria-pressed={format.underline}
          title="Underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('underline')}
        >
          U
        </button>
        <button
          className={`docedit-toolbtn italic ${format.italic ? 'active' : ''}`}
          aria-pressed={format.italic}
          title="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('italic')}
        >
          I
        </button>
        <button
          className="docedit-toolbtn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => colorInputRef.current?.click()}
          title="Text color"
        >
          A
        </button>
        <input
          ref={colorInputRef}
          type="color"
          className="docedit-color-input"
          list="docedit-color-presets"
          onChange={(e) => exec('foreColor', e.target.value)}
        />
        <datalist id="docedit-color-presets">
          {TEXT_COLORS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="docedit-align-wrap" ref={alignMenuRef}>
          <button
            className="docedit-toolbtn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAlignMenuOpen((o) => !o)}
            title="Align text"
          >
            ≡
          </button>
          {alignMenuOpen ? (
            <div className="docedit-align-menu">
              <button
                className={align === 'left' ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  exec('justifyLeft')
                  setAlign('left')
                  setAlignMenuOpen(false)
                }}
              >
                Left
              </button>
              <button
                className={align === 'center' ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  exec('justifyCenter')
                  setAlign('center')
                  setAlignMenuOpen(false)
                }}
              >
                Center
              </button>
              <button
                className={align === 'right' ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  exec('justifyRight')
                  setAlign('right')
                  setAlignMenuOpen(false)
                }}
              >
                Right
              </button>
            </div>
          ) : null}
        </div>
        <div className="docedit-spacer" />
        <span className="docedit-savestate">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
        </span>
        <button
          className="docedit-insights"
          onClick={() => onRunInsights(bodyText())}
          disabled={insightsLoading || !bodyText().trim()}
        >
          {insightsLoading ? 'Analyzing…' : 'AI Insights'}
        </button>
        {/*
          "Share" and "•••" were here, permanently disabled with "isn't
          available yet". Same reasoning that already removed Share from
          Tracer's action row: local-first, no account, no permalink, nothing to
          share TO. A button that can never be enabled is worse than no button —
          it takes up space promising something that is not coming.
        */}
      </div>

      <div className="docedit-body-wrap">
        <div
          ref={editorRef}
          className="docedit-body"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Start typing…"
          onInput={handleInput}
        />
      </div>

      <div className="docedit-wordcount">
        <b>{wordCount}</b> words
      </div>

      {error ? <p className="error-text docedit-error">{error}</p> : null}

      {claims && claims.length === 0 ? <p className="muted docedit-error">No checkable claims detected.</p> : null}

      {claims && claims.length > 0 ? (
        <section className="docedit-results">
          {claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </section>
      ) : null}
    </div>
  )
}

export default function AnalyzeView({ onNavigate }: { onNavigate: (tab: Tab) => void }): JSX.Element {
  const [sourceType, setSourceType] = useState<SourceType>('document')
  const sourceInputRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [docEditorOpen, setDocEditorOpen] = useState(false)
  const [docName, setDocName] = useState('')
  // The document to reopen. Fetched once so "Create Document" can continue the
  // last one instead of silently starting a blank page over the top of it —
  // there was no way to get back to previous work at all before, because there
  // was no previous work: it lived in a DOM node that unmounting destroyed.
  const [latestDoc, setLatestDoc] = useState<DocumentRecord | null>(null)
  const [latestDocLoaded, setLatestDocLoaded] = useState(false)

  useEffect(() => {
    tracelyApi
      .getLatestDocument()
      .then((res) => setLatestDoc(res.document))
      .catch(() => {})
      .finally(() => setLatestDocLoaded(true))
  }, [])
  const [claims, setClaims] = useState<Claim[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runDetection(source: string): Promise<void> {
    if (!source.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await tracelyApi.detectClaims(source, 'main')
      setClaims(res.claims)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function handleCta(): void {
    if (sourceType === 'document') {
      // A typed name starts a new document; an empty box continues the last
      // one, which is the only way back into previous work.
      const named = text.trim()
      setDocName(named || latestDoc?.title || '')
      setClaims(null)
      setError(null)
      setDocEditorOpen(true)
      return
    }
    void runDetection(text)
  }

  function selectSourceType(next: SourceType): void {
    setSourceType(next)
    setClaims(null)
    setError(null)

    // Move directly into the corresponding input after either a mouse click
    // or the native button's Enter/Space activation. Besides being convenient,
    // this makes the state transition unambiguous for keyboard users.
    requestAnimationFrame(() => sourceInputRef.current?.focus())
  }

  if (docEditorOpen) {
    return (
      <DocumentEditor
        // Remounts when the target document changes, so the restore-once
        // effect inside runs against the right body.
        key={text.trim() ? 'new' : (latestDoc?.id ?? 'new')}
        docName={docName}
        onDocNameChange={setDocName}
        onBack={() => setDocEditorOpen(false)}
        onRunInsights={(bodyText) => void runDetection(bodyText)}
        insightsLoading={loading}
        claims={claims}
        error={error}
        initialDoc={text.trim() ? null : latestDoc}
        onSaved={setLatestDoc}
      />
    )
  }

  if (loading) {
    return (
      <div className="analyze-view">
        <AnalyzingPanel onClose={() => onNavigate('home')} />
      </div>
    )
  }

  return (
    <div className="analyze-view">
      <button className="analyze-back" onClick={() => onNavigate('home')}>
        <BackIcon size={13} />
        Back
      </button>
      <section className="analyze-input">
        <h2 className="analyze-heading">Start a new session</h2>
        <p className="analyze-subheading">Choose a source for Tracely to analyze.</p>
        <div className="source-tile-row">
          {SOURCE_TILES.map((tile) => (
            <button
              key={tile.id}
              type="button"
              className={`source-tile ${sourceType === tile.id ? 'active' : ''}`}
              aria-pressed={sourceType === tile.id}
              aria-controls="analyze-source-input"
              onClick={() => selectSourceType(tile.id)}
            >
              <tile.icon size={22} />
              {tile.label}
            </button>
          ))}
        </div>

        <TextArea
          id="analyze-source-input"
          ref={sourceInputRef}
          size="lg"
          placeholder={SOURCE_PLACEHOLDER[sourceType]}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
        />

        <div className="analyze-input-actions">
          <Button
            variant="primary"
            className="analyze-cta"
            onClick={handleCta}
            disabled={loading || (sourceType === "document" ? !latestDocLoaded : !text.trim())}
          >
            {sourceType === 'document' && !latestDocLoaded ? 'Loading…' : SOURCE_CTA[sourceType]}
          </Button>
          {claims ? (
            <span className="muted">
              {claims.length} claim{claims.length === 1 ? '' : 's'} detected
            </span>
          ) : null}
        </div>

        {error ? <p className="error-text analyze-feedback">{error}</p> : null}

        {claims && claims.length === 0 ? (
          <p className="muted analyze-feedback">No checkable claims detected in this text.</p>
        ) : null}

        {claims && claims.length > 0 ? (
          <section className="results-panel analyze-results" aria-live="polite">
            {claims.map((claim) => (
              <ClaimCard key={claim.id} claim={claim} />
            ))}
          </section>
        ) : null}
      </section>
    </div>
  )
}
