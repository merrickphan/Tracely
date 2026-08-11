import type { ScreenWatchHoverEvent, ScreenWatchOverlayUpdateEvent } from '@shared/ipc-contract'
import type {
  AuthUser,
  Claim,
  DocumentOutline,
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
  /** With no relay compiled in, Tracer's composer disables itself. */
  relayConfigured: boolean
  /** Start Tracer on a blank conversation vs. a populated one. */
  tracerMessages: 'empty' | 'thread'
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
  tracerMessages: 'thread',
  failRelay: false,
  latencyMs: 0,
  structure: 'heuristic'
}

/** Names of every call the harness logs, so the UI can show what fired. */
export type CallLogEntry = { at: number; method: string }

export function createMockApi(
  scenario: Scenario,
  log: (method: string) => void,
  onTracerClose: () => void
): TracelyApi {
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
  let previewDocs: DocumentRecord[] = [...fx.documents]
  let tracerMsgs = scenario.tracerMessages === 'empty' ? [] : fx.tracerMessages
  let nextId = 100

  /** Mirrors computeEvidenceCoverage in the main process. */
  const coverageOf = (claims: Claim[]): EvidenceCoverage => {
    const resolved = claims.filter((c) => c.strengthScore !== null)
    return {
      detected: claims.length,
      withRelevantSource: claims.filter((c) => (c.scoreBreakdown?.sourceCount ?? 0) > 0).length,
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
              updatedAt: now
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
      get: () => ok('settings.get', fx.settings),
      set: () => ok('settings.set', fx.settings),
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
      show: () => ok('window.show', { ok: true as const })
    },
    shell: {
      // Opening a real browser from a preview is the one side effect worth
      // suppressing outright — reviewing the UI shouldn't spray tabs.
      openExternal: () => ok('shell.openExternal (suppressed)', { ok: true as const })
    },
    screenWatch: {
      setEnabled: () => ok('screenWatch.setEnabled', fx.screenWatchStatus),
      getStatus: () => ok('screenWatch.getStatus', fx.screenWatchStatus),
      setWidgetExpanded: () => ok('screenWatch.setWidgetExpanded', { ok: true as const }),
      setWidgetViewMode: () => ok('screenWatch.setWidgetViewMode', { ok: true as const }),
      widgetDragStart: () => ok('screenWatch.widgetDragStart', { ok: true as const }),
      widgetDragEnd: () => ok('screenWatch.widgetDragEnd', { ok: true as const }),
      setActivePopoverRect: () => ok('screenWatch.setActivePopoverRect', { ok: true as const }),
      refreshEvidence: () => ok('screenWatch.refreshEvidence', { evidence: fx.screenWatchClaims[0].evidence }),
      critiqueClaim: () =>
        relay('screenWatch.critiqueClaim', {
          critique: fx.claims[0].critique ?? '',
          verdict: fx.claims[0].critiqueVerdict ?? ('weak' as const)
        }),
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
      insertCitation: () =>
        ok('screenWatch.insertCitation', {
          citation: {
            inTextCitation: '(Okonkwo et al., 2023)',
            worksCitedEntry: fx.citations[0].formattedText
          }
        }),
      undoCitation: () => ok('screenWatch.undoCitation', { ok: true as const })
    },
    tracer: {
      open: () => ok('tracer.open', { ok: true as const }),
      close: () => {
        log('tracer.close')
        onTracerClose()
        return Promise.resolve({ ok: true as const })
      },
      send: async (req) => {
        const userMessage = {
          id: `pm${nextId++}`,
          conversationId: req.conversationId,
          role: 'user' as const,
          content: req.message,
          createdAt: fx.T0
        }
        const reply = {
          id: `pm${nextId++}`,
          conversationId: req.conversationId,
          role: 'tracer' as const,
          content:
            'This is a preview reply — no relay was contacted. It is deliberately several sentences long, and contains a paragraph break, so the bubble, the wrapping and the action row underneath all get exercised at a realistic size.\n\nSwitch the "fail relay" scenario on to review the error state instead.',
          createdAt: fx.T0
        }
        const result = await relay('tracer.send', { userMessage, reply })
        tracerMsgs = [...tracerMsgs, userMessage, reply]
        return result
      },
      // Mirrors the real handler: the discarded exchange is dropped from the
      // transcript before the replacement is appended, so a retry replaces the
      // answer you didn't like rather than appending a second copy of the
      // question. Reviewing the retry state in the preview harness only tells
      // you anything if it behaves that way here too.
      retry: async (req) => {
        const previous = [...tracerMsgs].reverse().find((m) => m.role === 'user')
        if (!previous) throw new Error('Nothing to retry')

        const kept = tracerMsgs.slice(0, tracerMsgs.findIndex((m) => m.id === previous.id))
        const userMessage = { ...previous, id: `pm${nextId++}`, createdAt: fx.T0 }
        const reply = {
          id: `pm${nextId++}`,
          conversationId: req.conversationId,
          role: 'tracer' as const,
          content:
            'This is a retried preview reply — deliberately different from the first, so you can see that the old answer was replaced rather than a second one appended.',
          createdAt: fx.T0
        }
        const result = await relay('tracer.retry', { userMessage, reply })
        tracerMsgs = [...kept, userMessage, reply]
        return result
      },
      getConversation: (req) =>
        ok('tracer.getConversation', {
          conversation: fx.tracerConversations.find((c) => c.id === req.conversationId) ?? fx.tracerConversations[0],
          messages: tracerMsgs,
          context: fx.tracerContext,
          relayConfigured: scenario.relayConfigured,
          focusedClaimId: null,
          focusedPrompt: null
        }),
      listConversations: () => ok('tracer.listConversations', { conversations: fx.tracerConversations }),
      newConversation: () => {
        tracerMsgs = []
        return ok('tracer.newConversation', { conversation: fx.tracerConversations[0] })
      },
      deleteConversation: () => ok('tracer.deleteConversation', { ok: true as const })
    },
    onTracerContextChanged: (cb) => subscribe('onTracerContextChanged', fx.tracerContext, cb),
    onTracerOpened: (cb) => {
      log('onTracerOpened (subscribe)')
      const id = window.setTimeout(() => cb(), 0)
      return () => window.clearTimeout(id)
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
