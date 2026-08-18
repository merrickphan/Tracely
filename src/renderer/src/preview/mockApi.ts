import { hasInlineCitation } from '@shared/inlineCitation'
import type {
  ScreenWatchClaimSummary,
  ScreenWatchWidget,
  ScreenWatchHoverEvent,
  ScreenWatchOverlayUpdateEvent
} from '@shared/ipc-contract'
import type {
  AppSettings,
  AuthUser,
  Claim,
  DocumentOutline,
  DocumentListItem,
  DocumentRecord,
  EvidenceCoverage,
  ScoreBreakdown
} from '@shared/types'

// Deliberately `Window['tracely']` rather than a direct import of
// src/preload/index.ts. Both resolve to the same `TracelyApi`, but pulling
// the preload *implementation* into the renderer's tsconfig program drags
// electron's Node-flavoured typings in with it and degrades inference across
// every renderer file. The global is already declared by
// src/preload/index.d.ts, which tsconfig.web.json includes.
type TracelyApi = Window['tracely']
import * as fx from './fixtures'

// ---------------------------------------------------------------------------
// THE DRIFT GUARD
//
// `createMockApi` returns `TracelyApi` — the exact type the real preload
// bridge exports (`typeof api`). It is not a loose stand-in: add, rename or
// re-shape any method in src/preload/index.ts and `npm run typecheck` fails
// here until this file is updated too. tsconfig.web.json includes preview/,
// specifically so that check runs in CI and in `npm run preflight`.
//
// That is the entire reason this harness is worth having. A hand-maintained
// copy of the UI would rot in a week; this one cannot silently fall behind
// the contract it mocks.
// ---------------------------------------------------------------------------

/** Which variant of the world the preview is rendering. */
export type Scenario = {
  /** Signed-in state — drives App.tsx's auth gate. */
  auth: 'ready' | 'signedOut' | 'needsName' | 'notConfigured'
  /** With no relay compiled in, every relay-backed action refuses up front. */
  relayConfigured: boolean
  /** Make every relay-backed call reject, to review error states. */
  failRelay: boolean
  /** Add a delay to async calls so loading states are actually visible. */
  latencyMs: number
  /**
   * Which Structure outline to serve.
   *
   * 'heuristic' is what the local rules produce with no relay: two paragraphs
   * unlabelled, `complete: false`, whole-draft weaknesses withheld. 'none'
   * covers a document that has never been analyzed, and 'stale' one edited
   * since. The confident, fully classified state is otherwise unreachable in
   * the preview, since there is no relay behind the harness to produce it.
   */
  structure: 'heuristic' | 'classified' | 'stale' | 'none'
  /**
   * Screen Watch has text it has not produced a reading for yet — the overlay's
   * Analyzing card (Figma 391:342).
   *
   * Its own switch rather than a value of `structure` above, which serves the
   * main window's Structure rail: this one drops `widget.structure` AND sets
   * `widget.analyzing`, and those two travel together in exactly one direction
   * (see ScreenWatchWidget.analyzing). In the real product the state lasts as
   * long as one detection pass, which is not long enough to review.
   */
  watchAnalyzing: boolean
}

/** What a claim's breakdown looks like once a search has found something. */
const FOUND_BREAKDOWN: ScoreBreakdown = {
  sourceCount: 0.33,
  quality: 0.6,
  recency: 0.7,
  relevance: 0.5,
  support: 0
}

export const defaultScenario: Scenario = {
  auth: 'ready',
  relayConfigured: true,
  failRelay: false,
  latencyMs: 0,
  structure: 'heuristic',
  watchAnalyzing: false
}

/** Names of every call the harness logs, so the UI can show what fired. */
export type CallLogEntry = { at: number; method: string }

export function createMockApi(scenario: Scenario, log: (method: string) => void): TracelyApi {
  let latency = scenario.latencyMs

  async function ok<T>(method: string, value: T): Promise<T> {
    log(method)
    if (latency > 0) await new Promise((r) => setTimeout(r, latency))
    return value
  }

  async function relay<T>(method: string, value: T): Promise<T> {
    log(method)
    if (latency > 0) await new Promise((r) => setTimeout(r, latency))
    if (scenario.failRelay) {
      throw new Error('Relay request failed: 503 Service Unavailable (preview scenario)')
    }
    return value
  }

  // Event subscriptions: fire the fixture payload once on the next tick so
  // components that only ever render from a pushed event (the overlay, most
  // of all) have something to draw, then return a real unsubscribe.
  function subscribe<T>(method: string, payload: T, cb: (value: T) => void): () => void {
    log(`${method} (subscribe)`)
    const id = window.setTimeout(() => cb(payload), 0)
    return () => window.clearTimeout(id)
  }

  const authUser = (): AuthUser | null => {
    if (scenario.auth === 'signedOut') return null
    if (scenario.auth === 'needsName') return { ...fx.user, firstName: null }
    return fx.user
  }

  // Mutable so an evidence search visibly resolves a claim, exactly as the
  // real store would. Reset per document, like every other bit of preview
  // state, because the mock is constructed once per bridge.
  let previewClaims: Claim[] = [...fx.claims]
  // DocumentListItem, because the Documents page lists grades — a
  // DocumentRecord[] here would make the mock the one place those are absent.
  let previewDocs: DocumentListItem[] = [...fx.documents]
  let previewSettings: AppSettings = { ...fx.settings }
  // Screen Watch's claims are pushed, not fetched: the real service folds a
  // refresh or a critique into its in-memory claim and redraws the overlay, so
  // the panel's two result states are only reachable here if the mock does the
  // same. Without this, "Critique Argument" logged an IPC call and the card
  // never changed.
  let watchClaims: ScreenWatchClaimSummary[] = [...fx.screenWatchClaims]
  // The contract's own union, not a copy of it. This was spelled out by hand
  // and so silently stopped covering the panel's modes the moment one was
  // added — which is exactly the drift this harness exists to catch.
  let lastWidget: { expanded: boolean; viewMode: ScreenWatchWidget['viewMode'] } = {
    expanded: fx.overlayUpdate.widget?.expanded ?? false,
    viewMode: fx.overlayUpdate.widget?.viewMode ?? 'single'
  }

  function patchWatchClaim(claimId: string, patch: Partial<ScreenWatchClaimSummary>): void {
    watchClaims = watchClaims.map((c) => (c.id === claimId ? { ...c, ...patch } : c))
    emitWidget({})
  }
  let nextId = 100

  /** Mirrors computeEvidenceCoverage in the main process. */
  const coverageOf = (claims: Claim[]): EvidenceCoverage => {
    const resolved = claims.filter((c) => c.strengthScore !== null)
    return {
      detected: claims.length,
      withRelevantSource: claims.filter((c) => (c.scoreBreakdown?.sourceCount ?? 0) > 0).length,
      withOwnCitation: claims.filter((c) => hasInlineCitation(c.text)).length,
      meanStrength: resolved.length
        ? Math.round(resolved.reduce((sum, c) => sum + (c.strengthScore ?? 0), 0) / resolved.length)
        : null,
      unchecked: claims.length - resolved.length
    }
  }

  const outlineForScenario = (): DocumentOutline | null => {
    if (scenario.structure === 'none') return null
    return scenario.structure === 'classified' ? fx.documentOutlineClassified : fx.documentOutline
  }

  // Rebuild the overlay payload the way screenWatchService would, so the
  // widget's own controls actually move it. Panel size is computed in main in
  // production (hoverTracking.ts hit-tests the same rect the renderer draws),
  // so the sizes here mirror panelSize.ts — if they drift, the preview lies
  // about how much room the content has.
  function emitWidget(patch: {
    expanded?: boolean
    viewMode?: ScreenWatchWidget['viewMode']
  }): void {
    const w = window as Window & {
      __previewEmitOverlay?: (e: ScreenWatchOverlayUpdateEvent) => void
    }
    if (!w.__previewEmitOverlay) return
    const base = fx.overlayUpdate.widget
    if (!base) return
    const viewMode = patch.viewMode ?? lastWidget.viewMode
    const expanded = patch.expanded ?? lastWidget.expanded
    lastWidget = { expanded, viewMode }
    // Taken from panelSize.ts for this fixture's shape (3 claims, 4 weaknesses,
    // 6 paragraphs), not estimated: PANEL_WIDTH = 480, SINGLE_PANEL_HEIGHT =
    // 532, computeAllPanelSize(3) = 313, computeStructurePanelSize({4, 6}) =
    // 568. Guessing these makes the preview claim more or less room than the
    // real panel has, which is the one thing it must not do — re-read them from
    // that module whenever its constants change rather than adjusting by eye.
    // 'grade' is the one mode with its own width and its own anchor:
    // GRADE_PANEL_WIDTH/HEIGHT = 560x321, centred rather than cornered. Sized
    // wrong here it still *renders*, but its two 251px pills flex down to fit a
    // 480px box and the harness quietly shows a card the product never draws.
    // ANALYZING_PANEL_* is 340x204 — its own size, not the grade card's, and
    // centred the same way. Reachable only through the rail's Screen Watch
    // switch; see Scenario.watchAnalyzing.
    const rect = expanded
      ? viewMode === 'grade'
        ? scenario.watchAnalyzing
          ? { x: 210, y: 138, width: 340, height: 204 }
          : { x: 100, y: 80, width: 560, height: 321 }
        : viewMode === 'report'
          ? // REPORT_PANEL_* is 560x1210, which main clamps to the watched
            // window. 760x480 here is smaller than most, so this is the clamped
            // height — the harness should show the scrolling case, not a
            // 1210px card no real window would give it.
            { x: 100, y: 8, width: 560, height: 464 }
          : viewMode === 'paragraph'
            ? // PARAGRAPH_PANEL_* is 520x930, clamped the same way.
              { x: 120, y: 8, width: 520, height: 464 }
        : {
            x: 90,
            y: 20,
            width: 480,
            height: viewMode === 'single' ? 532 : viewMode === 'all' ? 313 : 568
          }
      : { x: 520, y: 300, width: 56, height: 56 }
    w.__previewEmitOverlay({
      ...fx.overlayUpdate,
      widget: {
        ...base,
        claims: watchClaims,
        rect,
        expanded,
        viewMode,
        // Together, never apart: `analyzing` means "no reading YET", so leaving
        // the fixture's structure in place would push a state main cannot
        // produce and let the harness pass a card that never renders for real.
        structure: scenario.watchAnalyzing ? null : base.structure,
        analyzing: scenario.watchAnalyzing
      }
    })
  }

  return {
    analyze: {
      detectClaims: () => relay('analyze.detectClaims', { analysisId: fx.analysis.id, claims: fx.claims }),
      getResult: () =>
        ok('analyze.getResult', { analysis: fx.analysis, claims: previewClaims, evidenceByClaimId: {} })
    },
    evidence: {
      // Records the result against the claim, so the Structure rail's
      // "Check if supportable" flow can actually be reviewed: without this the
      // claim stays unchecked forever and the button never resolves into a
      // score, which is the half of the interaction worth looking at.
      find: (req) => {
        previewClaims = previewClaims.map((claim) =>
          claim.id === req.claimId && claim.strengthScore === null
            ? { ...claim, strengthScore: 42, scoreBreakdown: FOUND_BREAKDOWN }
            : claim
        )
        return ok('evidence.find', {
          evidence: fx.evidence,
          strengthScore: fx.claims[0].strengthScore ?? 0,
          // `support` is how much of the evidence actually agrees with the
          // claim — see search/scoring.ts. Zero here means "no stance verdict",
          // which is the honest default for a fixture.
          scoreBreakdown: fx.claims[0].scoreBreakdown ?? {
            sourceCount: 0,
            quality: 0,
            recency: 0,
            relevance: 0,
            support: 0
          }
        })
      },
      getForClaim: () => ok('evidence.getForClaim', { evidence: fx.evidence })
    },
    citation: {
      generate: () => ok('citation.generate', { citation: fx.citations[0].formattedText }),
      list: () => ok('citation.list', { citations: fx.citations })
    },
    critique: {
      generate: () =>
        relay('critique.generate', {
          critique: fx.claims[0].critique ?? '',
          verdict: fx.claims[0].critiqueVerdict ?? 'weak',
          // Null is the realistic default: a correction is only produced when
          // the stance model finds a source that contradicts the claim, which
          // is rare and currently never (see task #17).
          correction: null
        })
    },
    library: {
      save: () => ok('library.save', { item: fx.libraryItems[0] }),
      // Honours `search` rather than always returning everything, so the
      // Library view's no-results state is reachable in the preview. Roughly
      // what libraryRepo.listLibrary matches on.
      list: (req) =>
        ok('library.list', {
          items: req.search
            ? fx.libraryItems.filter((i) =>
                `${i.source.title} ${i.source.authors.map((a) => a.family).join(' ')} ${i.notes ?? ''}`
                  .toLowerCase()
                  .includes(req.search!.toLowerCase())
              )
            : fx.libraryItems
        }),
      get: () => ok('library.get', { item: fx.libraryItems[0], citations: fx.citations }),
      update: () => ok('library.update', { item: fx.libraryItems[0] }),
      remove: () => ok('library.remove', { ok: true as const })
    },
    documents: {
      // Backed by a module-level store so autosave, reload-last and the
      // document list actually behave like storage in the preview instead of
      // returning one frozen fixture.
      list: () => ok('documents.list', { documents: previewDocs }),
      get: (req) => ok('documents.get', { document: previewDocs.find((d) => d.id === req.id) ?? null }),
      latest: () => ok('documents.latest', { document: previewDocs[0] ?? null }),
      save: (req) => {
        const now = fx.T0
        const existing = req.id ? previewDocs.find((d) => d.id === req.id) : undefined
        const doc = existing
          ? { ...existing, title: req.title, bodyHtml: req.bodyHtml, updatedAt: now }
          : {
              id: `doc-${nextId++}`,
              title: req.title,
              bodyHtml: req.bodyHtml,
              createdAt: now,
              updatedAt: now,
              // A brand-new document has not been read, so it has no grade —
              // the same state main returns for a row with no
              // document_structure behind it. Seeding a score here would make
              // "+ New document" produce a graded card in the preview and
              // an ungraded one in the app.
              score: null,
              gradedAt: null
            }
        previewDocs = [doc, ...previewDocs.filter((d) => d.id !== doc.id)]
        return ok('documents.save', { document: doc })
      },
      remove: (req) => {
        previewDocs = previewDocs.filter((d) => d.id !== req.id)
        return ok('documents.remove', { ok: true as const })
      }
    },
    structure: {
      // Serves a fixture rather than running the real engine: analyzeStructure
      // lives in the main process and reaches for node:crypto, so it cannot be
      // imported into a renderer iframe. The fixtures are hand-computed from
      // the same rubric — see the score trace in fixtures.ts.
      // Analyzing always yields an outline, including under the 'none'
      // scenario — 'none' means "nothing stored yet", which is a fact about
      // the store, not about whether analysis can run.
      //
      // Coverage is recomputed from previewClaims rather than served from the
      // fixture, mirroring what the real handler does by reading the database.
      // A frozen coverage line would still say "1 not checked" directly above
      // a claim that had just resolved to a score — a contradiction the real
      // app cannot produce, and exactly the kind of thing a reviewer would
      // waste time chasing.
      analyze: (req) =>
        ok('structure.analyze', {
          outline: {
            ...(outlineForScenario() ?? fx.documentOutline),
            documentId: req.documentId ?? null,
            coverage: coverageOf(previewClaims)
          }
        }),
      get: (req) => {
        const outline = outlineForScenario()
        if (!outline) return ok('structure.get', { outline: null, stale: false })
        return ok('structure.get', {
          outline: { ...outline, documentId: req.documentId },
          stale: scenario.structure === 'stale'
        })
      }
    },
    settings: {
      get: () => ok('settings.get', previewSettings),
      // Merges the patch and keeps it, rather than returning the fixture
      // unchanged. It used to do the latter, which made every settings control
      // in the harness look broken in the same way a real persistence bug
      // would: toggle it, watch it snap back. Worse, it made the harness
      // useless for exactly the round-trips it should be proving — the Save
      // changes dialog's "Do not show anymore" could never take effect here.
      set: (patch) => {
        previewSettings = { ...previewSettings, ...patch }
        return ok('settings.set', previewSettings)
      },
      scanInstalledApps: () =>
        ok('settings.scanInstalledApps', {
          found: [
            { exe: 'WINWORD.EXE', name: 'Microsoft Word' },
            { exe: 'chrome.exe', name: 'Google Chrome' },
            { exe: 'notepad.exe', name: 'Notepad' }
          ]
        })
    },
    profile: {
      get: () => ok('profile.get', fx.profile),
      set: () => ok('profile.set', fx.profile)
    },
    auth: {
      getUser: () =>
        ok('auth.getUser', { user: authUser(), configured: scenario.auth !== 'notConfigured' }),
      signUp: () => relay('auth.signUp', { user: fx.user }),
      signIn: () => relay('auth.signIn', { user: fx.user }),
      signOut: () => ok('auth.signOut', { ok: true as const }),
      signInWithGoogle: () => relay('auth.signInWithGoogle', { ok: true as const }),
      updateName: () => ok('auth.updateName', { user: fx.user }),
      updateUsername: () => ok('auth.updateUsername', { user: fx.user }),
      deleteAccount: () => ok('auth.deleteAccount', { ok: true as const })
    },
    history: {
      clear: () => ok('history.clear', { ok: true as const })
    },
    clipboard: {
      write: () => ok('clipboard.write', { ok: true as const })
    },
    window: {
      hide: () => ok('window.hide', { ok: true as const }),
      show: () => ok('window.show', { ok: true as const }),
      // Logged and otherwise inert. The preview renders each surface in an
      // iframe at a fixed size, so there is no BrowserWindow to resize — but
      // the grips are still real DOM in that iframe, and the call log is how a
      // reviewer sees that a drag is reaching the bridge at all.
      resizeStart: (req) => ok(`window.resizeStart ${req.handle}`, { ok: true as const }),
      resizeMove: (req) => ok(`window.resizeMove ${req.dx},${req.dy}`, { ok: true as const })
    },
    shell: {
      // Opening a real browser from a preview is the one side effect worth
      // suppressing outright — reviewing the UI shouldn't spray tabs.
      openExternal: () => ok('shell.openExternal (suppressed)', { ok: true as const })
    },
    app: {
      getBuildInfo: () =>
        ok('app.getBuildInfo', { version: '0.0.0-harness', isPreview: true })
    },
    screenWatch: {
      setEnabled: () => ok('screenWatch.setEnabled', fx.screenWatchStatus),
      getStatus: () => ok('screenWatch.getStatus', fx.screenWatchStatus),
      // These two re-emit the overlay payload rather than only logging.
      // In production the service owns widget geometry and pushes a new
      // payload back, so the panel's own Back / Show all / score chip / close
      // buttons are how you navigate it. Returning a bare ok left every one of
      // them inert in the preview, which is precisely where they need
      // exercising — the overlay is the hardest surface to reach for real.
      setWidgetExpanded: (req) => {
        emitWidget({ expanded: req.expanded, viewMode: req.expanded ? undefined : 'single' })
        return ok('screenWatch.setWidgetExpanded', { ok: true as const })
      },
      setWidgetViewMode: (req) => {
        emitWidget({ expanded: true, viewMode: req.mode })
        return ok('screenWatch.setWidgetViewMode', { ok: true as const })
      },
      widgetDragStart: () => ok('screenWatch.widgetDragStart', { ok: true as const }),
      widgetDragEnd: () => ok('screenWatch.widgetDragEnd', { ok: true as const }),
      setActivePopoverRect: () => ok('screenWatch.setActivePopoverRect', { ok: true as const }),
      refreshEvidence: async (req) => {
        const result = await ok('screenWatch.refreshEvidence', {
          evidence: fx.screenWatchEvidenceRefreshed
        })
        patchWatchClaim(req.claimId, { evidence: fx.screenWatchEvidenceRefreshed })
        return result
      },
      critiqueClaim: async (req) => {
        const result = await relay('screenWatch.critiqueClaim', {
          critique: fx.screenWatchCritique,
          verdict: 'weak' as const,
          // Null on the default preview claim: a suggested revision on every
          // critique is precisely the failure mode the relay prompt guards
          // against, and a fixture that always returns one would make the
          // preview a bad reference for what the feature should look like.
          suggestedRevision: null,
          citationFix: null
        })
        patchWatchClaim(req.claimId, { critique: fx.screenWatchCritique, critiqueVerdict: 'weak' })
        return result
      },
      findSource: () =>
        ok('screenWatch.findSource', {
          candidates: fx.sources.map((s, i) => ({
            sourceRef: s.id,
            title: s.title,
            authors: s.authors.map((a) => [a.given, a.family].filter(Boolean).join(' ')),
            year: s.year,
            venue: s.venue,
            provider: s.provider,
            url: s.url,
            matchPercent: [92, 74, 51][i],
            faviconDataUrl: null
          }))
        }),
      // Formatting is local and synchronous in main, so this returns the same
      // pair insertCitation would — the preview block is only worth reviewing
      // in the harness if it shows what the insert would actually write.
      previewCitation: () =>
        ok('screenWatch.previewCitation', {
          citation: {
            inTextCitation: '(Okonkwo et al., 2023)',
            worksCitedEntry: fx.citations[0].formattedText
          }
        }),
      insertCitation: () =>
        ok('screenWatch.insertCitation', {
          citation: {
            inTextCitation: '(Okonkwo et al., 2023)',
            worksCitedEntry: fx.citations[0].formattedText
          }
        }),
      undoCitation: () => ok('screenWatch.undoCitation', { ok: true as const })
    },
    onClipboardCaptured: (cb) =>
      subscribe('onClipboardCaptured', { text: fx.analysis.sourceText }, cb),
    onScreenWatchStatus: (cb) => subscribe('onScreenWatchStatus', fx.screenWatchStatus, cb),
    // Also driveable on demand, so the harness can replay the sequence that
    // makes underlines flicker in production: an update where a claim is
    // still tracked but its rects came back empty (a FindText miss during
    // reflow). See useStableUnderlines in OverlayApp.tsx.
    onScreenWatchOverlayUpdate: (cb) => {
      log('onScreenWatchOverlayUpdate (subscribe)')
      const w = window as Window & {
        __previewEmitOverlay?: (e: ScreenWatchOverlayUpdateEvent) => void
      }
      w.__previewEmitOverlay = (e) => cb(e)
      const id = window.setTimeout(() => cb(fx.overlayUpdate), 0)
      return () => {
        window.clearTimeout(id)
        delete w.__previewEmitOverlay
      }
    },
    // Hover is the one event the harness has to be able to drive on demand:
    // in production it comes from hoverTracking.ts hit-testing the real
    // cursor against the watched app's text, which has no equivalent inside
    // an iframe. Without this, the overlay's hover states (highlight band,
    // popover) are simply unreachable in the preview.
    onScreenWatchHover: (cb) => {
      log('onScreenWatchHover (subscribe)')
      const w = window as Window & { __previewEmitHover?: (e: ScreenWatchHoverEvent | null) => void }
      w.__previewEmitHover = (e) => cb(e)
      cb(null)
      return () => {
        delete w.__previewEmitHover
      }
    },
    onAuthStateChanged: (cb) => subscribe('onAuthStateChanged', authUser(), cb),
    onAuthOAuthError: (cb) => subscribe('onAuthOAuthError', '', cb)
  }
}
