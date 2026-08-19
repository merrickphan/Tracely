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
- **The confirmation says different things on the two surfaces, because they do
  different things.** The editor appends a real reference section to the
  document (`shared/worksCited.ts`, written through the same `execCommand` path
  as the marker, so one Undo unwinds both), and "ADDED TO WORKS CITED" is true
  there. The overlay writes the in-text marker into another application through
  UIA and nothing else — it owns no document and cannot see that window's
  reference list — so it says `ADD THIS TO YOUR REFERENCE LIST` over an
  always-visible entry with **Copy entry**, where the frame draws "View Works
  Cited". It carried the editor's label for a while over a list it had added
  nothing to, which is a card that makes a student hand in an essay one
  reference short and hear about it from a marker.
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
- **Merge into `main` when a feature is done, not when a release is due.**
  `npm run ship` no longer merges anything; it publishes what is already on
  `main`. Release time should not also be integration time.
- **Parallel work uses throwaway worktrees, not permanent ones.** Subagents
  launched with `isolation: "worktree"` get their own checkout and clean up
  after themselves. Three standing worktrees with a file-ownership contract were
  retired in favour of this: the contract needed maintaining, branches drifted
  24 commits behind, and 421 lines once sat uncommitted in two of them because
  each worktree registered the auto-commit hook separately.
- **A worktree runs the guards it was branched from, not the ones on `main`.**
  `settings.json` invokes them as `$CLAUDE_PROJECT_DIR/.claude/hooks/*.sh`, and
  in a worktree session that variable resolves to the worktree — so the hook
  files are whatever that checkout has, and fixing a guard on `main` does
  nothing for any worktree already in flight. A live probe of the revised
  `guard-bash.sh` sailed through a `git commit` aimed at `main` for exactly this
  reason: the session was four commits behind and running the version with the
  bug. **Merge `main` before trusting a guard in a long-lived worktree**, and
  test hook changes from a checkout that actually has them.
- **Test the guards with real tool calls, not hand-built payloads.** A synthetic
  payload has no `cwd` field, so it falls through to whatever the fallback is
  and passes while the real thing fails. Both hook bugs so far were found by
  running an actual command and neither was caught by a 19-case suite over
  invented JSON. The suite is still worth having for the branches real probes
  cannot reach — the deny path needs some checkout to be sitting on `main` —
  but it confirms nothing on its own.

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

**`main` requires a pull request, enforced on admins**, so nothing — including
`npm run ship` — can push to it directly. The release bump therefore goes to
`release/vX.Y.Z`, opens a PR and auto-merges once `check` is green (zero
approvals required, which is what keeps it automatic); ship then returns to main
at the merge commit, which is what gets built and tagged. `ship:preview`'s local
path used to push to main too and now derives its version without committing at
all, the same way CI always has.

**`npm run ship:dry`** runs all of that and stops before building. It is not
side-effect free and pretending otherwise would make it useless: it really bumps
the version and really merges the release PR, because that sequence is the thing
worth testing. It publishes nothing. The cost is one skipped patch number — main
sits a version above the latest release, and the next real ship bumps past it.
Written because the release path was otherwise the least-tested code here, for
the worst possible reason: the only way to test it was to publish, and
electron-updater cannot downgrade.

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

- **ONE report, rendered on both surfaces** (`components/EssayGradeReport.tsx`).
  Screen Watch's breakdown and the editor's "AI Insights" report were two
  implementations of one rubric — the overlay's built verbatim from Figma
  "Essay Grade Widget (Full Report)" (404:185), the editor's from `.argscore-*`
  classes in `index.css` — drifting apart at the pace of whichever was edited
  last. The owner's call (2026-08-19) was that the widget's is the one to keep,
  so it moved out of `OverlayApp.tsx` and `ArgumentScoreModal` renders it for
  `view.name === 'full'`. **Inline styles, deliberately**: the overlay window
  loads no stylesheet, so that is the one form that works in both. It is the
  opposite of the `problemCopy.ts` rule (share the wording, not the markup) and
  the exception is that here the markup is the thing being shared. Its props
  (`GradeInput`/`GradeClaim`) are narrower than `ScreenWatchStructure` so the
  editor can adapt a `DocumentOutline` without pretending to be a Screen Watch
  payload — the two fields it must supply itself, previews and stats, are the
  two `DocumentOutline` deliberately has no prose for.
- **The score is a deterministic formula, not a model output** (`structure/scoreDraft.ts`) — the same stance `search/scoring.ts` takes for evidence strength, and for the same reason: a number a student is asked to act on has to be one they can argue with. Six components (thesis 20, governing claims 20, warrant 20, counterargument 15, significance 15, conclusion 10). Governing claims is a **fraction of the body, never a count**, which is what stops the score being a length proxy — padding an essay lowers it. The panel displays every paragraph's role label beside the number so a wrong label is visibly wrong rather than mysteriously costly.
- **`shared/gradeLevel.ts` owns score → letter end to end** — the bands AND the
  level shift. The bands were in `renderer/components/essayGrade.ts`, which
  `npm test` cannot load (it resolves the `@shared` alias), and a band table
  nothing can test is how the scale shipped with no A+ at all: "A" was the top,
  so a draft that met every expectation of its level could not be told it had.
  That file is now a re-export.
- **The grading LEVEL moves the SCORE, and the letter follows it**
  (`shared/gradeLevel.ts`, Settings → Preferences, grades 3-12). It moved the
  letter only at first, on the argument that the report's six components add to
  the number shown; the owner's answer was that the number is what a student
  reads, and a 78 with an "A+" beside it is a card arguing with itself. So the
  ring shows `adjustedScore` and the report prints the step — rubric score,
  credit, total — as its own row, which is what keeps the arithmetic visible.
  4 points per year below 12, the level the bands are written against, so an
  install that never opens the setting grades exactly as before.
- **The bands are the standard scale**: 90-100 A, 80-89 B, 70-79 C, 60-69 D,
  below 60 F, with thirds inside each decade for the plus and minus. The Figma
  frame's own example (82 reading "B+") is the one thing that gave — on this
  scale 82 is a B-, and a grading scale belongs to the reader rather than to
  the mockup.
- **The rubric asks what a paragraph IS; `structure/reasoningIssues.ts` asks whether it does the job.** A draft could score well by being well-formed — a thesis in place, evidence present, a conclusion at the end — while none of the links between them held. The reasoning pass reads the prose for the CLAIM → EVIDENCE → REASONING → SIGNIFICANCE chain and names the link that is missing: evidence dropped without analysis, an absolute nothing earns, emphasis standing in for argument, a demonstrative with no antecedent, a conclusion that restates the thesis, a sentence that repeats the one before it, an opening that would fit any essay.
  - **Most of the rubric is NOT in that module and must not be moved there.** Whether evidence actually proves the claim it is attached to, whether a counterargument is the strongest available one, whether an analysis explains a mechanism or merely restates — those need a reader. They live in `CRITIQUE_SYSTEM_PROMPT` (Pass 3) and `STRUCTURE_SYSTEM_PROMPT` (`hasWarrant`) in `../Tracely-relay/lib/prompts.ts`. What is local is the subset a rule can be *right* about.
  - **Every detector is anchored** — to the end of a paragraph, the start of a paragraph, or a closed word list — rather than matched anywhere in the draft, and the negative tests outnumber the positive ones. Two rules were already caught being too wide by their own negatives: `\([^)]*\)` read "(an itinerary few would attempt)" as a citation, and `every (?:country|society|culture)` read "she visited every country on the itinerary" as an unfalsifiable claim. Both were narrowed rather than kept with an exception list.
  - **Exactly two of the findings reach the score, and both quote the sentence they cost points for.** `dropped-evidence` vetoes `hasWarrant` in `analyzeStructure` — a paragraph whose last sentence IS the citation has demonstrably not explained it, and where the label and the text disagree the text wins. `restated-conclusion` halves the conclusion component, compounding with the existing halving for a misplaced one. Nothing else touches the number: a prose rule is a weaker instrument than a role label, and the rule of this rubric is that a point lost traces to something the writer can look at.
  - **They are NOT gated on `allLabelled`, unlike every whole-draft weakness.** That gate exists because "this draft has no counterargument" asserts something about paragraphs nothing read; these assert something about words that are demonstrably there and are quoted back. Suppressing them because a model returned `unknown` for paragraph 6 would withhold the only feedback that does not depend on the labelling at all.
  - **`dropped-evidence` suppresses `warrant-gap` on the same paragraph.** They are one complaint from two sources, and a report naming both reads as two problems. The quoted one wins.
  - `StructureWeakness.quote` is optional because the seven original kinds have nothing to quote — an absence has no words. `ArgumentScoreModal`'s problem card falls back to it when there is no claim behind the finding.

- **Four of the six components are presence checks, and two now have a quality axis.** Owner, 2026-08-19: *"Can these all be 100%? Besides significance and counterargument, it just doesn't make sense."* They could, and it didn't: `thesis` was 20/20 for a thesis-shaped paragraph in the first third, `conclusion` 10/10 for a last paragraph labelled one. `topic-not-thesis` now halves the first (an opening that announces a subject has oriented the reader and claimed nothing) and `restated-conclusion` halves the second, each compounding with the existing positional halving. `summary-without-point` vetoes `statesClaim`, so a paragraph that only relays sources stops counting toward `governingClaims`.
  - **This narrows the saturation; it does not remove it.** The remaining cause is that `warrant` and `governingClaims` are computed from the role vector, and the vector is only as good as whatever produced it. In the editor that is the relay classifier; in Screen Watch it is `roles.ts`, hand-written patterns, where a draft can max `warrant` by writing "therefore" once per paragraph. **An earlier version of this bullet said the classifier was not deployed. It is, and has been** — see below. The lever is the classifier's PROMPT, not its existence.
- **`new-claim-in-conclusion` is gated on `conclusionDrawsOnBody`, and was wrong without it.** It fired on ANY detected claim in the closing paragraph, which is the move a conclusion exists to make: owner, 2026-08-19, *"obviously by the end, it is completely supported by everything above. It is simply creating a claim using the evidence from everything preceding it."* Correct. The finding is only about a claim made of material the draft never introduced, measured as vocabulary overlap with everything above it, at a deliberately low bar (half) — a false positive here tells a student to delete the best sentence in their essay.
- **Where a critique's money actually goes**, measured 2026-08-19 from the caps in `costGuard.ts` and the price table in the relay's `lib/usageLog.ts` (gpt-4.1, $2/$0.50-cached/$8 per 1M): system prompt 32% (3,213 tokens, identical every call, so it prefix-caches at a quarter price), **evidence summary 40%**, completion 26%, claim and score 2%. A warm call is ~$0.004; six are ~2.9c.
  - **The evidence summary is the lever, not the system prompt.** The prompt is the bigger token count and the smaller bill, because it is cached; the evidence is fresh every call.
  - **`searchedSlots` takes `citedHasAbstract` for that reason.** Pass 2.5 tells the model to STOP at slot 1 when the cited source answers — "do not read the other items" — and we were sending three of them anyway at ~225 tokens each. When the resolved work came back with an abstract the client knows the model can answer from it, so one fallback goes instead of three; with no abstract, Pass 2.5's own fall-through condition is already met and the full set goes. ~20% off a cited claim's call, and the request now agrees with the prompt instead of contradicting it. An UNCITED claim is untouched: that list is not a fallback, it is the evidence.
  - **Anything changing what is SENT must change the cache key.** `searchedSlots` is exported precisely so `cacheKey` and the request derive the cut from one place; the abstract flag is now in both.
  - **Not done, and why:** batching claims into one call saves ~27% of the prompt cost and breaks the per-claim SQLite cache — editing one sentence would re-critique all six, which makes the common case worse. `gpt-4.1-mini` is 5x cheaper and is a real option, but it is the model that has to hold `fabricated` to a high bar, and swapping it is an eval question (`eval/critique/FINDINGS.md`), not a config change.
  - **The cache hit rate is assumed, not observed.** `logUsage` prints `cached=N (X%)` per call and nothing has read it. Six auto-critiques fire back to back so calls 2-6 should hit; one essay an hour may pay cold every time. Read the relay logs before optimising further.

- **The citation check has a free half and a paid half, and they were added together for one reason.** Once `claimsWithoutEvidence` stopped calling a cited claim unsupported, a broken citation and a good one both went silent — the owner's own draft carried `(Unknown Author, 2025)` one card below a real reference and neither was named.
  - **Free: `shared/citationShape.ts`** — defects visible in the SHAPE of a reference, nothing read. Placeholder authors, `[citation needed]`, a year that has not happened yet, a bare URL, `n.d.`, and the same reference pasted twice in a row (which that draft also had). Raised as the `malformed-citation` weakness, run per paragraph over the works-cited-TRIMMED spans — a reference list is a page of parentheses and every rule would fire down it. **"Anonymous" is deliberately not a placeholder** and `(Smith)` with no year is deliberately not a defect: nothing on the surface separates it from "(see Smith)".
  - **Paid: `autoCritiqueCited`** (Settings → Preferences, ON by default). The critique is the only thing in this app that opens the cited work, so it is the only thing that can tell a formatting slip from a fabrication. Eligibility lives in `shared/autoCritique.ts` — a tested leaf, not a `useEffect` — because it decides when money is spent without anyone pressing anything: cited only, evidence resolved, no verdict yet, capped at `MAX_AUTO_CRITIQUE_CLAIMS`, in document order.
  - **ON by default here, still NEVER in Screen Watch, and the difference is consent.** Screen Watch reads whatever is on screen forever without being asked, so an unprompted paid call there is a bill nobody can watch being run up — that rule stands. This fires inside a document the user opened, on claims they themselves attached a source to. `autoCritiquedRef` guards re-firing, and a failed settings read leaves it null so the sweep never runs.
  - `MAX_AUTO_CRITIQUE_CLAIMS` is defined in `shared/` and **re-exported from `costGuard.ts`**, so that file stays the one place to look for an AI limit while the renderer — which drives the sweep — can still import it.

- **A claim the WRITER cited is never reported as unsupported on retrieval's say-so.** `claimsWithoutEvidence` filtered on resolved / no-relevant-source / in-scope and never asked whether the sentence carried a reference, so a line ending `(Lähteenmäki, 2006)` was named **"Unsupported claim · 0/100 evidence — no supporting source yet"**. That sentence is not unhelpful, it is false: there is a supporting source, in the sentence. What was established is that a topical search of four scholarly indexes returned nothing, and nothing in the retrieval path ever opens the work the writer named.
  - It is the SAME rule `problemKindsFor` has applied to the underline since 2026-08-16, where `nothingFound` gates `cited-unverified`. The two surfaces were reading one claim and disagreeing — the mark stayed quiet, the report accused. `citationLookup` is now shared with `computeEvidenceCoverage`, so a claim counted under `withOwnCitation` cannot also be listed under "no supporting source" in the same panel.
  - **Pass `documentText`.** A detected claim is a sub-span of its sentence, so the reference frequently sits outside the claim text; without the document this falls back to the claim-only test and misses it. Both callers (`structureHandlers`, `watchOutline`) pass it.
  - **The cost is the same one `problemKind.ts` already accepts: a genuinely miscited claim says nothing HERE until the critique runs.** That is not a gap — `citedEvidence.ts` puts the writer's resolved source in slot 1 and `CRITIQUE_SYSTEM_PROMPT` Pass 2/2.5 judge the citation itself, which is the only path in this app that ever reads it. Retrieval cannot reach `citationFix` or `fabricated` and must stop implying it has. **Critique is manual**, so between analysis and that click Tracely is silent about a cited claim rather than wrong about it.

- **A strength score of 0 means two different things and must not render as one.** When nothing clears the relevance floor, every factor in `ScoreBreakdown` is 0 by construction, and the Argument Check card drew "0/100" over four empty bars beside a correctly cited biographical sentence. `problemKindsFor` has drawn this distinction since 2026-08-16 (`nothingFound` gates `cited-unverified`); the score display had not, so the accusation the problem kinds refuse to make was being made by the number underneath them. `ArgumentScoreModal`'s `measured` now suppresses the number, the track and the metric grid entirely and says what was searched instead. **There were two of these and the first fix caught one**: the problem card's `· 0/100 evidence` chip is a separate render path and kept printing for another day. Both are gated on `hasRelevantSource` now; grep for `/100` before assuming a third does not exist. **Do not reinstate a zero here.** The four indexes hold scholarly articles; biography, institutional records, news and primary texts are structurally outside them, and `retrievalScope.ts` names only five of those categories.

- **Evidence is deliberately NOT in the /100.** `strengthScore` already contains a `sourceCount` factor, so folding retrieval in would double-count it — and worse, would make the score track how *searchable* the topic is, capping a close reading of a novel near 50 because the academic APIs have nothing to say about it. `structure/evidenceCoverage.ts` reports it beside the score as a ratio instead. It reads `scoreBreakdown.sourceCount` rather than re-thresholding `claim_evidence.relevance_score`, because which metric produced those values (lexical 0.2 vs dense 0.35 floor) is *not* persisted with the rows.
- **`unknown` is a real answer.** `structure/roles.ts` labels only what a marker or a detected claim justifies and returns `unknown` for everything else; `complete: false` then makes the panel say **"provisional"**, and `structure/weaknesses.ts` **withholds whole-draft findings entirely** while any paragraph is unlabelled — "this draft has no counterargument" is an assertion about paragraphs nothing read. A guessed label produces a confident number computed from nothing, which is worse than admitting the paragraph wasn't read.
- **Exactly one relay call, and it IS live.** `ai/structureClassifier.ts` is called unconditionally from `ipc/structureHandlers.ts` for every editor analysis; `'classify-structure'` is in `callRelay`'s union, and `api/classify-structure.ts` is deployed on the relay's `main` and `staging` (probed 2026-08-19: 401, not 404, on both). `scripts/preflight.mjs` reads that union and would have blocked every release otherwise.
  - **This paragraph used to say the opposite, and the stale comment block at the top of `structureClassifier.ts` said it too — three enabling steps that had all already been taken.** It cost a wrong answer to the owner about where the grading weakness lives. **Probe the endpoint before repeating either claim**; a source comment is not evidence about a deployment.
  - **Screen Watch deliberately does NOT classify** (`screenWatch/watchOutline.ts`), so the overlay's grade is heuristic-only and the editor's is not. Two surfaces, two label qualities, one rubric — worth remembering before comparing scores between them.
  - **The client and the relay prompt version each other.** `statesClaim` arrived in the client and in `STRUCTURE_SYSTEM_PROMPT` at the same time; a production relay behind staging returns a vector the client then falls back on (`governsAClaim` degrades to `role === 'claim'`). Check `git log origin/main..origin/staging` in `../Tracely-relay` before concluding anything from a production score.
- **It runs in Screen Watch too, and that is where it costs least.** `uia-watch.ps1` returns the *whole* document of the focused control (`TextPattern.DocumentRange.GetText(-1)`, falling back to `ValuePattern.Current.Value`), and the whole engine is local, so the draft score follows the user into Word or Chrome for nothing. `screenWatch/watchOutline.ts` runs it; `screenWatchService.ts` memoises the result against `sourceHashFor(lastAnalyzedText)` + the claim ids + which claims have a relevant source. Three things about that are load-bearing:
  - **It analyses `lastAnalyzedText`, never the live snapshot.** Every paragraph index and role is a joint function of the text *and* the claims found in it; analysing live text while bucketing older claims lets a claim relocate into another paragraph and flips its role underneath the score. It also damps the whole feature for free — that text moves at most once per detection.
  - **The memo protects the payload dedupe, not just CPU.** `updateOverlayAndWidget` dedupes its IPC push by `JSON.stringify` of the whole payload, and it runs on every poll tick *and* every resolved favicon. A structure object rebuilt each tick would differ by identity alone and re-render the overlay over another app at 1.2s intervals forever.
  - **`screenWatch/structureFit.ts` is allowed to refuse.** UIA newline fidelity varies by app: some return the document with no newlines at all, others break on visual lines. `findWeaknesses` suppresses whole-draft findings behind `allLabelled`, but `warrant-gap`/`evidence-stacking` are per-paragraph and are *not* gated that way, so a bad split turns straight into confident accusations about paragraphs that do not exist. The gate fails to silence rather than to noise, and logs why.
- **The `contradicted` verdict is its own problem kind, not weak reasoning.** `CRITIQUE_SYSTEM_PROMPT` reserves it for "a specific fact you're confident is factually wrong" and tells the model to fall through to the rigor pass whenever it is merely unsure — so it is a claim about truth, while every other kind is a claim about support. `problemKind.ts` ranks `contradicted-claim` above everything, including `cited-unverified`.
- **The critique cache is keyed on the claim's TEXT, not its id** (`ai/critique.ts`, v6). Screen Watch mints a fresh `randomUUID()` per detection, so an id-keyed entry could never be hit there: re-detecting an unchanged sentence paid a fresh call on the reasoning model, the most expensive call in the product. `strengthScore` is in the key too, because it is in the request body.
- **Screen Watch claims need BOTH evidence fields folded in.** `withEvidenceScores` in `screenWatchService.ts` sets `strengthScore` *and* `scoreBreakdown`, because `computeEvidenceCoverage` decides "has a relevant source" from `scoreBreakdown.sourceCount`. Folding only the score marks every searched claim resolved-but-unsourced, producing an `unsupported-claim` weakness for every claim that in fact *has* sources. `evidenceCoverage.test.ts` pins this.
- **The editor searches evidence automatically, and that is what draws the
  underlines.** `measureMarks` skips any claim with no evidence (null means
  "never looked", and underlining an unchecked claim reports a verdict Tracely
  has not reached), so before this a freshly analysed document had claims, a
  score and NOT ONE mark until the writer found "Check all N" two screens away
  inside the full report. `AnalyzeView` now sweeps unsearched claims once per
  analysis, tracked in `autoSearchedRef` so a search that comes back empty
  cannot loop. The rule that allows it is the same one Screen Watch runs under:
  evidence search hits the four free public APIs and never the relay. Critique
  — the paid call — stays manual on both surfaces. The sweep shows its progress
  (`.docedit-checking`), because a 30-second wait that shows nothing is
  indistinguishable from marks that never come.
- **Tested modules are leaves.** `npm test` runs these through Node's type stripping, whose ESM resolver rejects the extensionless relative imports used throughout this codebase — so a module with a relative *value* import cannot be unit tested. That is why `roles.ts` duplicates three lines of sentence splitting instead of importing `splitSentences`, why the paragraph-bucketing logic lives in `shared/paragraphSplit.ts`, and why `analyzeStructure.ts` is thin: every decision with a wrong answer available sits somewhere the runner can load it.
- **`splitParagraphs` treats ANY newline run as a boundary**, not just a blank line. It runs on the contentEditable editor's `innerText`, where execCommand wraps each Enter in a `<div>` that Chromium renders as a single `\n`; requiring `\n\n` would see a normal essay as one giant paragraph. It lives in `shared/` because the renderer must re-derive the same paragraphs to draw text beside the labels — a `DocumentOutline` carries **no prose**, only indices, roles, booleans and ids.
- **`document_structure` is a cache of a pure function that still has to be persisted**, because it cannot be recomputed on demand: the analysis runs on `innerText`, and `documents.body_html` cannot be turned back into that string from main without parsing HTML. `source_hash` is over the innerText, so reformatting leaves the analysis valid while an edit to the words marks it stale.
- Layout: `.docedit-view` is a **row**, with the editor column in `.docedit-main`. `.docedit-wordcount` and `.docedit-error` must stay inside it or they become flex items of the row (the row had a second column, the Structure rail, until it was deleted; anything added back beside `.docedit-main` needs `-webkit-app-region: no-drag`, because `.docedit-view` is a drag region). Paragraph jumps use `scrollIntoView({ behavior: 'auto' })` — smooth scrolling is compositor-driven and silently does nothing when the window is not compositing, the same trap as the overlay's entrance animation.

### Tracer (removed, then restored as a panel)

Tracer is a conversational writing tutor. It was removed — window, relay
client, IPC handlers, repo, renderer entry and every "Ask Tracer" entry point —
when the Screen Watch widget was rebuilt on the Figma "Widget over Document"
frames, which have no Tracer in them. It came back on 2026-08-18 because Home's
frame draws a **"Chat with Tracer"** launcher and the owner asked for the panel
behind it.

**It is a panel inside the main window now, not a `BrowserWindow`.**
`components/TracerChat.tsx`, anchored bottom-left over Home, above the launcher
that opens it. That is what makes the restored version about a quarter of the
old one: no window to open or close, no conversation list, no retry — those
existed to give a separate window a sidebar.

- **`ipc/tracerHandlers.ts` registers three channels**, all of them ones
  `shared/` already had (`TRACER_GET_CONVERSATION`, `TRACER_SEND`,
  `TRACER_NEW_CONVERSATION`). The `Tracer*` types and `TRACER_*` constants were
  never deleted — `src/shared/*` is additive — so the contract was waiting.
- **The context comes from the most recent draft, not from Screen Watch.**
  `currentContext()` in `services/ai/tracer.ts` reads `getLatestDocument()`.
  The old one read whatever document was focused in another application, which
  is the wrong source for a launcher on Home: if Home is on screen, the app's
  own window is focused, so Screen Watch is by definition looking at nothing.
- **Nothing is cached.** Every other relay call is keyed by a hash of its input
  and served from `cacheRepo` on a repeat, because those are pure functions of
  their input. A chat turn depends on the whole conversation so far, so a cache
  would be actively wrong rather than merely useless.
- **The history cap is on TURNS, not characters** (`MAX_TRACER_HISTORY_MESSAGES`
  = 12). Every prior turn is re-sent on every message, so an uncapped
  conversation costs quadratically. The OLDEST turns are trimmed, which keeps
  the exchange the user is in the middle of intact.
- **`callRelay`'s endpoint union names `'tracer'` again.**
  `scripts/preflight.mjs` scrapes that union and requires each endpoint to
  answer non-404 in production; `api/tracer.ts` is on the relay's `main` and
  `staging`, so this does not block a release. It was never taken down.
- **The `tracer_conversations` / `tracer_messages` tables and both Privacy
  clears' DELETEs against them** survived the removal, so restoring wrote no
  migration. `tracerRepo.ts` came back from `git show f7eb21a^` unchanged.
- **Tracer can edit the draft, and only in one direction.** It may end a reply
  with a `<<<REWRITE / FIND: / REPLACE: / >>>` block; `shared/tracerRewrite.ts`
  parses it, and the offer only becomes an Apply button if the replacement
  passes `isNarrowing` — it may DROP a named thing, a number or a date, never
  introduce one. That is the same rule critique's `suggestedRevision` lives by,
  which is why `isNarrowing` moved to `shared/narrowing.ts`: one copy, enforced
  on both paths. The relay prompt asks for the same thing and the client checks
  it again, because the model broke this rule in production once already.
- **The Apply button only exists in the editor.** `TracerChat`'s
  `onApplyRewrite` is optional, and Home does not pass it — there is no open
  document there, so the card would be a button that cannot work. In
  `AnalyzeView` the edit goes through `applyTracerRewrite` →
  `documentMarks.replaceRange` → `execCommand('insertText')`, so ONE Ctrl+Z
  takes it back out. Verified in the harness, not assumed.
- **`find` is re-located in the live document**, never applied at a stored
  offset, and it refuses a sentence that appears twice rather than guessing
  which copy was meant. The conversation can be minutes old and the writer has
  been typing.
- **Do not call the apply function inside a `setState` updater.** It was, for
  one build: React invokes an updater twice under StrictMode, the second call
  re-ran the rewrite against a document that had already taken it, and the card
  said "that sentence is not in the document any more" over a correctly
  rewritten sentence. The harness caught it; the fix is to run the edit in the
  handler and set state with the result.
- **`tracerPrompt` on `StructureWeakness` is still unrendered.** Nothing writes
  an "Ask Tracer about this weakness" entry point yet; the panel takes typed
  questions only.

Tailwind did NOT come back with it — it was scoped to the old window by import,
and this panel is `.tracer-*` classes in `index.css` like everything else.

### Where user data lives at runtime

- Windows: `%APPDATA%\Tracely\tracely.db` (SQLite: analyses, claims, evidence, citations, library, request cache) and `config.json` (Semantic Scholar key only — never the relay URL/token, which are compiled in).
- Settings → Privacy has two destructive ops: "Clear Analysis History" (`historyHandlers.ts` → `clearAnalysisHistory()`, keeps the library) vs. "Clear History + Library" (also wipes `sources`/`library_items`/`citations`). Both also clear `tracer_*` rows — Tracer conversations are real rows again (see above), and "clear my history" has to mean them too.

### Spelling and grammar

Two different mechanisms, deliberately:

- **Spelling is Chromium's** (`main/spellcheck.ts`). The editor sets
  `spellCheck` on its contentEditable, which draws the squiggle; main builds
  the context menu Electron requires an app to build itself, carrying
  `params.dictionarySuggestions` plus "Add to dictionary" and the ordinary
  edit roles. The dictionary is downloaded per language and cached in the
  user-data dir; offline it degrades to no squiggles rather than wrong ones.
- **Grammar is `shared/proseIssues.ts`** — pattern matching over the text, no
  dictionary and no parser. It can catch "teh the", "a apple", "would of" and
  "alot"; it can never catch "ctaclysm", and shipping a dictionary to try would
  be a worse copy of the checker already in the process.

The rules there are bounded on purpose: a credibility flag that is wrong makes
the tool look cautious, a grammar flag that is wrong makes it look illiterate,
and writers forgive the first and switch off the second. The capitalisation
rule's `ABBREVIATIONS` list is the shape of that — every entry is a false
positive it would otherwise produce on ordinary academic prose.

## Known MVP simplifications (intentional, not bugs)

- Citation author formatting truncates to "et al." after 3 authors rather than implementing full APA/MLA/Chicago author-list rules.
- PubMed results have no abstract (would need a second NCBI `efetch` call per result; the other three providers already include abstracts).
