import { useEffect, useRef, useState } from 'react'
import type { Claim } from '@shared/types'
import ClaimCard from '../components/ClaimCard'
import Button from '../components/Button'
import TextArea from '../components/TextArea'
import { DocumentIcon, LinkIcon, ClipboardIcon, CheckCircleIcon, CloseIcon, BackIcon } from '../components/icons'
import { tracelyApi } from '../lib/api'
import type { Tab } from '../App'

type SourceType = 'document' | 'url' | 'text'

const SOURCE_TILES: { id: SourceType; label: string; icon: (props: { size?: number }) => JSX.Element }[] = [
  { id: 'document', label: 'Document', icon: DocumentIcon },
  { id: 'url', label: 'URL / Link', icon: LinkIcon },
  { id: 'text', label: 'Paste text', icon: ClipboardIcon }
]

const SOURCE_PLACEHOLDER: Record<SourceType, string> = {
  document: 'Name your document…',
  url: 'Paste a URL…',
  text: 'Paste your text here…'
}

const SOURCE_CTA: Record<SourceType, string> = {
  document: 'Create Document',
  url: 'Import Link',
  text: 'Begin analysis'
}

// The real detectClaims call is a single opaque request with no backend
// sub-progress to report. Rather than faking fixed percentages on a timer
// (which either stalls at "100% complete" while still waiting, or finishes
// before the real call does), the bar's percent tracks actual elapsed time
// with an asymptotic curve that approaches but never reaches 100% — it only
// ever disappears when the real response has actually landed.
const ANALYZING_STEPS = [
  'Reading source content',
  'Extracting key claims',
  'Cross-referencing credible sources',
  'Generating citations'
]
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
  const stepIndex = Math.min(
    ANALYZING_STEPS.length - 1,
    Math.floor((percent / ANALYZING_MAX_PERCENT) * ANALYZING_STEPS.length)
  )

  return (
    <>
      <button className="analyze-close" onClick={onClose} aria-label="Close">
        <CloseIcon size={16} />
      </button>
      <div className="analyzing-panel">
        <div className="analyzing-spinner-ring" />
        <h3>Analyzing your source</h3>
        <p>Tracely is scanning claims and gathering credible evidence.</p>
        <div className="analyzing-progress-track">
          <div className="analyzing-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="analyzing-progress-label">{percent}%</p>
        <div className="analyzing-steps">
          {ANALYZING_STEPS.map((label, i) => (
            <div
              key={label}
              className={`analyzing-step ${i < stepIndex ? 'done' : i === stepIndex ? 'active' : ''}`}
            >
              <span className="analyzing-step-dot">{i < stepIndex ? <CheckCircleIcon size={10} /> : null}</span>
              {label}
            </div>
          ))}
        </div>
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
  error
}: {
  docName: string
  onDocNameChange: (v: string) => void
  onBack: () => void
  onRunInsights: (bodyText: string) => void
  insightsLoading: boolean
  claims: Claim[] | null
  error: string | null
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

  useEffect(() => {
    function handleSelectionChange(): void {
      const editor = editorRef.current
      if (!editor || document.activeElement !== editor) return
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        savedRangeRef.current = sel.getRangeAt(0).cloneRange()
      }
      setFormat({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline')
      })
      setAlign(
        document.queryCommandState('justifyCenter')
          ? 'center'
          : document.queryCommandState('justifyRight')
            ? 'right'
            : 'left'
      )
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

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
    setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0)
  }

  const bodyText = (): string => editorRef.current?.innerText ?? ''

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
          onChange={(e) => onDocNameChange(e.target.value)}
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
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('bold')}
        >
          B
        </button>
        <button
          className={`docedit-toolbtn underline ${format.underline ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('underline')}
        >
          U
        </button>
        <button
          className={`docedit-toolbtn italic ${format.italic ? 'active' : ''}`}
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
        <button
          className="docedit-insights"
          onClick={() => onRunInsights(bodyText())}
          disabled={insightsLoading || !bodyText().trim()}
        >
          {insightsLoading ? 'Analyzing…' : 'AI Insights'}
        </button>
        <button className="docedit-share" disabled title="Sharing isn't available yet">
          Share
        </button>
        <button className="docedit-more" disabled title="More options aren't available yet">
          •••
        </button>
      </div>

      <div className="docedit-body-wrap">
        <div
          ref={editorRef}
          className="docedit-body"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Start typing or insert using /"
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
  const [text, setText] = useState('')
  const [docEditorOpen, setDocEditorOpen] = useState(false)
  const [docName, setDocName] = useState('')
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
      setDocName(text.trim())
      setClaims(null)
      setError(null)
      setDocEditorOpen(true)
      return
    }
    void runDetection(text)
  }

  if (docEditorOpen) {
    return (
      <DocumentEditor
        docName={docName}
        onDocNameChange={setDocName}
        onBack={() => setDocEditorOpen(false)}
        onRunInsights={(bodyText) => void runDetection(bodyText)}
        insightsLoading={loading}
        claims={claims}
        error={error}
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
              className={`source-tile ${sourceType === tile.id ? 'active' : ''}`}
              onClick={() => setSourceType(tile.id)}
            >
              <tile.icon size={22} />
              {tile.label}
            </button>
          ))}
        </div>

        <TextArea
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
            disabled={loading || (sourceType !== 'document' && !text.trim())}
          >
            {SOURCE_CTA[sourceType]}
          </Button>
          {claims ? (
            <span className="muted">
              {claims.length} claim{claims.length === 1 ? '' : 's'} detected
            </span>
          ) : null}
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      {claims && claims.length === 0 ? (
        <p className="muted">No checkable claims detected in this text.</p>
      ) : null}

      {claims ? (
        <section className="results-panel">
          {claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </section>
      ) : null}
    </div>
  )
}
