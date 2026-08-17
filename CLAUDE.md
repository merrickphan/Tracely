# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tracely is a private, local-first Electron desktop app (React + TypeScript) that checks the *credibility* of user-written text: it detects factual claims, finds academic evidence (OpenAlex, Crossref, Semantic Scholar, PubMed), scores how well-supported each claim is, critiques weak arguments, and generates citations (APA/MLA/Chicago). All user data lives in a local SQLite (`sql.js`, WASM — no native module compilation needed) database under Electron's per-OS user-data dir. Network calls are to academic search APIs, to the **Tracely Relay** (a separate sibling project, `../Tracely-relay`, that holds the real OpenAI key server-side — this app has no API-key field and never talks to OpenAI directly), and to a public favicon service (`main/services/search/favicon.ts`) for real per-source icons in the Screen Watch overlay — the one place this app's "only academic APIs + relay" network surface is knowingly broadened, opted into by the user after being told it reveals source domains to that service.

## The design file

**[Real Tracely UI](https://www.figma.com/design/k7R5x1M9alKktaMLlZFSJn/Real-Tracely-UI)** — file key
`k7R5x1M9alKktaMLlZFSJn`, one page, `0:1`. Every overlay/widget/settings frame
lives there.

Recorded here because it was not recorded anywhere. A dozen comments in this
codebase cite "the Figma mockup" — the 56px launcher, the 870x606 frame, the
thin-line icons — without a link, so the UI was being built from *prose
descriptions of* the design rather than the design. That drift is what produced
a near-miss palette (`#17171b` for `#1c1c1c`, `#f47b20` for `#ff5900`), pill
buttons where the design has 8px rounded rectangles, and an overlay that never
loaded Instrument Sans at all.

Read it with the Figma MCP (`get_metadata` on `0:1` to list frames, then
`get_design_context` on a node). The overlay frames are named
`Overlay Mockup - <state>`.

**The overlay's frames, and what each one governs:**

| frame | governs |
|---|---|
| `Widget over Document` (+ Refresh / Critique / Show All results) | the panel the launcher opens |
| `Inline Detection (Grammarly-style / Statistic / Citation / Reasoning)` | the hover popover — `ProblemCard` |
| `Find a Source (Searching / Results)`, `Add Citation (Choose Source / Inserted)` | `CitationFlowCard` |
| `Collapsed Launcher` | the 56px circle and its 31px count badge |
| `Inline Detection (Resting State)` | the underline marks with nothing hovered |

**Three underline colours, not eight.** `#ff5900` for an unverified figure,
`#ffb800` for a missing citation, `#d93636` for weak reasoning — read off the
marks in those frames, with the popover's dot always matching the mark that
opened it. `PROBLEM_COLOR` in `OverlayApp.tsx` groups all eight problem kinds
onto those three, because inventing a fourth hue is what produced a purple
statistic underline and an orange "missing citation" one — the design's two
colours, swapped.

**Every popover has a 16x10 tail** (`PopoverTail`, path from node `288:545`)
pointing at the sentence, overlapping the card border by 2px so the strokes
meet. The overlay shipped without one for months; on a paragraph with three
flagged sentences a card floating nearby is genuinely ambiguous.

**Two deliberate departures:**

- Source rows show the real favicon, not the design's two-letter provider tile.
  It identifies the publication rather than which API returned it. The tile
  remains as the fallback, in the design's 28px / 8px-radius box so both line up
  on the same grid.
- `Add Citation (Choose Source)`'s library list and text search field are not
  built. Screen Watch persists nothing, so there is no per-document library to
  list, and `overlayWindow.ts` sets `focusable: false` — this window can never
  host a real text input. Its style pills ARE used, in the Results step. (A
  filter box over the results list was built once anyway; it could not be typed
  into, for that same reason, and the frame's full-width **"Search again"** is
  what stands in that slot.)

**The hover popover runs the whole flow, on both surfaces.** `Inline Detection`
→ `Find a Source (Searching)` → `Find a Source (Results)` → `Add Citation
(Inserted)` are four states of one card, and Screen Watch's overlay
(`CitationFlowCard` in `OverlayApp.tsx`) and the document editor's marks
(`DocumentMarkLayer.tsx`) both draw all four. The editor used to answer "Add
citation" by opening the report modal instead — a full-screen context switch
away from the paragraph being written, to answer a question asked about one of
its lines.

- **The wording is shared (`components/citationFlowCopy.ts`), the markup is
  not.** Same rule as `problemCopy.ts`, and for the same reason: the overlay is
  inline styles in a window that loads no stylesheet, the editor is `.docmark-*`
  classes from `index.css`. Two copies of the strings would be two products.
- **`Preview` earns its place differently on each surface.** Over another app
  the overlay writes through UIA, and being shown the citation first is the only
  way to see it before it lands. In Tracely's own editor the insert goes through
  `execCommand('insertText')` — it appears in the sentence a few pixels away and
  Ctrl+Z (or the card's own Undo, which is that same undo stack) takes it back
  out. It is offered there anyway, because the works-cited entry is the half
  that does *not* appear in the sentence.
- **A running flow pins the editor's popover** (`flowPinnedRef` in
  `AnalyzeView`). The card unmounts the instant the pointer leaves the sentence,
  so the flow state is owned by the view, and the hit-test stops swapping marks
  while one is open — otherwise reaching across another underline on the way to
  "Insert citation" takes the card with it.
- **The editor's marks are driveable from a browser pane that is not
  displayed** — they were not, until `renderer/src/frameScheduler.ts`. They are
  measured inside a frame callback (deliberately: it batches a keystroke and a
  ResizeObserver callback that both force layout), and Chromium freezes rAF
  entirely on a page that is not compositing, so `marks` stayed empty and the
  popover was unreachable in `npm run preview:ui`. `scheduleFrame` arms a rAF
  and a 50ms timer and takes whichever fires first: the frame always wins when
  there is one, so the batching is unchanged in the shipped app, and the timer
  is the only thing that ever fires in a hidden window. Measured in the
  harness: 0 marks before, 4 after, with the hover popover opening on them.

## Commands

```bash
npm install
npm run dev          # electron-vite dev — boots main window + hidden floating-assistant window
npm run typecheck    # tsc --noEmit for both main/preload (tsconfig.node.json) and renderer (tsconfig.web.json)
npm run build        # electron-vite build
npm run dist:win     # build + electron-builder --win -> installer in release/
npm run dist:mac     # build + electron-builder --mac (untested, config-only)
```

There is no lint script configured. The two automated correctness checks are `npm run typecheck` and `npm test` (Node's built-in runner over `src/**/*.test.ts` — 282 tests, 57 suites, under a second). Run both after making changes; neither costs anything. This line previously claimed there was no test suite, which sent agents pushing on typecheck alone.

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
  Both guards resolve the branch from **the worktree that owns the thing being
  guarded** — the edited file's directory, or the Bash call's `cwd` — not from
  `CLAUDE_PROJECT_DIR`, which for a subagent in an isolated worktree still
  points at the shared checkout on `main`. Reading it from there denied every
  `src/` edit and every commit those agents made, i.e. exactly the
  worktree-parallelism workflow described below.
- **Merge into `main` when a feature is done, not when a release is due.**
  `npm run ship` no longer merges anything; it publishes what is already on
  `main`. Release time should not also be integration time.
- **Parallel work uses throwaway worktrees, not permanent ones.** Subagents
  launched with `isolation: "worktree"` get their own checkout and clean up
  after themselves. Three standing worktrees with a file-ownership contract were
  retired in favour of this: the contract needed maintaining, branches drifted
  24 commits behind, and 421 lines once sat uncommitted in two of them because
  each worktree registered the auto-commit hook separately.

### When a release goes wrong

See **[ROLLBACK.md](ROLLBACK.md)**. The short version: the relay reverts in
seconds with `vercel rollback`, the desktop app cannot be reverted at all
(electron-updater will not downgrade), so the first question in any incident is
whether the relay can fix it instead.

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
cleanly with the then-new `/api/tracer` returning 404 in production. Deploy the
relay first, then release the client. The version check matters for the
opposite failure — `electron-updater` only offers a *strictly higher* version,
so publishing without bumping produces a release nobody is ever shown.

`GH_TOKEN` lives in `.env.release` and must be in the environment for
`--publish` to work; electron-builder does not read that file on its own.

### How updates reach each build (`updater.ts`, `updatePolicy.ts`)

**Preview updates itself; production asks first.** The two channels are not
just different feeds, they behave differently on purpose:

| | production | preview |
|---|---|---|
| `autoDownload` | `false` — asks | `true` — silent |
| check interval | 6h | 20min |
| install | always a dialog | silent when idle, else dialog |

The reason is that a preview channel only does its job if the testers are on the
**same** build. Landing an update used to take two separate clicks — "Download",
then "Restart now" — either of which could be declined forever, and with 13
previews published in three days any two testers diverged within hours and then
reported the difference between their builds as a bug in one of them.

- **`shouldInstallImmediately` (`updatePolicy.ts`) is the only thing that
  restarts the app unasked**, and it requires preview + no visible window +
  Screen Watch off. That combination is this app's *resting* state, not a rare
  one — `window-all-closed` deliberately keeps it alive in the tray. When it
  says no the update is not dropped: the dialog offers it, and failing that
  `autoInstallOnAppQuit` installs it on the next quit. It decides *silently now*
  vs *ask*, never *now* vs *never*.
- **Do not derive "is this a preview build?" from the version's `-preview`
  suffix.** `appIdentity.isPreviewBuild()` reads `app.getName()`, which
  electron-builder sets via `-c.extraMetadata.name=tracely-preview`. A second
  derivation is a second truth that can disagree with the first, silently.
- **This cannot fix an install retroactively.** A tester already running an
  older preview has to install one build by hand; every one after that is
  automatic. Auto-update can only be delivered *by* an update.

## Previewing the UI (`npm run preview:ui`, or `/preview`)

**`/preview` is the command for this** — it covers booting the harness, driving
the surfaces through the mock bridge, and the measurements worth asserting.
(The slash command that publishes a beta installer is now `/beta`; it used to
be called `/preview`, which is why anything older may say so.)

A desktop harness for looking at and reviewing the UI without booting the real
app — no SQLite, no relay, no Screen Watch, no global hotkey. It opens one
Electron window that loads **the real renderer entries** (`index.html`,
`floating.html`, `overlay.html`) in iframes at their true BrowserWindow pixel
sizes, against a mocked IPC bridge. HMR is live, and it's safe to run alongside
the real app.

It exists because most of this UI is otherwise awkward to reach: the floating
window needs a global hotkey and a clipboard payload, and the overlay only
draws when UIA is reading a real focused control in another app.

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
- **Iframes, not one shared document.** Each surface is a real document with
  its own stylesheet, which is the only way to show them side by side without
  one window's reset reaching another. (Tracer, which shipped Tailwind's
  preflight next to windows relying on default UA styling, is why this was
  never negotiable.)
- **The mock is injected by `preview/vite.config.mts`, dev-server-side only.**
  `transformIndexHtml` prepends `src/preview/bootstrap.ts` as a module script
  to the three real entries. ES module scripts run in document order, so
  `window.tracely` is installed before the app's own entry module — the same
  guarantee the preload contextBridge gives it in production. **No shipped
  file is modified to support the preview.**
- **It cannot ship.** `preview.html` is deliberately absent from
  `electron.vite.config.ts`'s `rollupOptions.input`, so it's never built into
  `out/`, and electron-builder packages `out/**/*` only.
- Scenario controls in the left rail (auth gate, relay configured, structure
  variant, forced relay failure, injected latency) re-create states that are
  otherwise hard to reach on demand — the error banner, the loading spinners. Changing one reloads the
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
src/renderer/       React UI, three entry points (index.html main window, floating.html popup,
                     overlay.html Screen Watch overlay) sharing components.
                     Import via the `@renderer` alias.
```

### IPC pattern (adding a new feature follows this shape every time)

1. Define request/response types in `src/shared/ipc-contract.ts` and a channel constant in `src/shared/ipc-channels.ts`.
2. Add a handler in `src/main/ipc/<feature>Handlers.ts`: parse `raw` with a zod schema, call into a `services/` module, return the typed response. Register it in `src/main/ipc/index.ts`.
3. Expose it on the `api` object in `src/preload/index.ts` as a typed `ipcRenderer.invoke` wrapper.
4. Call it from the renderer via `window.tracely.<namespace>.<method>(...)`.

Every handler validates its input with zod before touching a service — there is no untrusted input path into `services/`.

### `main/services/` — four independent domains

- **`ai/`** — `client.ts` (`callRelay`) is the only thing that ever makes a network call to the relay; `claimDetection.ts` and `critique.ts` build the request bodies. `costGuard.ts` centralizes hard limits (max input chars, max claims per analysis, max evidence items sent to critique) — check here before loosening any AI-related limit. AI is invoked either from an explicit user action (Analyze / Find Evidence / Critique) or automatically by Screen Watch after a debounced pause in typing — never on every keystroke. (This used to say "the renderer's Live tab (`LiveView.tsx`)"; there is no such tab.) Every call result is cached in SQLite (`cacheRepo.ts`) keyed by a hash of normalized input, which also caps live-editing cost since re-detecting unchanged text is free.
- **`search/`** — one client module per provider, each returning a `NormalizedSourceResult`. The three core scholarly searches always run; routing can add PubMed for biomedical claims, Wikipedia for general facts, or World Development Indicators from the World Bank for statistical claims. `worldBank.ts` embeds the indicator catalogue once per session and returns at most one dataset only above its measured semantic-match floor. `aggregator.ts` fans providers out in parallel via `safeSearch` (a provider failure returns `[]` rather than failing the whole search), dedupes by DOI (falling back to normalized title+year), and caps merged results. `scoring.ts` computes evidence strength as a **deterministic formula** (source count, venue quality, recency, relevance rank) — not an AI call. `rateLimiter.ts` throttles per-provider request rate.
- **`citations/`** — pure formatters (`formatters/{apa,mla,chicago}.ts`) from source metadata, no AI/network involved. `authorUtils.ts` truncates author lists to "et al." after 3 authors (a known MVP simplification, not the full style-guide rule).
- **`storage/`** — `db.ts` wraps `sql.js`: the whole database is an in-memory WASM DB that gets fully re-serialized and written to disk (`persist()`) after every `run()`. `schema.ts` holds the SQL DDL. One repo module per table (`analysesRepo`, `claimsRepo`, `claimEvidenceRepo`, `sourcesRepo`, `citationsRepo`, `libraryRepo`, `cacheRepo`, `settingsRepo`) — go through these rather than querying `db.ts` directly from elsewhere. `config.ts` handles the small `config.json` (currently just the optional Semantic Scholar key).

### Main-process entry (`src/main/index.ts`)

Single-instance lock (second launch just refocuses the main window). Boots in order: `initDb()` → create main window → create (hidden) floating window → tray → register IPC handlers → register global hotkey. The app stays alive in the system tray on `window-all-closed` specifically so the global hotkey keeps working with no window open; `before-quit` forces a final `persist()`.

### Floating window / hotkey flow

`hotkey.ts` registers a configurable global accelerator (default reflected in Settings) that grabs the current clipboard and shows the floating window (`windows/floatingWindow.ts`), which emits `FLOATING_CLIPBOARD_CAPTURED` to the floating renderer (`FloatingApp.tsx`) to auto-trigger analysis. Main window and floating window are separate `BrowserWindow`s with separate Vite entry points but share renderer components (`ClaimCard`, `EvidenceCard`, `CitationBlock`, etc.).

### The Live tab does not exist

This file described one at `views/LiveView.tsx` + `components/LiveEditor.tsx`,
and called it "the main window's default tab". Neither file is in the tree, and
the default tab is Home (`App.tsx`). The main window's tabs are Home, Analyze
and Settings.

What survives of it is `shared/claimSpans.ts`, which locates a claim's text
within a document to compute underline offsets. Its only importer now is
`screenWatchService.ts` — Screen Watch is where in-place underlining actually
happens, and it is the only place AI runs automatically.

### Screen Watch (`main/services/screenWatch/`, `windows/overlayWindow.ts`, `resources/uia-watch.ps1`)

Opt-in (Settings → Screen Watch, off by default, also toggleable from the tray menu), reads text from whatever field is focused in *other* apps and underlines flagged claims directly on screen — the "read my whole screen" version of what an in-app live editor would do. Windows-only.

- **`resources/uia-watch.ps1`** does the actual reading via .NET's `System.Windows.Automation` (UI Automation / UIA), spawned fresh by `uiaSnapshot.ts` on every poll tick (no persistent helper process, to sidestep async-stdin complexity in PowerShell). It reads `AutomationElement.FocusedElement`, extracts text via `TextPattern.DocumentRange` (falling back to `ValuePattern` for controls that don't support rich text access), and — for already-detected claims passed in via `-ClaimsB64` — uses `TextPatternRange.FindText()` + `GetBoundingRectangles()` to get exact on-screen rectangles for underlining. **Writes raw UTF-8 bytes directly to the stdout handle** rather than `Write-Output`, because PowerShell's console encoding is inconsistent across hosts/versions and silently corrupts non-ASCII characters (smart quotes, accents, em-dashes) into invalid JSON otherwise — this was caught by live-testing against a real Chromium browser, not by inspection, so don't "simplify" it back to `Write-Output` without re-testing against real accented text.
- **Coverage is real but bounded by UIA support in the target app**: works well in Word, WordPad, other RichEdit-based apps, and — usefully — in Chromium-based browsers (Chrome/Edge/Opera all expose page text via UIA TextPattern when an accessibility client is attached), confirmed against live pages during development. It does **not** work in apps that render text as pixels without exposing an accessibility tree — Google Docs is the main example. `controlRect` is always available as a fallback even without `TextPattern`, but per-claim underline rectangles require it.
- **`screenWatchService.ts`** owns the poll loop (`POLL_INTERVAL_MS` = 1200ms) and a stability debounce (text must be unchanged for `STABLE_MS` before triggering `detectClaims`) — this is the other place AI runs automatically. Detected claims here are **not persisted** to the analyses/claims tables (they're synthesized in-memory `Claim` objects with a fresh UUID) — deliberately, so passive background reading doesn't pollute Analysis History with things the user never asked to save. Unlike claim detection, evidence search for these claims (`findEvidence` from `search/aggregator.ts`) *does* run automatically here, fire-and-forget per claim right after detection (`triggerEvidenceSearch`) — safe to auto-run since it only hits the four free public search APIs, not the paid relay, and results are kept in an in-memory `evidenceResultByClaimId` map (also never persisted), not written to the `evidence`/`sources` tables the main Analyze flow uses. The overlay also exposes real "Find Evidence"/"Critique Argument" actions (`refreshEvidenceForClaim`/`critiqueClaim`, same `ai/critique.ts` call the main app uses). **Critique never runs automatically here** — it is the paid relay, and Screen Watch is passive and always-on, so an unprompted call is a bill the user did not ask for and cannot watch being run up. Evidence search gets to stay automatic precisely because it only hits the four free public APIs; that is the whole line, and it is the one to hold when this comes up again. A bounded automatic version (one call per detection, spent on the first top claim whose evidence resolved) was built, shipped to beta, and pulled before the stable release that would have carried it. Its known cost is real and is not a bug to be rediscovered: `problemKindFor` reports "Weak reasoning" only when `critiqueVerdict` is set, so passive watching can speak about citations and evidence but never about reasoning until asked. Everything needed to bring it back — `synthesizeEvidenceItem`, `withEvidenceScores`, the evidence map — is still in place, and an opt-in Settings toggle is the shape it should return in. `refreshEvidenceForClaim` **deletes** the claim's critique: the critique cites its sources by number, so leaving it would show a verdict reasoned over a source list that no longer exists. Critique needs `EvidenceItem`-shaped objects (with a `Source`), which normally come from `sourcesRepo`; since Screen Watch results are never persisted there, `synthesizeEvidenceItem` builds them in-memory from the raw search results instead.
- The overlay's widget popup (`OverlayApp.tsx`) has three view modes, `single` (top claim by confidence), `all` (every currently-flagged claim, as a single vertical column — it was a grid once, and `gridColumns` no longer exists) and `structure` (the draft's structural read) — `widgetViewMode` lives server-side in `screenWatchService.ts` because the panel's actual pixel size is computed there too, so hoverTracking.ts's click-through hit-test region matches what's drawn. That sizing now lives in `screenWatch/panelSize.ts`, a leaf module so it can be unit tested; **every mode is `PANEL_WIDTH` wide on purpose** — the panel is anchored bottom-right, so a mode with its own width would make the whole card jump sideways on a mode switch, and there is a test asserting the three agree. The card-size math is duplicated client-side in `OverlayApp.tsx` (`GRID_*`) and must be kept in sync, or the rendered cards won't fit the panel sized for them.
- Off-screen/scrolled-out matches come back from `GetBoundingRectangles()` with zero/negative extents and are filtered out rather than drawn — underlines only ever appear over currently-visible text.
- **Underline rendering (`UnderlineMark` / `useStableUnderlines` in `OverlayApp.tsx`) fights three specific artifacts.** Hovering a flagged span fades in a translucent highlighter band over the text plus a slightly thicker line; the band is `rgba(color, 0.3)` and *must* stay translucent, because the overlay window sits **on top of** the watched app — anything opaque hides the very words it is highlighting.
  - **Blinking.** `FindText`/`GetBoundingRectangles` intermittently returns nothing for a claim that is plainly still visible (mid-reflow, mid-scroll, target app repainting). `useStableUnderlines` holds a claim's last rects for `RECT_GRACE_MS` (900ms, under one `POLL_INTERVAL_MS`) — but only while it is still in `widget.claims`. A claim that was dismissed, cited or re-detected away vanishes immediately, because there the empty payload is the truth rather than a missed measurement. The hold is deliberately keyed off the *previous payload*, not the merged output, so a claim can be held once and cannot renew itself forever.
  - **Snapping.** Marks move by `transform` (GPU-composited; these repaint over another app on every poll, so a layout-triggering animation is felt). The transition is suppressed for large deltas: a few pixels of typing/reflow should glide, but a scroll moves the same rect hundreds of pixels and animating that sends the underline swooping across unrelated text.
  - **Invisibility.** The entrance fade is a CSS animation with **no fill-mode**, and the mark's base opacity is 1. This window is never focused and always sits above another app — exactly the case Chromium throttles rAF/animation callbacks in — so gating visibility on a JS frame callback (the first attempt) risked underlines that never appear at all. Degraded behaviour is now "appears instantly", not "invisible".
  - Each mark carries `data-claim-id` / `data-hovered`. The overlay renders no text, so without them its DOM is unreadable when inspecting or preview-testing it.
- **`overlayWindow.ts`** is a transparent, click-through (`setIgnoreMouseEvents(true, { forward: true })`), always-on-top, unfocusable `BrowserWindow` sized to cover whichever display the focused control is on; `OverlayApp.tsx` (its own renderer entry, `overlay.html`) just draws positioned bars from the rects it's pushed — it has no other interactivity by design, since a window that could intercept clicks over another app's UI would break that app.
- Known gap: screen coordinates from UIA and Electron's display bounds are assumed to be in the same coordinate space, which holds at 100% DPI scaling; multi-monitor setups with different per-monitor scale factors haven't been verified and may misalign underlines.
- The PowerShell script ships via `extraResources` in `electron-builder.yml` (`resources/uia-watch.ps1` → packaged `resources/uia-watch.ps1`), located at runtime the same dev/packaged-path-branching way as `icon.ts`.

### Structure (`main/services/structure/`, `shared/paragraphSplit.ts`, `renderer/src/components/ArgumentScoreModal.tsx`)

A reading of the draft as an *argument* rather than as sentences: it labels what each paragraph is doing, scores the draft out of 100, and names what is missing. Everything else in the app asks whether a sentence is true; this asks whether the essay works.

It used to be a rail beside the editor (`StructurePanel.tsx`). The rail was removed when the report modal took over the flow, and the component sat orphaned for a while afterwards — with it went the only bulk **"Check all N"** evidence sweep, leaving `checkClaims` reachable only from a mark popover that needs an already-scored claim to exist. That button now lives in the report's paragraph breakdown (`ScoreReport`, `onCheckClaims`/`checking` threaded down from `AnalyzeView`); the panel and its `docedit-structure`/`docedit-score`/`docedit-evidence`/`docedit-para` CSS are deleted. The sweep stays owned by `AnalyzeView` because it is serial with a visible count and must survive the modal closing mid-run.

- **The score is a deterministic formula, not a model output** (`structure/scoreDraft.ts`) — the same stance `search/scoring.ts` takes for evidence strength, and for the same reason: a number a student is asked to act on has to be one they can argue with. Six components (thesis 20, governing claims 20, warrant 20, counterargument 15, significance 15, conclusion 10). Governing claims is a **fraction of the body, never a count**, which is what stops the score being a length proxy — padding an essay lowers it. The panel displays every paragraph's role label beside the number so a wrong label is visibly wrong rather than mysteriously costly.
- **Evidence is deliberately NOT in the /100.** `strengthScore` already contains a `sourceCount` factor, so folding retrieval in would double-count it — and worse, would make the score track how *searchable* the topic is, capping a close reading of a novel near 50 because the academic APIs have nothing to say about it. `structure/evidenceCoverage.ts` reports it beside the score as a ratio instead. It reads `scoreBreakdown.sourceCount` rather than re-thresholding `claim_evidence.relevance_score`, because which metric produced those values (lexical 0.2 vs dense 0.35 floor) is *not* persisted with the rows.
- **`unknown` is a real answer.** `structure/roles.ts` labels only what a marker or a detected claim justifies and returns `unknown` for everything else; `complete: false` then makes the panel say **"provisional"**, and `structure/weaknesses.ts` **withholds whole-draft findings entirely** while any paragraph is unlabelled — "this draft has no counterargument" is an assertion about paragraphs nothing read. A guessed label produces a confident number computed from nothing, which is worse than admitting the paragraph wasn't read.
- **Exactly one relay call, and it is not wired up yet.** `ai/structureClassifier.ts` takes its endpoint as a parameter typed `Parameters<typeof callRelay>[0]`, and that union does not contain `'classify-structure'` — so it is uncallable by construction. `scripts/preflight.mjs` parses that union out of `client.ts` and requires each endpoint to answer non-404 in production, so widening it before the relay ships would block *every* release. Enabling it is three steps, written at the top of that file. The relay endpoint is committed in `../Tracely-relay` on `feat/classify-structure`, **not deployed**.
- **It runs in Screen Watch too, and that is where it costs least.** `uia-watch.ps1` returns the *whole* document of the focused control (`TextPattern.DocumentRange.GetText(-1)`, falling back to `ValuePattern.Current.Value`), and the whole engine is local, so the draft score follows the user into Word or Chrome for nothing. `screenWatch/watchOutline.ts` runs it; `screenWatchService.ts` memoises the result against `sourceHashFor(lastAnalyzedText)` + the claim ids + which claims have a relevant source. Three things about that are load-bearing:
  - **It analyses `lastAnalyzedText`, never the live snapshot.** Every paragraph index and role is a joint function of the text *and* the claims found in it; analysing live text while bucketing older claims lets a claim relocate into another paragraph and flips its role underneath the score. It also damps the whole feature for free — that text moves at most once per detection.
  - **The memo protects the payload dedupe, not just CPU.** `updateOverlayAndWidget` dedupes its IPC push by `JSON.stringify` of the whole payload, and it runs on every poll tick *and* every resolved favicon. A structure object rebuilt each tick would differ by identity alone and re-render the overlay over another app at 1.2s intervals forever.
  - **`screenWatch/structureFit.ts` is allowed to refuse.** UIA newline fidelity varies by app: some return the document with no newlines at all, others break on visual lines. `findWeaknesses` suppresses whole-draft findings behind `allLabelled`, but `warrant-gap`/`evidence-stacking` are per-paragraph and are *not* gated that way, so a bad split turns straight into confident accusations about paragraphs that do not exist. The gate fails to silence rather than to noise, and logs why.
- **The `contradicted` verdict is its own problem kind, not weak reasoning.** `CRITIQUE_SYSTEM_PROMPT` reserves it for "a specific fact you're confident is factually wrong" and tells the model to fall through to the rigor pass whenever it is merely unsure — so it is a claim about truth, while every other kind is a claim about support. `problemKind.ts` ranks `contradicted-claim` above everything, including `cited-unverified`.
- **The critique cache is keyed on the claim's TEXT, not its id** (`ai/critique.ts`, v6). Screen Watch mints a fresh `randomUUID()` per detection, so an id-keyed entry could never be hit there: re-detecting an unchanged sentence paid a fresh call on the reasoning model, the most expensive call in the product. `strengthScore` is in the key too, because it is in the request body.
- **Screen Watch claims need BOTH evidence fields folded in.** `withEvidenceScores` in `screenWatchService.ts` sets `strengthScore` *and* `scoreBreakdown`, because `computeEvidenceCoverage` decides "has a relevant source" from `scoreBreakdown.sourceCount`. Folding only the score marks every searched claim resolved-but-unsourced, producing an `unsupported-claim` weakness for every claim that in fact *has* sources. `evidenceCoverage.test.ts` pins this.
- **Tested modules are leaves.** `npm test` runs these through Node's type stripping, whose ESM resolver rejects the extensionless relative imports used throughout this codebase — so a module with a relative *value* import cannot be unit tested. That is why `roles.ts` duplicates three lines of sentence splitting instead of importing `splitSentences`, why the paragraph-bucketing logic lives in `shared/paragraphSplit.ts`, and why `analyzeStructure.ts` is thin: every decision with a wrong answer available sits somewhere the runner can load it.
- **`splitParagraphs` treats ANY newline run as a boundary**, not just a blank line. It runs on the contentEditable editor's `innerText`, where execCommand wraps each Enter in a `<div>` that Chromium renders as a single `\n`; requiring `\n\n` would see a normal essay as one giant paragraph. It lives in `shared/` because the renderer must re-derive the same paragraphs to draw text beside the labels — a `DocumentOutline` carries **no prose**, only indices, roles, booleans and ids.
- **`document_structure` is a cache of a pure function that still has to be persisted**, because it cannot be recomputed on demand: the analysis runs on `innerText`, and `documents.body_html` cannot be turned back into that string from main without parsing HTML. `source_hash` is over the innerText, so reformatting leaves the analysis valid while an edit to the words marks it stale.
- Layout: `.docedit-view` is a **row**, with the editor column in `.docedit-main`. `.docedit-wordcount` and `.docedit-error` must stay inside it or they become flex items of the row (the row had a second column, the Structure rail, until it was deleted; anything added back beside `.docedit-main` needs `-webkit-app-region: no-drag`, because `.docedit-view` is a drag region). Paragraph jumps use `scrollIntoView({ behavior: 'auto' })` — smooth scrolling is compositor-driven and silently does nothing when the window is not compositing, the same trap as the overlay's entrance animation.

### Tracer (removed)

Tracer was a conversational writing tutor in its own `BrowserWindow`, opened
from the Screen Watch widget. **It was removed** — window, relay client, IPC
handlers, repo, renderer entry and every "Ask Tracer" entry point — because the
widget was rebuilt on the Figma "Widget over Document" frames, and those frames
have no Tracer in them.

What deliberately stayed:

- **The `tracer_conversations` / `tracer_messages` tables**, and both Privacy
  clears' `DELETE` statements against them. Dropping tables destroys data on
  upgrade for nothing; the DELETEs are how an existing install's rows get
  cleaned up. Nothing writes to them.
- **The `Tracer*` types in `shared/ipc-contract.ts` and the `TRACER_*` channel
  constants**, because `src/shared/*` is additive (see the branch rules above)
  and unwiring an implementation is not a reason to restructure a shared file.
- **`tracerPrompt` on `StructureWeakness`.** Same rule. Nothing renders it.

`git log` has the implementation if it comes back. The relay's `/api/tracer`
was NOT touched — it is still deployed, and `callRelay`'s endpoint union no
longer names it, so `scripts/preflight.mjs` simply stops checking it.

Tailwind left with Tracer: it was scoped to that one window by import, no entry
pulls it in now, and the plugin is gone from both Vite configs.

### Where user data lives at runtime

- Windows: `%APPDATA%\Tracely\tracely.db` (SQLite: analyses, claims, evidence, citations, library, request cache) and `config.json` (Semantic Scholar key only — never the relay URL/token, which are compiled in).
- Settings → Privacy has two destructive ops: "Clear Analysis History" (`historyHandlers.ts` → `clearAnalysisHistory()`, keeps the library) vs. "Clear History + Library" (also wipes `sources`/`library_items`/`citations`). Both also clear any leftover `tracer_*` rows from before Tracer was removed.

## Known MVP simplifications (intentional, not bugs)

- Citation author formatting truncates to "et al." after 3 authors rather than implementing full APA/MLA/Chicago author-list rules.
- PubMed results have no abstract (would need a second NCBI `efetch` call per result; the other three providers already include abstracts).
