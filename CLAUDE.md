# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tracely is a private, local-first Electron desktop app (React + TypeScript) that checks the *credibility* of user-written text: it detects factual claims, finds academic evidence (OpenAlex, Crossref, Semantic Scholar, PubMed), scores how well-supported each claim is, critiques weak arguments, and generates citations (APA/MLA/Chicago). All user data lives in a local SQLite (`sql.js`, WASM — no native module compilation needed) database under Electron's per-OS user-data dir. Network calls are to academic search APIs, to the **Tracely Relay** (a separate sibling project, `../Tracely-relay`, that holds the real OpenAI key server-side — this app has no API-key field and never talks to OpenAI directly), and to a public favicon service (`main/services/search/favicon.ts`) for real per-source icons in the Screen Watch overlay — the one place this app's "only academic APIs + relay" network surface is knowingly broadened, opted into by the user after being told it reveals source domains to that service.

## Commands

```bash
npm install
npm run dev          # electron-vite dev — boots main window + hidden floating-assistant window
npm run typecheck    # tsc --noEmit for both main/preload (tsconfig.node.json) and renderer (tsconfig.web.json)
npm run build        # electron-vite build
npm run dist:win     # build + electron-builder --win -> installer in release/
npm run dist:mac     # build + electron-builder --mac (untested, config-only)
```

There is no test suite and no lint script currently configured. `npm run typecheck` is the only automated correctness check — run it after making changes.

### Relay setup for AI features

Claim detection and critique require a deployed Tracely Relay. Copy `.env.example` to `.env` and set `RELAY_URL` / `RELAY_TOKEN`. These are read once by `electron.vite.config.ts` and compiled directly into the main-process bundle via the `define` block (`__RELAY_URL__` / `__RELAY_TOKEN__`) — there's no runtime/user-facing way to change them; changing the relay means editing `.env` and rebuilding. Evidence search, scoring, citations, and the library all work with no relay configured.

### Windows packaging gotcha

`npm run dist:win` can fail the first time with `Cannot create symbolic link : A required privilege is not held by the client` while electron-builder extracts `winCodeSign` (irrelevant macOS `.dylib` symlinks, but the whole archive extraction is treated as failed). Fix: enable Settings → Privacy & Security → For developers → Developer Mode, then re-run.

## Architecture

Three Electron processes, strictly separated:

```
src/shared/         Types (types.ts) and IPC contract (ipc-contract.ts request/response shapes,
                     ipc-channels.ts channel name constants) — the only import shared across all
                     three processes. Import via the `@shared` alias.
src/main/           Node.js main process — all business logic lives here, nothing in the renderer.
src/preload/        contextBridge surface exposed as `window.tracely` (typed `TracelyApi`).
src/renderer/       React UI, two entry points (index.html main window, floating.html popup)
                     sharing components. Import via the `@renderer` alias.
```

### IPC pattern (adding a new feature follows this shape every time)

1. Define request/response types in `src/shared/ipc-contract.ts` and a channel constant in `src/shared/ipc-channels.ts`.
2. Add a handler in `src/main/ipc/<feature>Handlers.ts`: parse `raw` with a zod schema, call into a `services/` module, return the typed response. Register it in `src/main/ipc/index.ts`.
3. Expose it on the `api` object in `src/preload/index.ts` as a typed `ipcRenderer.invoke` wrapper.
4. Call it from the renderer via `window.tracely.<namespace>.<method>(...)`.

Every handler validates its input with zod before touching a service — there is no untrusted input path into `services/`.

### `main/services/` — four independent domains

- **`ai/`** — `client.ts` (`callRelay`) is the only thing that ever makes a network call to the relay; `claimDetection.ts` and `critique.ts` build the request bodies. `costGuard.ts` centralizes hard limits (max input chars, max claims per analysis, max evidence items sent to critique) — check here before loosening any AI-related limit. AI is invoked either from an explicit user action (Analyze / Find Evidence / Critique) or, in the renderer's Live tab (`LiveView.tsx`), automatically after a debounced pause in typing (1.4s, minimum 20 changed characters) — never on every keystroke. Every call result is cached in SQLite (`cacheRepo.ts`) keyed by a hash of normalized input, which also caps live-editing cost since re-detecting unchanged text is free.
- **`search/`** — one client module per provider (`openalex.ts`, `crossref.ts`, `semanticScholar.ts`, `pubmed.ts`) each returning a `NormalizedSourceResult`. `aggregator.ts` fans out to all four in parallel via `safeSearch` (a provider failure returns `[]` rather than failing the whole search), dedupes by DOI (falling back to normalized title+year), and caps merged results. `scoring.ts` computes evidence strength as a **deterministic formula** (source count, venue quality, recency, relevance rank) — not an AI call. `rateLimiter.ts` throttles per-provider request rate.
- **`citations/`** — pure formatters (`formatters/{apa,mla,chicago}.ts`) from source metadata, no AI/network involved. `authorUtils.ts` truncates author lists to "et al." after 3 authors (a known MVP simplification, not the full style-guide rule).
- **`storage/`** — `db.ts` wraps `sql.js`: the whole database is an in-memory WASM DB that gets fully re-serialized and written to disk (`persist()`) after every `run()`. `schema.ts` holds the SQL DDL. One repo module per table (`analysesRepo`, `claimsRepo`, `claimEvidenceRepo`, `sourcesRepo`, `citationsRepo`, `libraryRepo`, `cacheRepo`, `settingsRepo`) — go through these rather than querying `db.ts` directly from elsewhere. `config.ts` handles the small `config.json` (currently just the optional Semantic Scholar key).

### Main-process entry (`src/main/index.ts`)

Single-instance lock (second launch just refocuses the main window). Boots in order: `initDb()` → create main window → create (hidden) floating window → tray → register IPC handlers → register global hotkey. The app stays alive in the system tray on `window-all-closed` specifically so the global hotkey keeps working with no window open; `before-quit` forces a final `persist()`.

### Floating window / hotkey flow

`hotkey.ts` registers a configurable global accelerator (default reflected in Settings) that grabs the current clipboard and shows the floating window (`windows/floatingWindow.ts`), which emits `FLOATING_CLIPBOARD_CAPTURED` to the floating renderer (`FloatingApp.tsx`) to auto-trigger analysis. Main window and floating window are separate `BrowserWindow`s with separate Vite entry points but share renderer components (`ClaimCard`, `EvidenceCard`, `CitationBlock`, etc.).

### Live tab (`views/LiveView.tsx`, `components/LiveEditor.tsx`)

The main window's default tab: a textarea-based editor (main window only, not yet in the floating window) that underlines detected claims in place as you write, Grammarly-style, instead of requiring a paste-and-click-Analyze step. `LiveEditor.tsx` renders the underlines via the standard "highlighted textarea" trick — a transparent-text backdrop `<div>` positioned behind a transparent-background `<textarea>`, with scroll position kept in sync; the backdrop is `pointer-events: none` so all input still goes to the textarea, meaning the underlines are decorative only, not clickable — the detected claims list below (reusing `ClaimCard`) is the interactive surface, and hovering a card highlights its underline above via `activeClaimId`. `shared/claimSpans.ts` locates each claim's text within the live text (the claim-detection prompt now asks for verbatim substrings specifically so this matches reliably) to compute underline offsets; claims that can't be located are silently dropped rather than mis-highlighted. This is one of two places AI runs automatically — see the debounce note in `ai/` above.

### Screen Watch (`main/services/screenWatch/`, `windows/overlayWindow.ts`, `resources/uia-watch.ps1`)

Opt-in (Settings → Screen Watch, off by default, also toggleable from the tray menu), reads text from whatever field is focused in *other* apps and underlines flagged claims directly on screen — the "read my whole screen" version of the Live tab. Windows-only.

- **`resources/uia-watch.ps1`** does the actual reading via .NET's `System.Windows.Automation` (UI Automation / UIA), spawned fresh by `uiaSnapshot.ts` on every poll tick (no persistent helper process, to sidestep async-stdin complexity in PowerShell). It reads `AutomationElement.FocusedElement`, extracts text via `TextPattern.DocumentRange` (falling back to `ValuePattern` for controls that don't support rich text access), and — for already-detected claims passed in via `-ClaimsB64` — uses `TextPatternRange.FindText()` + `GetBoundingRectangles()` to get exact on-screen rectangles for underlining. **Writes raw UTF-8 bytes directly to the stdout handle** rather than `Write-Output`, because PowerShell's console encoding is inconsistent across hosts/versions and silently corrupts non-ASCII characters (smart quotes, accents, em-dashes) into invalid JSON otherwise — this was caught by live-testing against a real Chromium browser, not by inspection, so don't "simplify" it back to `Write-Output` without re-testing against real accented text.
- **Coverage is real but bounded by UIA support in the target app**: works well in Word, WordPad, other RichEdit-based apps, and — usefully — in Chromium-based browsers (Chrome/Edge/Opera all expose page text via UIA TextPattern when an accessibility client is attached), confirmed against live pages during development. It does **not** work in apps that render text as pixels without exposing an accessibility tree — Google Docs is the main example. `controlRect` is always available as a fallback even without `TextPattern`, but per-claim underline rectangles require it.
- **`screenWatchService.ts`** owns the poll loop (`POLL_INTERVAL_MS` = 1200ms) and the same kind of stability debounce as the Live tab (text must be unchanged for `STABLE_MS` before triggering `detectClaims`) — this is the other place AI runs automatically. Detected claims here are **not persisted** to the analyses/claims tables (they're synthesized in-memory `Claim` objects with a fresh UUID) — deliberately, so passive background reading doesn't pollute Analysis History with things the user never asked to save. Unlike claim detection, evidence search for these claims (`findEvidence` from `search/aggregator.ts`) *does* run automatically here, fire-and-forget per claim right after detection (`triggerEvidenceSearch`) — safe to auto-run since it only hits the four free public search APIs, not the paid relay, and results are kept in an in-memory `evidenceResultByClaimId` map (also never persisted), not written to the `evidence`/`sources` tables the main Analyze flow uses. The overlay also exposes real "Find Evidence"/"Critique Argument" actions (`refreshEvidenceForClaim`/`critiqueClaim`, same `ai/critique.ts` call the main app uses) — critique is the paid relay, so unlike evidence search it's strictly on-demand, never triggered automatically. Critique needs `EvidenceItem`-shaped objects (with a `Source`), which normally come from `sourcesRepo`; since Screen Watch results are never persisted there, `synthesizeEvidenceItem` builds them in-memory from the raw search results instead.
- The overlay's widget popup (`OverlayApp.tsx`) has two view modes, `single` (top claim by confidence) and `all` (every currently-flagged claim in a grid) — `widgetViewMode` lives server-side in `screenWatchService.ts` because the panel's actual pixel size is computed there too (`computeAllPanelSize`/`GRID_*` constants), so hoverTracking.ts's click-through hit-test region matches what's drawn. The grid's column/card-size math is duplicated client-side in `OverlayApp.tsx` (`gridColumns`/`GRID_*`) and must be kept in sync with the server constants, or the rendered cards won't fit the panel sized for them.
- Off-screen/scrolled-out matches come back from `GetBoundingRectangles()` with zero/negative extents and are filtered out rather than drawn — underlines only ever appear over currently-visible text.
- **`overlayWindow.ts`** is a transparent, click-through (`setIgnoreMouseEvents(true, { forward: true })`), always-on-top, unfocusable `BrowserWindow` sized to cover whichever display the focused control is on; `OverlayApp.tsx` (its own renderer entry, `overlay.html`) just draws positioned bars from the rects it's pushed — it has no other interactivity by design, since a window that could intercept clicks over another app's UI would break that app.
- Known gap: screen coordinates from UIA and Electron's display bounds are assumed to be in the same coordinate space, which holds at 100% DPI scaling; multi-monitor setups with different per-monitor scale factors haven't been verified and may misalign underlines.
- The PowerShell script ships via `extraResources` in `electron-builder.yml` (`resources/uia-watch.ps1` → packaged `resources/uia-watch.ps1`), located at runtime the same dev/packaged-path-branching way as `icon.ts`.

### Tracer (`main/services/ai/tracer.ts`, `windows/tracerWindow.ts`, `renderer/src/TracerApp.tsx`)

A conversational writing teacher, opened from the Screen Watch widget ("Ask Tracer" in the hover popover, the expanded panel, and the empty panel). It answers questions about the user's writing using the watched document and its flagged claims as context — and is prompted to explain and push back rather than write text for the student (`TRACER_SYSTEM_PROMPT` on the relay refuses rewriting outright).

- **It gets its own `BrowserWindow`, not a spot in the overlay.** The overlay is `focusable: false` + click-through by design so it never steals focus from the watched app, which means it cannot host a text input — the same constraint that already forced the citation picker to have no "search again" box. `tracerWindow.ts` is a normal focusable window that opens at the same bottom-right corner the widget anchors to. It's created hidden at boot and hidden (not destroyed) on close, so reopening is instant; because that means no remount, `showTracerWindow` pushes `TRACER_OPENED` and the renderer reloads on it.
- **Focusing Tracer freezes Screen Watch instead of resetting it.** Talking to Tracer makes Tracely the foreground app, which UIA reports as `skip: "self"` — the normal path for that calls `resetTrackingState()` and hides the overlay, which would wipe the very claims the user just opened Tracer to ask about. `tick()` returns early on `"self"` while the Tracer window is open, holding claims and underlines in place; every other skip reason still resets. `hoverTracking.ts` likewise stops hit-testing while Tracer is *focused* (not merely open, so going back to writing restores popovers immediately), and `tracerWindow.ts` matches the overlay's `'screen-saver'` always-on-top level so the click-through overlay can't sit above the composer and eat clicks.
- **It is the one part of Screen Watch that persists.** Everything else there is deliberately ephemeral, but conversations live in `tracer_conversations` / `tracer_messages` via `storage/tracerRepo.ts` — a tutor that forgets every session isn't one. Both Privacy clears wipe them, since the messages quote the user's own writing.
- **Nothing is cached.** Unlike `critique.ts`/`claimDetection.ts` (pure functions of their input, keyed into `cacheRepo`), a chat turn depends on the whole conversation, so a cache would return wrong answers rather than merely useless ones. Cost is bounded instead by the `MAX_TRACER_*` caps in `ai/costGuard.ts` — notably a cap on **history turns**, since every prior turn is re-sent on every message and an uncapped conversation grows quadratically in tokens.
- **Needs a new relay endpoint.** `api/tracer.ts` in the relay repo, mirrored caps in its `lib/limits.ts`. Deploy the relay before this does anything — the composer disables itself when the build has no relay (`isRelayConfigured()`).

### Where user data lives at runtime

- Windows: `%APPDATA%\Tracely\tracely.db` (SQLite: analyses, claims, evidence, citations, library, request cache, Tracer conversations) and `config.json` (Semantic Scholar key only — never the relay URL/token, which are compiled in).
- Settings → Privacy has two destructive ops: "Clear Analysis History" (`historyHandlers.ts` → `clearAnalysisHistory()`, keeps the library) vs. "Clear History + Library" (also wipes `sources`/`library_items`/`citations`). Both also wipe Tracer conversations — they quote the user's own writing back at them, so leaving them behind would defeat the point of the control.

## Known MVP simplifications (intentional, not bugs)

- Citation author formatting truncates to "et al." after 3 authors rather than implementing full APA/MLA/Chicago author-list rules.
- "Government datasets" as an evidence source is an unbuilt extension point.
- PubMed results have no abstract (would need a second NCBI `efetch` call per result; the other three providers already include abstracts).
