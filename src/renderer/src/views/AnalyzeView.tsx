import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { CitationStyle, Claim, DocumentOutline, DocumentRecord, Source } from '@shared/types'
import { splitParagraphs } from '@shared/paragraphSplit'
import { formatInTextCitation } from '@shared/citationInText'
import ClaimCard from '../components/ClaimCard'
import Button from '../components/Button'
import ArgumentScoreModal from '../components/ArgumentScoreModal'
import ToolbarMenu from '../components/ToolbarMenu'
import ConfirmDialog from '../components/ConfirmDialog'
import DocumentMarkLayer from '../components/DocumentMarkLayer'
import { insertCitationForClaim, markAt, measureMarks } from '../components/documentMarks'
import type { DocumentMark, MarkRect } from '../components/documentMarks'
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
        <h3>Analyzing your source</h3>
        {/*
          The design's sentence is "Tracely is scanning claims and gathering
          credible evidence." The first half is true here and the second is not:
          this stage is one relay call that finds claims. Evidence search and
          citations run later and on demand, so under a live progress bar that
          clause describes work that is not happening. Same position, same
          length, second half dropped.
        */}
        <p>Tracely is scanning your text for checkable claims.</p>
        <div className="analyzing-progress-track">
          <div className="analyzing-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="analyzing-progress-label">{percent}% complete</p>

        {/*
          The four-step list from 127:40, in the design's own three states:
          done is a filled orange check, active an orange ring with orange text,
          pending a grey ring with grey text.

          The last two NEVER leave pending, and that is the point. This screen
          previously had this exact checklist and it was deleted, because
          "Cross-referencing credible sources" and "Generating citations"
          describe work this stage does not do — ticking them would be the app
          narrating a search it has not run, on the one screen where a student
          is watching to see what it found. Drawing them greyed is the design's
          own way of saying "not yet", so the frame is matched and nothing is
          claimed. They light up in the flows that really do them.
        */}
        <ul className="analyzing-steps">
          {ANALYZING_STEPS.map((step) => {
            const state = !step.runsHere ? 'pending' : percent >= step.doneAt ? 'done' : 'active'
            return (
              <li key={step.label} className={`analyzing-step is-${state}`}>
                <span className="analyzing-step-mark" aria-hidden="true">
                  {state === 'done' ? '✓' : ''}
                </span>
                {step.label}
                {!step.runsHere ? <span className="sr-only"> — runs later, on demand</span> : null}
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

// Figma 226:95 and 234:46 — the design's own lists, not a superset of them.
// The families were Georgia/Times/Courier/Verdana, which appear in no frame;
// Inter and Instrument Sans are the two the app actually ships and renders in.
/**
 * Figma 127:40. `runsHere` is what keeps this honest: only the first two
 * happen during claim detection, so the other two are drawn in the design's
 * pending state and never advance out of it.
 *
 * `doneAt` are points on the same asymptotic elapsed-time curve the bar uses —
 * they are not milestones the backend reports, because it reports none. A step
 * ticking is therefore "enough time has passed that this is finished", which is
 * true of reading and extracting in a single round trip.
 */
const ANALYZING_STEPS: Array<{ label: string; runsHere: boolean; doneAt: number }> = [
  { label: 'Reading source content', runsHere: true, doneAt: 25 },
  { label: 'Extracting key claims', runsHere: true, doneAt: 96 },
  { label: 'Cross-referencing credible sources', runsHere: false, doneAt: 0 },
  { label: 'Generating citations', runsHere: false, doneAt: 0 }
]

const FONT_FAMILIES = ['Arial', 'Inter', 'Instrument Sans', 'Roboto']
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24]

// Figma 226:104. Justify is the design's fourth row and was missing; the
// browser has execCommand('justifyFull'), so it works like the other three.
const ALIGN_ITEMS: Array<[Align, string, string]> = [
  ['left', 'Align Left', 'justifyLeft'],
  ['center', 'Align Center', 'justifyCenter'],
  ['right', 'Align Right', 'justifyRight'],
  ['justify', 'Justify', 'justifyFull']
]
const TEXT_COLORS = ['#212121', '#d93025', '#e37400', '#188038', '#1967d2', '#8430ce']
type Align = 'left' | 'center' | 'right' | 'justify'

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
  onRefreshClaims,
  insightsLoading,
  claims,
  error,
  initialDoc,
  onSaved
}: {
  docName: string
  onDocNameChange: (v: string) => void
  onBack: () => void
  /**
   * Runs claim detection and resolves with the analysis id, so the Structure
   * rail can map the detected claims onto paragraphs without making the user
   * press two buttons in the right order. Resolves null if detection failed.
   */
  onRunInsights: (bodyText: string) => Promise<string | null>
  /** Re-reads the analysis so claim scores updated by an evidence search show. */
  onRefreshClaims: (analysisId: string) => Promise<void>
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
  const wrapRef = useRef<HTMLDivElement>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const alignMenuRef = useRef<HTMLDivElement>(null)

  // ---- Structure ---------------------------------------------------------
  // No `structureOpen` any more: the rail and its toggle are gone, and the
  // outline is now read only by the AI Insights report.
  // What "AI Insights" opens — the Essay Grade modal from Figma 370:135/404:129.
  // Separate state from the rail: the rail is a persistent side panel you work
  // beside, the modal is a report you open, read and dismiss.
  const [scoreOpen, setScoreOpen] = useState(false)
  const [outline, setOutline] = useState<DocumentOutline | null>(null)
  // handleInput is a plain function re-created every render and called from an
  // uncontrolled contentEditable, so it must not close over `outline` — it
  // would read whatever value was current when that render's handler was
  // attached. A ref is the value at call time.
  const outlineRef = useRef<DocumentOutline | null>(null)
  useEffect(() => {
    outlineRef.current = outline
  }, [outline])
  const [outlineStale, setOutlineStale] = useState(false)
  const [outlineLoading, setOutlineLoading] = useState(false)
  const [outlineError, setOutlineError] = useState<string | null>(null)
  const [activeParagraph, setActiveParagraph] = useState<number | null>(null)
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null)
  // Recomputed from the live editor rather than stored on the outline, which
  // deliberately carries no prose — see DocumentOutline.
  const [paragraphTexts, setParagraphTexts] = useState<string[]>([])

  // ---- Inline marks ------------------------------------------------------
  //
  // The underlines from the Figma "Inline Detection" frames. Measured against
  // the contentEditable and drawn in a layer beside it — see documentMarks.ts
  // for why nothing here may touch the DOM the user is typing into.
  const [marks, setMarks] = useState<DocumentMark[]>([])
  const [activeMark, setActiveMark] = useState<{ mark: DocumentMark; rect: MarkRect } | null>(null)
  const [wrapWidth, setWrapWidth] = useState(0)
  // Claims the writer has waved away this session. Client-side only: a
  // dismissal is "I know, leave me alone while I finish this paragraph", not a
  // durable judgement about the sentence, and persisting it would mean a real
  // problem could be hidden forever by one impatient click.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // Bumped whenever something that moves text happens, to re-measure. A counter
  // rather than the text itself: identical text can still need re-measuring
  // after a font or alignment change.
  const [measureTick, setMeasureTick] = useState(0)
  // The pointer is inside the popover, so leaving the underline must not close
  // it — otherwise the card vanishes as you reach for its buttons.
  const insidePopoverRef = useRef(false)

  // The style the Find Evidence view formats and labels its pill with. Read
  // once: it is a preference, not something that changes while a document is
  // open, and defaulting to MLA on a failed read is better than blocking the
  // citation flow on a settings call.
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('MLA')
  useEffect(() => {
    void tracelyApi
      .getSettings()
      .then((s) => setCitationStyle(s.defaultCitationStyle))
      .catch(() => {})
  }, [])

  const [wordCount, setWordCount] = useState(0)
  const [fontFamily, setFontFamily] = useState('Arial')
  const [fontSize, setFontSize] = useState(11)
  const [format, setFormat] = useState({ bold: false, italic: false, underline: false })
  const [align, setAlign] = useState<Align>('left')
  const [alignMenuOpen, setAlignMenuOpen] = useState(false)
  const [shareMenuOpen, setShareMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [wordMenuOpen, setWordMenuOpen] = useState(false)
  const [fontMenuOpen, setFontMenuOpen] = useState(false)
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false)
  const fontMenuRef = useRef<HTMLDivElement>(null)
  const sizeMenuRef = useRef<HTMLDivElement>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const shareMenuRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const wordMenuRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

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
    setParagraphTexts(splitParagraphs(text).map((p) => p.text))
    // Editing invalidates the reading. Without this, `outlineStale` was only
    // ever set by the stored-outline load, so typing left a stale analysis
    // looking current AND let runStructure reuse its analysisId — bucketing
    // claims into paragraphs they had since moved out of. Guarded on the
    // current value so an already-stale outline does not re-render per
    // keystroke.
    setOutlineStale((wasStale) => wasStale || outlineRef.current !== null)
    // Every keystroke reflows the text the marks were measured against.
    setMeasureTick((n) => n + 1)
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
  // The analysis the structure rail maps claims from. A ref for the same
  // reason docIdRef is one: it is read inside async work that must not be
  // re-created when it changes.
  const analysisIdRef = useRef<string | null>(null)
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

  // ---- Structure ---------------------------------------------------------

  /**
   * Saves a copy of the open document under a new id.
   *
   * `saveDocument` with no id inserts rather than updates, so this is a real
   * duplicate rather than a rename — the original keeps its own row and its own
   * analyses. The copy is not opened; the frame's menu item says Duplicate, not
   * "Duplicate and switch to it".
   */
  async function duplicateDocument(): Promise<void> {
    const body = editorRef.current
    if (!body) return
    try {
      const copy = await tracelyApi.saveDocument({
        title: `${docName || 'Untitled'} (copy)`,
        bodyHtml: body.innerHTML
      })
      onSaved(copy.document)
    } catch (err) {
      setOutlineError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Deletes the open document and leaves the editor. */
  async function deleteDocument(): Promise<void> {
    const id = docIdRef.current
    setConfirmingDelete(false)
    if (!id) {
      onBack()
      return
    }
    try {
      await tracelyApi.removeDocument(id)
      onBack()
    } catch (err) {
      setOutlineError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Re-measures the underlines.
   *
   * useLayoutEffect, not useEffect: these are absolute positions over live
   * text, and measuring after paint shows the marks in their old places for a
   * frame every time the text reflows — visible as a flicker on every keystroke
   * in a flagged paragraph.
   *
   * rAF-batched because a keystroke fires this and a ResizeObserver callback in
   * the same tick, and getClientRects forces layout each time.
   */
  useLayoutEffect(() => {
    const body = editorRef.current
    const wrap = wrapRef.current
    if (!body || !wrap) return
    let frame = 0
    frame = requestAnimationFrame(() => {
      const live = (claims ?? []).filter((claim) => !dismissed.has(claim.id))
      setMarks(measureMarks(body, wrap, live))
      setWrapWidth(wrap.clientWidth)
    })
    return () => cancelAnimationFrame(frame)
    // `structureOpen` was a dependency here: opening the rail narrowed the
    // editor, so every mark had to be re-measured. With the rail gone the
    // editor's width no longer changes from inside this component.
  }, [claims, dismissed, measureTick, fontFamily, fontSize, align])

  // The editor reflows on window resize, which does not go through
  // handleInput.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => setMeasureTick((n) => n + 1))
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  /**
   * Opens the popover for whatever underline the pointer is over.
   *
   * Hit-tested against the measured rects rather than by putting elements under
   * the cursor: the layer sits over a contentEditable, and anything that
   * accepts a pointer event there is something the writer cannot click through
   * to place their caret.
   */
  function handleBodyMouseMove(event: ReactMouseEvent<HTMLDivElement>): void {
    const wrap = wrapRef.current
    if (!wrap || marks.length === 0) {
      if (activeMark) setActiveMark(null)
      return
    }
    if (insidePopoverRef.current) return
    const rect = wrap.getBoundingClientRect()
    const x = event.clientX - rect.left + wrap.scrollLeft
    const y = event.clientY - rect.top + wrap.scrollTop
    const hit = markAt(marks, x, y)
    if (!hit) {
      if (activeMark) setActiveMark(null)
      return
    }
    if (activeMark?.mark.claim.id === hit.mark.claim.id) return
    setActiveMark(hit)
  }

  /**
   * Writes the chosen source's in-text citation into the sentence, then
   * re-reads the claims so the mark over it updates.
   *
   * The re-read is the point. `hasInlineCitation` now decides both the mark's
   * colour and whether one is drawn at all, so a citation the user just
   * inserted has to reach the next measure — otherwise the underline that
   * prompted the insertion is still sitting there, still saying the sentence is
   * unattributed, over a sentence that now carries a citation.
   */
  async function insertCitation(claim: Claim, source: Source, style: CitationStyle): Promise<void> {
    const body = editorRef.current
    if (!body) throw new Error('The editor is not open.')
    // Formatted here rather than through an IPC round-trip: formatInTextCitation
    // is a pure function of a Source the renderer already holds (it came back
    // with the evidence), so a channel for it would be a channel that reads
    // nothing main knows and the renderer does not.
    if (!insertCitationForClaim(body, claim, formatInTextCitation(source, style))) {
      throw new Error(
        'Could not find that sentence in the document any more — it may have been edited since the search.'
      )
    }
    handleInput()
    const analysisId = analysisIdRef.current
    if (analysisId) await onRefreshClaims(analysisId)
  }

  /**
   * Runs the analysis. Detects claims first when none have been detected yet,
   * because the role heuristics key off where claims fall — without them a
   * thesis is unfindable and the score would be misleadingly low for a reason
   * the user cannot see.
   *
   * Never automatic. This is the only relay-touching path in the editor, and
   * `handleInput` fires on every keystroke.
   */
  async function runStructure(): Promise<void> {
    setOutlineLoading(true)
    setOutlineError(null)
    try {
      const text = bodyText()
      // Re-detect when the text has moved on. Claim offsets are what map
      // claims onto paragraphs, so reusing an analysis of older text would
      // bucket claims into paragraphs they are no longer in.
      const reuse = analysisIdRef.current !== null && !outlineStale
      const analysisId = reuse ? analysisIdRef.current : await onRunInsights(text)
      analysisIdRef.current = analysisId
      const res = await tracelyApi.analyzeStructure({
        documentId: docIdRef.current,
        text,
        analysisId
      })
      setOutline(res.outline)
      setParagraphTexts(splitParagraphs(text).map((p) => p.text))
      // Only clear the flag if the draft has not moved on while the analysis
      // was running. Clearing it unconditionally presented a reading of text
      // the user had already edited past as current.
      setOutlineStale(bodyText() !== text)
    } catch (err) {
      setOutlineError(err instanceof Error ? err.message : String(err))
    } finally {
      setOutlineLoading(false)
    }
  }

  // Load a stored outline when AI Insights is opened on a saved document.
  // Reading it is free; re-analyzing is not, so this never triggers one — a
  // stale result is shown with its banner and the user decides.
  //
  // Gated on `scoreOpen` since the Structure rail was removed; that rail's
  // toggle used to be what opened this, and without the re-gate a saved
  // document showed an empty report until runStructure came back.
  useEffect(() => {
    if (!scoreOpen || outline || !docIdRef.current) return
    let cancelled = false
    void tracelyApi
      .getStructure(docIdRef.current, bodyText())
      .then(async (res) => {
        if (cancelled || !res.outline) return
        setOutline(res.outline)
        setOutlineStale(res.stale)
        // Restore the claims the outline's paragraph claimIds refer to.
        // Without this a reopened document shows an outline that knows claims
        // exist and can say nothing about any of them, because ids alone are
        // not resolvable. Reading a stored analysis costs no relay call.
        if (res.outline.analysisId) {
          analysisIdRef.current = res.outline.analysisId
          await onRefreshClaims(res.outline.analysisId)
        }
      })
      .catch(() => {
        // A missing stored outline is the normal case for a document that has
        // never been analyzed, not an error worth showing.
      })
    return () => {
      cancelled = true
    }
  }, [scoreOpen, outline, onRefreshClaims])

  /**
   * Runs the evidence search for claims that have not been checked.
   *
   * Serial, and with a visible count, rather than fired off in parallel.
   * `aggregator.ts` gives each provider a 6s timeout and `rateLimiter.ts`
   * serialises Semantic Scholar at roughly a second a call, so eight claims at
   * once is a 15-45 second wait — and this codebase already refuses to show
   * progress it cannot back (see AnalyzingPanel). One claim at a time means the
   * count is real and partial results land as they arrive.
   *
   * These are the four free academic APIs, not the paid relay, which is why
   * this can be offered as a button per claim at all.
   */
  async function checkClaims(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    setChecking({ done: 0, total: ids.length })
    for (const [i, id] of ids.entries()) {
      try {
        await tracelyApi.findEvidence(id)
      } catch {
        // One claim's search failing must not abandon the rest of the queue.
      }
      setChecking({ done: i + 1, total: ids.length })
    }
    setChecking(null)

    // Re-read both sides: the claims so their new strength scores render, and
    // the outline so coverage and the unsupported-claim weaknesses reflect what
    // the search actually found. Neither costs a relay call.
    const analysisId = analysisIdRef.current
    if (analysisId) await onRefreshClaims(analysisId)
    await runStructure()
  }

  /**
   * Scrolls the editor to a paragraph.
   *
   * Block children with text map 1:1 onto `splitParagraphs`' output, since both
   * skip empty lines: execCommand puts each Enter in its own <div> and
   * innerText renders it as one '\n'. Text typed before the first Enter has no
   * element wrapper at all, which is why this degrades to doing nothing rather
   * than scrolling somewhere arbitrary.
   */
  function selectParagraph(index: number): void {
    setActiveParagraph(index)
    const editor = editorRef.current
    if (!editor) return
    const blocks = Array.from(editor.children).filter(
      (el) => (el.textContent ?? '').trim().length > 0
    )
    // 'auto', not 'smooth'. Smooth scrolling is driven by the compositor, and
    // it silently does nothing when the window is not compositing frames —
    // measured in the preview harness, where a smooth call left scrollTop at
    // 890 and an identical 'auto' call moved it to 0. Clicking a weakness and
    // watching nothing happen is a broken feature; arriving instantly is not.
    // Same reasoning as the overlay's no-fill-mode entrance animation.
    //
    // It also reads better here: these jumps cross most of the document, and
    // animating a long jump is the disorienting case the overlay already
    // suppresses for large deltas.
    blocks[index - 1]?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }

  return (
    // Row, not column. `.docedit-main` holds everything that was previously a
    // direct child — critically including `.docedit-wordcount` and
    // `.docedit-error`, which are positioned against it. Left as siblings of
    // the rail they would become flex items of the row and land beside it.
    <div className="docedit-view">
      <div className="docedit-main">
      <div className="docedit-toolbar">
        <button className="docedit-back" onClick={onBack}>
          <BackIcon size={12} />
          Back
        </button>
        <div className="docedit-divider" />
        <DocumentIcon size={16} className="docedit-icon" />
        <input
          ref={nameInputRef}
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
        {/* Custom menus, not <select>. The frames draw both as the same
            bordered dropdown every other toolbar menu uses (226:95, 234:46);
            a native select renders the OS's own popup, which cannot be styled
            to match and looks nothing like the design on Windows. */}
        <div className="docedit-menu-wrap" ref={fontMenuRef}>
          <button
            className="docedit-fontname"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFontMenuOpen((o) => !o)}
          >
            {fontFamily}
          </button>
          {fontMenuOpen ? (
            <ToolbarMenu
              width={132}
              onClose={() => setFontMenuOpen(false)}
              items={FONT_FAMILIES.map((f) => ({
                label: f,
                active: fontFamily === f,
                onSelect: () => {
                  setFontFamily(f)
                  exec('fontName', f)
                }
              }))}
            />
          ) : null}
        </div>
        <div className="docedit-menu-wrap" ref={sizeMenuRef}>
          <button
            className="docedit-fontsize"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSizeMenuOpen((o) => !o)}
          >
            {fontSize}
          </button>
          {sizeMenuOpen ? (
            <ToolbarMenu
              width={48}
              onClose={() => setSizeMenuOpen(false)}
              items={FONT_SIZES.map((sz) => ({
                label: String(sz),
                active: fontSize === sz,
                onSelect: () => applyFontSize(sz)
              }))}
            />
          ) : null}
        </div>
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
        <div className="docedit-menu-wrap" ref={alignMenuRef}>
          <button
            className="docedit-toolbtn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAlignMenuOpen((o) => !o)}
            title="Align text"
          >
            ≡
          </button>
          {alignMenuOpen ? (
            <ToolbarMenu
              width={109}
              onClose={() => setAlignMenuOpen(false)}
              items={ALIGN_ITEMS.map(([value, label, command]) => ({
                label,
                active: align === value,
                onSelect: () => {
                  exec(command)
                  setAlign(value)
                }
              }))}
            />
          ) : null}
        </div>

        {/* Share — 234:67. Every row is dead, and says why on hover. Tracely is
            local-first: the document exists in one SQLite file on this machine,
            there is no server copy to link to and no second account to invite.
            The frame draws the menu, so it is drawn. */}
        <div className="docedit-menu-wrap" ref={shareMenuRef}>
          <button
            className="docedit-toolbtn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShareMenuOpen((o) => !o)}
            title="Share"
          >
            Share
          </button>
          {shareMenuOpen ? (
            <ToolbarMenu
              width={125}
              align="right"
              onClose={() => setShareMenuOpen(false)}
              items={[
                { label: 'Copy link', disabled: true, title: 'This document only exists on this machine — there is no link to copy.' },
                { label: 'Invite people', disabled: true, title: 'Tracely has no shared documents or second accounts.' },
                { label: 'Manage access', disabled: true, title: 'Nothing has access but you — the file never leaves this machine.' }
              ]}
            />
          ) : null}
        </div>

        {/* More — 234:74. Rename, Duplicate and Delete are real; folders and
            version history do not exist. */}
        <div className="docedit-menu-wrap" ref={moreMenuRef}>
          <button
            className="docedit-toolbtn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMoreMenuOpen((o) => !o)}
            title="More"
          >
            •••
          </button>
          {moreMenuOpen ? (
            <ToolbarMenu
              width={123}
              align="right"
              onClose={() => setMoreMenuOpen(false)}
              items={[
                { label: 'Duplicate', onSelect: () => void duplicateDocument() },
                { label: 'Rename', onSelect: () => nameInputRef.current?.select() },
                { label: 'Move to folder', disabled: true, title: 'Documents are a flat list — there are no folders.' },
                { label: 'Version history', disabled: true, title: 'Only the current version of a document is stored.' },
                { label: 'Delete', onSelect: () => setConfirmingDelete(true) }
              ]}
            />
          ) : null}
        </div>

        <div className="docedit-spacer" />
        <span className="docedit-savestate">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
        </span>
        {/*
          Opens the Argument Score report, which is what the design has this
          button do — see ArgumentScoreModal's header for why it lives on this
          surface. It used to call onRunInsights directly and append ClaimCards
          under the document, so pressing the one button the design puts in this
          toolbar produced none of what the design draws.

          runStructure() rather than onRunInsights(): it already detects claims
          first when the text has moved on, then analyses structure and fills
          paragraphTexts. The claim list under the document still appears, since
          that detection is the same call — nothing was taken away.
        */}
        <button
          className="docedit-insights"
          onClick={() => {
            setScoreOpen(true)
            void runStructure()
          }}
          disabled={insightsLoading || outlineLoading || !bodyText().trim()}
        >
          {insightsLoading || outlineLoading ? 'Analyzing…' : 'AI Insights'}
        </button>
        {/*
          The "Structure" toggle stood here, opening a side rail with the same
          rubric, weaknesses and paragraph list that AI Insights now shows under
          "View Full Report". Two buttons in a toolbar the design gives one, both
          leading to the same reading of the draft. Removed on Merrick's call
          (2026-08-15); the rail went with it, since this was the only way in.
        */}
        {/*
          "Share" and "•••" were here, permanently disabled with "isn't
          available yet". Local-first, no account, no permalink, nothing to
          share TO. A button that can never be enabled is worse than no button —
          it takes up space promising something that is not coming.
        */}
      </div>

      <div
        className="docedit-body-wrap"
        ref={wrapRef}
        onMouseMove={handleBodyMouseMove}
        onMouseLeave={() => {
          if (!insidePopoverRef.current) setActiveMark(null)
        }}
      >
        <div
          ref={editorRef}
          className="docedit-body"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Start typing…"
          onInput={handleInput}
        />
        {/*
          Drawn after the body so it paints over the text, but the layer and
          every mark in it are pointer-events: none — the writer clicks through
          to place their caret exactly as if this were not here. Only the
          popover takes the pointer.
        */}
        <DocumentMarkLayer
          marks={marks}
          active={activeMark}
          wrapWidth={wrapWidth}
          onFindSource={(mark) => {
            // The claim's own evidence search, then the report opened on it —
            // the same "Find Evidence" destination the design reaches from the
            // paragraph detail, so both routes land in one place.
            setScoreOpen(true)
            void checkClaims([mark.claim.id])
          }}
          onSuggestFix={(mark) => {
            setScoreOpen(true)
            void checkClaims([mark.claim.id])
          }}
          onDismiss={(mark) => {
            setDismissed((prev) => new Set(prev).add(mark.claim.id))
            setActiveMark(null)
          }}
          onPopoverEnter={() => {
            insidePopoverRef.current = true
          }}
          onPopoverLeave={() => {
            insidePopoverRef.current = false
            setActiveMark(null)
          }}
        />
      </div>

      {/* 234:85. Every row here is computable from the document already open,
          so unlike Share and More this menu has nothing disabled in it. */}
      <div className="docedit-wordcount docedit-menu-wrap" ref={wordMenuRef}>
        <button className="docedit-wordcount-trigger" onClick={() => setWordMenuOpen((o) => !o)}>
          <b>{wordCount}</b> words
        </button>
        {wordMenuOpen ? (
          <ToolbarMenu
            width={131}
            onClose={() => setWordMenuOpen(false)}
            items={[
              { label: `Word count · ${wordCount.toLocaleString()}` },
              { label: `Character count · ${bodyText().length.toLocaleString()}` },
              { label: `Reading time · ~${Math.max(1, Math.round(wordCount / 238))} min` }
            ]}
          />
        ) : null}
      </div>

      {error ? <p className="error-text docedit-error">{error}</p> : null}

      {claims && claims.length === 0 ? <p className="muted docedit-error">No checkable claims detected.</p> : null}

      {/*
        The ClaimCard list that used to sit under the document is gone.
        Detection still runs — the report reads `claims` — but the cards are not
        drawn here any more.

        They predate the Argument Score report and say the same things worse: a
        flat list below the prose, outside any paragraph, with Find Evidence and
        Critique Argument buttons duplicated per card. The report now shows each
        claim inside the paragraph it belongs to, which is the whole reason the
        paragraph detail exists. Two views of the same claims, one of them
        context-free, is what made the editor feel like it had two disagreeing
        opinions about the draft.
      */}
      </div>

      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete this document?"
          message="The document, and every analysis run against it, are deleted from this machine. There is no other copy."
          confirmLabel="Delete"
          danger
          onConfirm={() => void deleteDocument()}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}

      {scoreOpen ? (
        <ArgumentScoreModal
          outline={outline}
          claims={claims ?? []}
          paragraphTexts={paragraphTexts}
          loading={insightsLoading || outlineLoading}
          error={outlineError}
          citationStyle={citationStyle}
          onInsertCitation={insertCitation}
          onReanalyze={() => void runStructure()}
          onClose={() => setScoreOpen(false)}
        />
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

  // Resolves with the analysis id so the document editor's Structure rail can
  // chain onto it; the paste-text path ignores the return value.
  async function runDetection(source: string): Promise<string | null> {
    if (!source.trim()) return null
    setLoading(true)
    setError(null)
    try {
      const res = await tracelyApi.detectClaims(source, 'main')
      setClaims(res.claims)
      return res.analysisId
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setLoading(false)
    }
  }

  // Re-reads persisted claims after an evidence search has updated their
  // scores. No relay call — the analysis is already stored.
  async function refreshClaims(analysisId: string): Promise<void> {
    try {
      const res = await tracelyApi.getAnalysisResult(analysisId)
      setClaims(res.claims)
    } catch {
      // The scores are cosmetic here; the outline's coverage is read straight
      // from the database and stays correct either way.
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
        onBack={() => {
          setDocEditorOpen(false)
          // claims/error belong to whichever screen last ran detection. The
          // document editor writes into the same state the picker reads at
          // the bottom of "Start a new session" (line ~1153) — without this,
          // going Back left the doc's claim list rendered under the picker.
          setClaims(null)
          setError(null)
        }}
        onRunInsights={runDetection}
        onRefreshClaims={refreshClaims}
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
          rows={sourceType === 'document' ? 1 : 6}
          // Naming a document is a title, not a paragraph — without this the
          // shared textarea with the paste-text box renders 6 lines tall for
          // a few words.
          // Figma 58:223 draws this at the tile row's own 620px, left-aligned
          // with 16px of lead-in — not a narrow centred field. It was 320 and
          // centred, which under a 620px tile row is the widest single thing on
          // the screen sitting over a box half its width.
          style={sourceType === 'document' ? { maxWidth: 620, resize: 'none', textAlign: 'left' } : undefined}
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
        </div>

        {/* Its own row, not a sibling of the button inside `.analyze-input-actions`.
            That row centres its children as a group, so the moment this count
            appeared it shoved the CTA left of centre — the design (58:225) has
            the button alone and centred, and it should stay centred whether or
            not a run has produced claims. */}
        {claims ? (
          <p className="muted analyze-feedback">
            {claims.length} claim{claims.length === 1 ? '' : 's'} detected
          </p>
        ) : null}

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
