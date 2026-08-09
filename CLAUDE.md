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

## Branches and releasing

One workspace, `C:\Users\merri\Tracely-agent1`, on `main`. Work happens on
`feat/*` branches. A `Stop` hook auto-commits and pushes the current branch at
the end of every turn, so work is never left only in a working tree.

- **`main` is the integration branch and the only branch releases are cut
  from.** It advances by deliberate merge. `.claude/hooks/guard-edit.sh` refuses
  edits to `src/`, `scripts/` and the build config while on `main`, because
  `electron-builder` packages the working tree rather than `HEAD` — an
  uncommitted edit there can reach an installer without ever being committed.
- **Merge into `main` when a feature is done, not when a release is due.**
  `npm run ship` no longer merges anything; it publishes what is already on
  `main`. Release time should not also be integration time.
- **Parallel work uses throwaway worktrees, not permanent ones.** Subagents
  launched with `isolation: "worktree"` get their own checkout and clean up
  after themselves. Three standing worktrees with a file-ownership contract were
  retired in favour of this: the contract needed maintaining, branches drifted
  24 commits behind, and 421 lines once sat uncommitted in two of them because
  each worktree registered the auto-commit hook separately.

**Two rules survive from the old ownership contract, because both were written
after something broke:**

- **`package.json`'s `version` line belongs to `npm run ship` alone.** Never
  edit it by hand.
- **The ML packaging rules in `electron-builder.yml`** — the `@huggingface` and
  `onnxruntime` globs, `asarUnpack` of `out/main/mlWorker.js`, `extraResources`
  for `resources/models`, and the `afterPack` hook — are load-bearing and
  easy to "tidy" into breakage. v0.3.76 shipped with the entire ML stack
  excluded, silently degraded to word-overlap ranking, and nothing errored.
  `scripts/verify-packaged-ml.mjs` runs in `afterPack` to make that failure
  loud; leave it wired.
- **Shared files (`src/shared/*`) are additive.** Add, don't restructure.

### Releasing

`npm run release:win` runs `scripts/preflight.mjs` first and refuses to publish
unless: you're on `main`, the tree is clean and in sync with origin, typecheck
passes, **every relay endpoint in `callRelay`'s parameter type answers
something other than 404**, and the version is strictly above the latest
published GitHub release.

That relay check is the important one. **The desktop app and the relay
(`C:\Users\merri\Tracely-relay`, deployed to Vercel) must ship together**, and
nothing else enforces it: v0.3.73 was committed, typechecked and building
cleanly with Tracer's `/api/tracer` returning 404 in production. Deploy the
relay first, then release the client. The version check matters for the
opposite failure — `electron-updater` only offers a *strictly higher* version,
so publishing without bumping produces a release nobody is ever shown.

`GH_TOKEN` lives in `.env.release` and must be in the environment for
`--publish` to work; electron-builder does not read that file on its own.

## Previewing the UI (`npm run preview:ui`)

A desktop harness for looking at and reviewing the UI without booting the real
app — no SQLite, no relay, no Screen Watch, no global hotkey. It opens one
Electron window that loads **the real renderer entries** (`index.html`,
`tracer.html`, `floating.html`, `overlay.html`) in iframes at their true
BrowserWindow pixel sizes, against a mocked IPC bridge. HMR is live, and it's
safe to run alongside the real app.

It exists because most of this UI is otherwise awkward to reach: Tracer's
window is created hidden and only opens from the Screen Watch widget, the
floating window needs a global hotkey and a clipboard payload, and the overlay
only draws when UIA is reading a real focused control in another app.

- **`src/renderer/src/preview/mockApi.ts` is the drift guard, and the reason
  this is worth having.** `createMockApi` is typed as `Window['tracely']` —
  i.e. the real `TracelyApi` (`typeof api` from the preload bridge). Add,
  rename or re-shape any method in `src/preload/index.ts` and
  `npm run typecheck` fails here until the mock is updated. A hand-maintained
  replica of the UI would rot in a week; this one cannot silently fall behind
  the contract it mocks. (It's `Window['tracely']` rather than a direct import
  of `src/preload/index.ts` on purpose: importing the preload *implementation*
  drags electron's Node typings into the renderer's tsconfig program and
  degrades inference across every renderer file.)
- **Iframes, not one shared document.** Tracer ships Tailwind including its
  preflight reset; the other three windows rely on `styles/index.css` and
  default UA styling. They can only be shown side by side as separate
  documents.
- **The mock is injected by `preview/vite.config.mts`, dev-server-side only.**
  `transformIndexHtml` prepends `src/preview/bootstrap.ts` as a module script
  to the four real entries. ES module scripts run in document order, so
  `window.tracely` is installed before the app's own entry module — the same
  guarantee the preload contextBridge gives it in production. **No shipped
  file is modified to support the preview.**
- **It cannot ship.** `preview.html` is deliberately absent from
  `electron.vite.config.ts`'s `rollupOptions.input`, so it's never built into
  `out/`, and electron-builder packages `out/**/*` only.
- Scenario controls in the left rail (auth gate, relay configured, empty vs.
  populated Tracer thread, forced relay failure, injected latency) re-create
  states that are otherwise hard to reach on demand — the error banner, the
  "needs a relay" composer, the loading spinners. Changing one reloads the
  surfaces, because the mock is constructed once per document exactly like the
  real bridge. The right-hand panel logs every IPC call that fires.
- **Overlay hover and overlay updates are driveable from the rail.** Hover normally comes from `hoverTracking.ts` hit-testing the real cursor against the watched app, and overlay payloads from the poll loop — neither has an equivalent inside an iframe, so `mockApi.ts` exposes `__previewEmitHover` / `__previewEmitOverlay` on the overlay frame. Without them the hover states and the dropped-rect flicker path are simply unreachable in the preview.
- Fixtures (`preview/fixtures.ts`) use a **fixed timestamp**, not `Date.now()`,
  so two screenshots of an unchanged UI are identical.

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
- **Underline rendering (`UnderlineMark` / `useStableUnderlines` in `OverlayApp.tsx`) fights three specific artifacts.** Hovering a flagged span fades in a translucent highlighter band over the text plus a slightly thicker line; the band is `rgba(color, 0.16)` and *must* stay translucent, because the overlay window sits **on top of** the watched app — anything opaque hides the very words it is highlighting.
  - **Blinking.** `FindText`/`GetBoundingRectangles` intermittently returns nothing for a claim that is plainly still visible (mid-reflow, mid-scroll, target app repainting). `useStableUnderlines` holds a claim's last rects for `RECT_GRACE_MS` (900ms, under one `POLL_INTERVAL_MS`) — but only while it is still in `widget.claims`. A claim that was dismissed, cited or re-detected away vanishes immediately, because there the empty payload is the truth rather than a missed measurement. The hold is deliberately keyed off the *previous payload*, not the merged output, so a claim can be held once and cannot renew itself forever.
  - **Snapping.** Marks move by `transform` (GPU-composited; these repaint over another app on every poll, so a layout-triggering animation is felt). The transition is suppressed for large deltas: a few pixels of typing/reflow should glide, but a scroll moves the same rect hundreds of pixels and animating that sends the underline swooping across unrelated text.
  - **Invisibility.** The entrance fade is a CSS animation with **no fill-mode**, and the mark's base opacity is 1. This window is never focused and always sits above another app — exactly the case Chromium throttles rAF/animation callbacks in — so gating visibility on a JS frame callback (the first attempt) risked underlines that never appear at all. Degraded behaviour is now "appears instantly", not "invisible".
  - Each mark carries `data-claim-id` / `data-hovered`. The overlay renders no text, so without them its DOM is unreadable when inspecting or preview-testing it.
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
- **It is the only window styled with Tailwind.** Tracer's UI is built on shadcn
  [ai-elements](https://ai-sdk.dev/elements) primitives — `components/ui/{conversation,message,actions,ai-actions}.tsx`
  — so it needs Tailwind, while the other three renderer entries keep the
  inline-style + `styles/index.css` idiom. The split is enforced purely by
  import: `styles/tracer.css` (the `@import 'tailwindcss'` entry, plus the
  `@theme` tokens) is imported by `tracer.tsx` and nothing else, which keeps
  Tailwind's preflight reset out of the main, floating and overlay windows.
  **Don't import it anywhere else without checking those windows against the
  reset** — they rely on default UA styling in places. Tailwind v4 is
  CSS-first: there is no `tailwind.config.js`, and the design tokens
  (`ink`/`accent`/`muted`/`line`) live in the `@theme` block of that CSS file.
  The `@` alias (→ `src/renderer/src`) exists in both `electron.vite.config.ts`
  and `tsconfig.web.json` so registry components paste in with their
  `@/components/ui/...` imports intact.
- **Two things the upstream ai-elements examples do that cannot work here:**
  `next/image` (this is Electron — no Next, no image optimizer) and remote
  avatars (`tracer.html` ships `img-src 'self' data:`, so any CDN or
  placeholder URL is blocked by CSP before it's a design question). Both
  avatars are drawn from the bundled `figma-logo.png`. The registry's `Action`
  also wraps every button in a Radix tooltip; that's replaced with the native
  `title` attribute rather than adding `@radix-ui/react-tooltip` and a
  provider to label five icons in a 380px popup.
- **Copy falls back to `document.execCommand`.** `navigator.clipboard.writeText`
  rejects with `NotAllowedError: Document is not focused` whenever Tracer isn't
  the foreground window — a normal state for a popup that sits next to the app
  you're typing in, not an edge case. The fallback in `ai-actions.tsx` is why
  the button doesn't silently do nothing; the "Copied" confirmation is only
  shown if a copy actually succeeded.
- **Like/Dislike are local and unpersisted, and there is no Share action.** The
  relay has no feedback endpoint to send a rating to, and writing one into
  `tracer_messages` would imply it goes somewhere. Share was dropped from the
  upstream action row outright: Tracely is local-first with no account and no
  permalink, so it could only ever be decorative.

### Where user data lives at runtime

- Windows: `%APPDATA%\Tracely\tracely.db` (SQLite: analyses, claims, evidence, citations, library, request cache, Tracer conversations) and `config.json` (Semantic Scholar key only — never the relay URL/token, which are compiled in).
- Settings → Privacy has two destructive ops: "Clear Analysis History" (`historyHandlers.ts` → `clearAnalysisHistory()`, keeps the library) vs. "Clear History + Library" (also wipes `sources`/`library_items`/`citations`). Both also wipe Tracer conversations — they quote the user's own writing back at them, so leaving them behind would defeat the point of the control.

## Known MVP simplifications (intentional, not bugs)

- Citation author formatting truncates to "et al." after 3 authors rather than implementing full APA/MLA/Chicago author-list rules.
- "Government datasets" as an evidence source is an unbuilt extension point.
- PubMed results have no abstract (would need a second NCBI `efetch` call per result; the other three providers already include abstracts).
