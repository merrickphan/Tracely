import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import type { DocCitationFlowState, DocFixState } from '../components/DocumentMarkLayer'
import { sourceInitials } from '../components/citationFlowCopy'
import { APPLY_LOST_CLAIM } from '../components/fixFlowCopy'
import {
  addWorksCitedEntry,
  insertCitationForClaim,
  markAt,
  measureMarks,
  replaceClaimText,
  revealWorksCited
} from '../components/documentMarks'
import type { WorksCitedResult } from '../components/documentMarks'
import { scheduleFrame } from '../frameScheduler'
import type { DocumentMark, MarkRect } from '../components/documentMarks'
import TextArea from '../components/TextArea'
import { DocumentIcon, CloseIcon, BackIcon } from '../components/icons'
import { tracelyApi } from '../lib/api'
import type { Tab } from '../App'


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
/**
 * What one completed citation insert did to the document — both halves of it.
 *
 * Returned rather than kept internal because the confirmation card reports on
 * it ("ADDED TO WORKS CITED" vs "ALREADY IN WORKS CITED") and Undo has to
 * unwind it, and both used to assume a single edit that only ever touched the
 * sentence.
 */
interface CitationInsert {
  worksCited: WorksCitedResult
  /** The bibliography line, as written into the document's reference list. */
  worksCitedEntry: string
  /** execCommand steps taken, for Undo. */
  undoSteps: number
}

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
  // The editor's visible box, as of the hover that opened the popover — see
  // handleBodyMouseMove for why it is sampled there and not on every measure.
  const [wrapView, setWrapView] = useState({ height: 0, scrollTop: 0 })
  // Claims the writer has waved away this session. Client-side only: a
  // dismissal is "I know, leave me alone while I finish this paragraph", not a
  // durable judgement about the sentence, and persisting it would mean a real
  // problem could be hidden forever by one impatient click.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // How many articles each claim's evidence search returned, by claim id.
  //
  // Read out of the evidence table rather than off the claim, because the claim
  // does not carry it — `scoreBreakdown.sourceCount` is the 0..1 fraction that
  // cleared the relevance floor, and feeding that to the popover printed
  // "0.667 sources" (see claimEvidenceFor). A claim absent from this map is not
  // marked at all, so the number the card quotes is always one that was read.
  //
  // The score each count was read at is kept beside it so a re-run search
  // invalidates the entry. Several places can re-search one claim (checkClaims
  // here, the report's per-claim button), and all of them land back here as a
  // changed score rather than as a notification.
  const [countedEvidence, setCountedEvidence] = useState<
    ReadonlyMap<string, { score: number; count: number }>
  >(new Map())
  const articleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const [id, entry] of countedEvidence) counts.set(id, entry.count)
    return counts
  }, [countedEvidence])
  // Bumped whenever something that moves text happens, to re-measure. A counter
  // rather than the text itself: identical text can still need re-measuring
  // after a font or alignment change.
  const [measureTick, setMeasureTick] = useState(0)
  // The pointer is inside the popover, so leaving the underline must not close
  // it — otherwise the card vanishes as you reach for its buttons.
  const insidePopoverRef = useRef(false)

  // ---- The popover's citation flow ---------------------------------------
  //
  // "Find a Source" -> "Add Citation", the same three frames Screen Watch draws
  // over other applications. Owned here rather than inside the popover because
  // the popover unmounts the instant the pointer leaves the sentence, and this
  // flow takes seconds of reading and two or three clicks — state living in the
  // card would be destroyed by the first mouse movement after starting it.
  //
  // One at a time, unlike the overlay's per-claim map: only one sentence's
  // popover is ever open here, and a flow left running on a sentence nobody is
  // looking at is a card that can never be reached again.
  const [citationFlow, setCitationFlow] = useState<{
    claimId: string
    state: DocCitationFlowState
  } | null>(null)
  const [citationBusy, setCitationBusy] = useState<'inserting' | 'previewing' | 'undoing' | null>(null)
  // While a flow is open its mark is pinned: the hit-test must not swap the
  // popover to another underline the pointer happens to cross on its way to a
  // button, and leaving the card must not close it.
  /**
   * "Suggest fix", run in place. Same ownership argument as `citationFlow`, and
   * the same pinning — a card the pointer can drag out from under itself is
   * unusable, and this one has an Apply button on it.
   */
  const [fixFlow, setFixFlow] = useState<{ claimId: string; state: DocFixState } | null>(null)
  const [fixBusy, setFixBusy] = useState<'applying' | 'undoing' | null>(null)
  const flowPinnedRef = useRef(false)
  useEffect(() => {
    flowPinnedRef.current = citationFlow !== null || fixFlow !== null
  }, [citationFlow, fixFlow])
  // The `Source` objects behind the current candidate list. Held in a ref
  // rather than in the flow state because they are only ever read to format a
  // citation — putting a full Source per row into state would re-render the
  // popover on every field of a record nothing in it displays.
  const flowSourcesRef = useRef<Map<string, Source>>(new Map())
  // How many execCommand steps the last insert took, so Undo unwinds exactly
  // that many — see undoFlowCitation. A ref rather than flow state because it
  // describes the browser's undo stack, not anything the card draws.
  const undoStepsRef = useRef(1)

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
   * Loads the article count for every claim whose search has resolved.
   *
   * Reads persisted rows out of the local database — no relay call, no network
   * — and only for claims whose count is missing or was read at a different
   * score, so re-running detection or checking one more claim costs one read
   * rather than a full sweep.
   */
  useEffect(() => {
    const pending = (claims ?? []).filter(
      (claim) =>
        claim.strengthScore !== null &&
        countedEvidence.get(claim.id)?.score !== claim.strengthScore
    )
    if (pending.length === 0) return
    let cancelled = false
    void Promise.all(
      pending.map(async (claim) => {
        try {
          const res = await tracelyApi.getEvidenceForClaim(claim.id)
          return [claim.id, { score: claim.strengthScore as number, count: res.evidence.length }] as const
        } catch {
          // One claim's read failing must not withhold the others' marks.
          return null
        }
      })
    ).then((entries) => {
      if (cancelled) return
      const found = entries.filter(
        (entry): entry is readonly [string, { score: number; count: number }] => entry !== null
      )
      if (found.length === 0) return
      setCountedEvidence((prev) => {
        const next = new Map(prev)
        for (const [id, entry] of found) next.set(id, entry)
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [claims, countedEvidence])

  /**
   * Re-measures the underlines.
   *
   * useLayoutEffect, not useEffect: these are absolute positions over live
   * text, and measuring after paint shows the marks in their old places for a
   * frame every time the text reflows — visible as a flicker on every keystroke
   * in a flagged paragraph.
   *
   * Frame-batched because a keystroke fires this and a ResizeObserver callback
   * in the same tick, and getClientRects forces layout each time.
   *
   * scheduleFrame rather than requestAnimationFrame directly: Chromium freezes
   * rAF on a page that is not compositing, and a bare rAF here meant the marks
   * were never measured at all in a hidden window — no underlines drawn, and no
   * way to reach the hover popover that opens on one from the preview harness.
   * The batching is unchanged whenever there is a frame to batch against; see
   * frameScheduler.ts.
   */
  useLayoutEffect(() => {
    const body = editorRef.current
    const wrap = wrapRef.current
    if (!body || !wrap) return
    return scheduleFrame(window, () => {
      const live = (claims ?? []).filter((claim) => !dismissed.has(claim.id))
      setMarks(measureMarks(body, wrap, live, articleCounts))
      setWrapWidth(wrap.clientWidth)
    })
    // `structureOpen` was a dependency here: opening the rail narrowed the
    // editor, so every mark had to be re-measured. With the rail gone the
    // editor's width no longer changes from inside this component.
  }, [claims, dismissed, articleCounts, measureTick, fontFamily, fontSize, align])

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
    // A running citation flow owns the popover until it is finished or
    // cancelled. Without this, reaching across another underline on the way to
    // "Insert citation" swaps the card out from under the cursor.
    if (flowPinnedRef.current) return
    const rect = wrap.getBoundingClientRect()
    const x = event.clientX - rect.left + wrap.scrollLeft
    const y = event.clientY - rect.top + wrap.scrollTop
    const hit = markAt(marks, x, y)
    if (!hit) {
      if (activeMark) setActiveMark(null)
      return
    }
    if (activeMark?.mark.claim.id === hit.mark.claim.id) return
    // Captured here rather than in the measure effect: scrolling changes
    // scrollTop without re-rendering this component, and the popover decides
    // whether it fits below the sentence from where the visible box sits. Read
    // at the moment of the hover, it is right by construction.
    setWrapView({ height: wrap.clientHeight, scrollTop: wrap.scrollTop })
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
  async function insertCitation(claim: Claim, source: Source, style: CitationStyle): Promise<CitationInsert> {
    const body = editorRef.current
    if (!body) throw new Error('The editor is not open.')

    // The works-cited entry FIRST, then the marker. Both halves of a citation
    // are written by every path that can insert one — the popover flow and the
    // report's per-claim button — because a marker with no reference behind it
    // is precisely the state the "ADDED TO WORKS CITED" label used to describe.
    //
    // The order buys two things, spelled out at addWorksCitedEntry: the list
    // sits after the claim so writing it does not move the sentence out from
    // under insertCitationForClaim, and the marker ends up on top of the undo
    // stack so the first Ctrl+Z removes what the writer is looking at.
    //
    // Through IPC because that is where the style formatters live; the result
    // is cached in the citations table, so the second sentence to cite the same
    // source does not pay for it again.
    const { citation } = await tracelyApi.generateCitation(source.id, style)
    const worksCited = addWorksCitedEntry(body, {
      entry: citation,
      sourceTitle: source.title,
      style
    })

    // Formatted here rather than through an IPC round-trip: formatInTextCitation
    // is a pure function of a Source the renderer already holds (it came back
    // with the evidence), so a channel for it would be a channel that reads
    // nothing main knows and the renderer does not.
    if (!insertCitationForClaim(body, claim, formatInTextCitation(source, style))) {
      // Roll the reference back out. A works-cited entry for a citation that
      // never reached the sentence is an orphan, and it would be one the writer
      // was never told about — the throw below is about the marker.
      if (worksCited === 'added') {
        body.focus()
        document.execCommand('undo')
        handleInput()
      }
      throw new Error(
        'Could not find that sentence in the document any more — it may have been edited since the search.'
      )
    }
    handleInput()
    const analysisId = analysisIdRef.current
    if (analysisId) await onRefreshClaims(analysisId)
    return {
      worksCited,
      worksCitedEntry: citation,
      // What Undo has to unwind. One insertText per half, and only one when the
      // source was already listed — undoing a step that was never taken eats
      // the writer's previous edit instead.
      undoSteps: worksCited === 'added' ? 2 : 1
    }
  }

  /**
   * "Add citation" / "Find a source" on the hover popover — the four frames
   * from Figma, run in place over the sentence rather than by opening a modal.
   *
   * Reads what is already stored before searching anything. A marked claim has
   * been checked by definition (measureMarks refuses to draw one that has not),
   * so re-running the four academic APIs to redraw a list already in the
   * database would make pressing the button cost a 15-45 second wait for a
   * result we hold. "Search again" is the button that spends that.
   */
  async function startCitationFlow(claim: Claim, fresh: boolean): Promise<void> {
    setCitationFlow({ claimId: claim.id, state: { step: 'searching' } })
    try {
      const res = fresh ? await tracelyApi.findEvidence(claim.id) : await tracelyApi.getEvidenceForClaim(claim.id)
      const evidence = res.evidence
      flowSourcesRef.current = new Map(evidence.map((item) => [item.source.id, item.source]))
      // A stored read that comes back empty means nothing has been searched for
      // this claim yet, not that nothing exists — fall through to a real search
      // rather than printing "No sources found" over an unasked question.
      if (!fresh && evidence.length === 0) {
        await startCitationFlow(claim, true)
        return
      }
      if (fresh) {
        // The claim now has a new strength score in the database; the marks are
        // drawn from it, so they have to be re-read or the underline that
        // prompted this still reports the old search.
        const analysisId = analysisIdRef.current
        if (analysisId) await onRefreshClaims(analysisId)
      }
      setCitationFlow((prev) =>
        prev?.claimId !== claim.id
          ? prev
          : {
              claimId: claim.id,
              state: {
                step: 'picking',
                candidates: evidence.map((item) => ({
                  sourceId: item.source.id,
                  title: item.source.title,
                  venue: item.source.venue,
                  year: item.source.year,
                  matchPercent: Math.round(item.relevanceScore * 100),
                  initials: sourceInitials(item.source.venue ?? item.source.title)
                })),
                selectedId: evidence[0]?.source.id ?? null,
                style: citationStyle,
                preview: null
              }
            }
      )
    } catch (err) {
      setCitationFlow((prev) =>
        prev?.claimId !== claim.id
          ? prev
          : { claimId: claim.id, state: { step: 'error', message: err instanceof Error ? err.message : String(err) } }
      )
    }
  }

  /**
   * Both drop `preview`: it was formatted from the source and style being
   * replaced, so keeping it would show a citation for something other than what
   * "Insert citation" is now about to write.
   */
  function updatePicking(
    change: (state: Extract<DocCitationFlowState, { step: 'picking' }>) => DocCitationFlowState
  ): void {
    setCitationFlow((prev) =>
      prev && prev.state.step === 'picking' ? { ...prev, state: change(prev.state) } : prev
    )
  }

  /**
   * Formats the selection without writing it.
   *
   * The in-text marker is a pure function of a `Source` the renderer already
   * holds, so it is formatted here; the works-cited entry goes through
   * `generateCitation`, which is where the style formatters live (and which
   * caches its result in the citations table).
   */
  async function previewFlowCitation(): Promise<void> {
    const flow = citationFlow
    if (flow?.state.step !== 'picking' || !flow.state.selectedId) return
    const { selectedId, style } = flow.state
    const source = flowSourcesRef.current.get(selectedId)
    if (!source) return
    setCitationBusy('previewing')
    try {
      const { citation } = await tracelyApi.generateCitation(selectedId, style)
      // Re-read rather than closing over `flow`: the selection or the style may
      // have moved on while this was in flight, and a preview of the previous
      // pair is exactly the stale block the `preview: null` resets prevent.
      updatePicking((state) =>
        state.selectedId !== selectedId || state.style !== style
          ? state
          : {
              ...state,
              preview: {
                inTextCitation: formatInTextCitation(source, style),
                worksCitedEntry: citation
              }
            }
      )
    } catch (err) {
      setCitationFlow({
        claimId: flow.claimId,
        state: { step: 'error', message: err instanceof Error ? err.message : String(err) }
      })
    } finally {
      setCitationBusy(null)
    }
  }

  async function insertFlowCitation(claim: Claim): Promise<void> {
    const flow = citationFlow
    if (flow?.state.step !== 'picking' || !flow.state.selectedId) return
    const { selectedId, style } = flow.state
    const source = flowSourcesRef.current.get(selectedId)
    if (!source) return
    setCitationBusy('inserting')
    try {
      const result = await insertCitation(claim, source, style)
      undoStepsRef.current = result.undoSteps
      setCitationFlow({
        claimId: claim.id,
        state: {
          step: 'inserted',
          citation: {
            inTextCitation: formatInTextCitation(source, style),
            // The entry as it was actually written, not a second formatting of
            // the same source — the card is a report of what happened.
            worksCitedEntry: result.worksCitedEntry
          },
          style,
          worksCited: result.worksCited
        }
      })
    } catch (err) {
      setCitationFlow({
        claimId: claim.id,
        state: { step: 'error', message: err instanceof Error ? err.message : String(err) }
      })
    } finally {
      setCitationBusy(null)
    }
  }

  /**
   * Takes the citation back out through the browser's own undo stack.
   *
   * `insertCitationForClaim` writes with `execCommand('insertText')` precisely
   * so this is possible — and so that Ctrl+Z does the same thing this button
   * does, rather than the two disagreeing about what the last edit was.
   *
   * As many steps as the insert took, which is two once the works-cited entry
   * is written as its own insertText. A single undo here left the reference
   * behind — an entry in the list for a citation no longer in the text, which
   * is the orphan the whole feature is supposed to prevent. (Ctrl+Z is still
   * one step per press; that is the browser's stack behaving normally, and both
   * presses land on the same two edits this button unwinds.)
   */
  async function undoFlowCitation(): Promise<void> {
    const body = editorRef.current
    if (!body) return
    setCitationBusy('undoing')
    try {
      body.focus()
      for (let i = 0; i < undoStepsRef.current; i++) document.execCommand('undo')
      undoStepsRef.current = 1
      handleInput()
      const analysisId = analysisIdRef.current
      if (analysisId) await onRefreshClaims(analysisId)
      setCitationFlow(null)
      setActiveMark(null)
    } finally {
      setCitationBusy(null)
    }
  }

  /**
   * Types the critique's narrowed sentence over the writer's own.
   *
   * The one place in this product where Tracely edits a student's prose, and it
   * is bounded to the same thing the relay is bounded to: `suggestedRevision`
   * carries the SAME sentence with only its quantifier, scope or hedge moved
   * (and `normalizeCritique.isNarrowing` drops any revision that introduces a
   * named thing the original did not contain). It corrects what the sentence
   * claims, not how it reads — which is why this is allowed to exist beside a
   * prompt that refuses to write sentences for students.
   *
   * Through `replaceClaimText`, i.e. through execCommand, so this lands on the
   * browser's undo stack as ONE step: Ctrl+Z and the card's Undo are the same
   * escape hatch rather than two that disagree.
   */
  async function applyFixRevision(claim: Claim): Promise<void> {
    const body = editorRef.current
    const revision = claim.suggestedRevision
    if (!body || !revision) return
    setFixBusy('applying')
    try {
      if (!replaceClaimText(body, claim, revision)) {
        // Refused rather than rewritten at a guessed offset — the draft moved
        // on since the critique ran, and the sentence this card is about may
        // not be the sentence sitting at those offsets now.
        setFixFlow({ claimId: claim.id, state: { step: 'error', message: APPLY_LOST_CLAIM } })
        return
      }
      handleInput()
      setFixFlow({ claimId: claim.id, state: { step: 'applied' } })
      // Re-read, for the reason insertCitation re-reads: the underline that
      // prompted this is drawn from the stored claim, whose text no longer
      // matches the document. Left alone it keeps accusing a sentence that has
      // already been narrowed.
      const analysisId = analysisIdRef.current
      if (analysisId) await onRefreshClaims(analysisId)
    } finally {
      setFixBusy(null)
    }
  }

  /** The same undo stack Ctrl+Z uses — see undoFlowCitation. */
  async function undoFixRevision(): Promise<void> {
    const body = editorRef.current
    if (!body) return
    setFixBusy('undoing')
    try {
      body.focus()
      document.execCommand('undo')
      handleInput()
      const analysisId = analysisIdRef.current
      if (analysisId) await onRefreshClaims(analysisId)
      setFixFlow(null)
      setActiveMark(null)
    } finally {
      setFixBusy(null)
    }
  }

  function closeFixFlow(): void {
    setFixFlow(null)
  }

  function closeCitationFlow(): void {
    setCitationFlow(null)
    setActiveMark(null)
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
   * progress it cannot back. (The reference here used to be AnalyzingPanel,
   * the old landing's fake progress bar; it and the landing are gone, but the
   * rule it stood for is the reason this loop is serial.) One claim at a time
   * means the count is real and partial results land as they arrive.
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
          if (!insidePopoverRef.current && !flowPinnedRef.current) setActiveMark(null)
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
          wrapHeight={wrapView.height}
          wrapScrollTop={wrapView.scrollTop}
          flow={
            citationFlow && activeMark
              ? {
                  claimId: citationFlow.claimId,
                  state: citationFlow.state,
                  inserting: citationBusy === 'inserting',
                  previewing: citationBusy === 'previewing',
                  undoing: citationBusy === 'undoing',
                  // The other flagged sentences. `marks` already excludes
                  // dismissed and resolved claims, so this is the number the
                  // writer would see underlined if they closed the card now.
                  flagsRemaining: Math.max(0, marks.length - 1),
                  onSelect: (sourceId) =>
                    setCitationFlow((prev) =>
                      prev && prev.state.step === 'picking'
                        ? { ...prev, state: { ...prev.state, selectedId: sourceId, preview: null } }
                        : prev
                    ),
                  onSetStyle: (style) =>
                    setCitationFlow((prev) =>
                      prev && prev.state.step === 'picking'
                        ? { ...prev, state: { ...prev.state, style, preview: null } }
                        : prev
                    ),
                  onSearchAgain: () => void startCitationFlow(activeMark.mark.claim, true),
                  onPreview: () => void previewFlowCitation(),
                  onInsert: () => void insertFlowCitation(activeMark.mark.claim),
                  onCancel: closeCitationFlow,
                  onDone: closeCitationFlow,
                  // Goes to the list rather than folding a block. Closing the
                  // flow first is deliberate: the popover is anchored to the
                  // sentence being cited, and leaving it open while the editor
                  // scrolls to the end of the document parks the card over
                  // whatever text happens to be under those coordinates now.
                  onViewWorksCited: () => {
                    const body = editorRef.current
                    closeCitationFlow()
                    if (body) revealWorksCited(body)
                  },
                  onUndo: () => void undoFlowCitation()
                }
              : null
          }
          // "Add citation" / "Find a source" now runs the flow in place, over
          // the sentence it is about. It used to open the report modal on the
          // claim instead: a full-screen context switch away from the paragraph
          // being written, to answer a question asked about one of its lines.
          fix={
            fixFlow && activeMark
              ? {
                  claimId: fixFlow.claimId,
                  state: fixFlow.state,
                  applying: fixBusy === 'applying',
                  undoing: fixBusy === 'undoing',
                  onApply: () => void applyFixRevision(activeMark.mark.claim),
                  onUndo: () => void undoFixRevision(),
                  onCancel: closeFixFlow,
                  onDone: closeFixFlow
                }
              : null
          }
          onFindSource={(mark) => void startCitationFlow(mark.claim, false)}
          // Opens the fix in the popover, over the sentence it is about. It used
          // to call setScoreOpen(true) — the full-screen Argument Score report,
          // i.e. exactly the context switch away from the paragraph being
          // written that the citation flow had just stopped doing. Nothing is
          // fetched: every word the card shows was written onto the claim by the
          // critique that raised this underline, so opening it cannot spend
          // anything on the relay.
          onSuggestFix={(mark) => setFixFlow({ claimId: mark.claim.id, state: { step: 'open' } })}
          onDismiss={(mark) => {
            setDismissed((prev) => new Set(prev).add(mark.claim.id))
            setActiveMark(null)
          }}
          onPopoverEnter={() => {
            insidePopoverRef.current = true
          }}
          onPopoverLeave={() => {
            insidePopoverRef.current = false
            if (!flowPinnedRef.current) setActiveMark(null)
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
          // Re-read the claims the moment the report searches one. This is what
          // closes the loop that made the editor's underlines unreachable: the
          // report is the only place a first evidence search can start, and
          // until now its result never came back here.
          onEvidenceSearched={() => {
            const analysisId = analysisIdRef.current
            if (analysisId) void onRefreshClaims(analysisId)
          }}
          // The bulk sweep. It lives here rather than in the modal because it
          // is serial with a visible count, and `checkClaims` re-reads the
          // claims and the outline when it finishes — closing the modal
          // mid-sweep must not abandon either.
          onCheckClaims={(ids) => void checkClaims(ids)}
          checking={checking}
          onClose={() => setScoreOpen(false)}
        />
      ) : null}

    </div>
  )
}

/** The title a document starts life with. Editable inline the moment the editor
 *  opens, which is why "+ New document" does not stop to ask for one. */
const UNTITLED = 'Untitled document'

/**
 * The document editor.
 *
 * It used to open onto a landing of its own — "Start a new session", a
 * "Name your document…" field and a Create Document button. That screen is gone
 * (see views/DocumentsView.tsx): naming was a gate in front of typing, and the
 * field's EMPTY state doubled as "continue the last document", which was the
 * only route back to previous work anywhere in the app — so any draft that was
 * not the most recent one was unreachable. The Documents page lists every
 * draft, so this view now only ever opens ON one.
 */
export default function AnalyzeView({
  onNavigate,
  openDocumentId
}: {
  onNavigate: (tab: Tab) => void
  /** Which document to open. `null` starts a new, untitled one. */
  openDocumentId: string | null
}): JSX.Element {
  const [docName, setDocName] = useState(UNTITLED)
  // Fetched by id rather than "the most recent one", which is what reopening
  // used to mean.
  const [initialDoc, setInitialDoc] = useState<DocumentRecord | null>(null)
  const [docLoaded, setDocLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (openDocumentId === null) {
      setInitialDoc(null)
      setDocName(UNTITLED)
      setDocLoaded(true)
      return
    }
    tracelyApi
      .getDocument(openDocumentId)
      .then((res) => {
        if (cancelled) return
        setInitialDoc(res.document)
        setDocName(res.document?.title || UNTITLED)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDocLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [openDocumentId])
  const [claims, setClaims] = useState<Claim[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resolves with the analysis id so the document editor's Structure rail can
  // chain onto it. Called from the editor only, now that pasted text is gone.
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

  // Nothing renders until we know WHICH document this is: mounting the editor
  // first and swapping `initialDoc` in afterwards would run its restore-once
  // effect against an empty body and then never re-run.
  if (!docLoaded) {
    return <div className="analyze-view" />
  }

  return (
    <DocumentEditor
      // Remounts when the target document changes, so the restore-once effect
      // inside runs against the right body.
      key={openDocumentId ?? 'new'}
      docName={docName}
      onDocNameChange={setDocName}
      // Back goes to the list it was opened from, not to Home — the Documents
      // page is this view's parent now.
      onBack={() => {
        setClaims(null)
        setError(null)
        onNavigate('documents')
      }}
      onRunInsights={runDetection}
      onRefreshClaims={refreshClaims}
      insightsLoading={loading}
      claims={claims}
      error={error}
      initialDoc={initialDoc}
      onSaved={setInitialDoc}
    />
  )
}
