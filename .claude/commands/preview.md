---
description: Open the UI harness and drive the real renderer surfaces to verify a change
---

Boot `npm run preview:ui`, open it in the Browser pane, and **drive the real
renderer** — click its buttons, push IPC payloads into it, measure what it drew.

Use this whenever a change touches `src/renderer/`: a new panel, a layout
change, a state that is awkward to reach in the real app. Reading the JSX and
saying "looks right" is the failure this replaces. Every UI bug in this
repo's history — the clipped popover, the snapping underline, the invisible
mark, the 476-vs-560 panel — was invisible in the source and obvious the
moment something measured it.

The harness loads the **real** `index.html`, `floating.html` and
`overlay.html` in iframes at their true BrowserWindow sizes, against a mocked
IPC bridge. No SQLite, no relay, no Screen Watch, no hotkey. Safe to run
alongside the real app.

## Boot

Run in the background — it is a dev server and does not exit:

```bash
npm run preview:ui
```

Wait for the URL it prints (`Tracely Preview → http://localhost:5199/preview.html`),
then open it with `preview_start`. Take the port from the output rather than
assuming 5199; Vite moves on if it is taken.

## Turn on the surfaces you need

Only the Screen Watch overlay is enabled by default. The rail's checkboxes are
`.preview-check input`, in the order: main window, floating popup, Screen Watch
overlay, then the scenario toggles.

Match by **label text, not index** — the order changes as surfaces are added:

```js
(()=>{const boxes=[...document.querySelectorAll('.preview-check')];
const hit=boxes.find(l=>l.innerText.includes('Screen Watch overlay'));
hit.querySelector('input').click();
return 'on';})()
```

## Drive it

Each surface is an iframe titled after itself (`Screen Watch overlay`,
`Main window`, `Floating popup`). Inside it, `contentWindow.tracely` is the
mock bridge — the same object the real preload installs, so calling it exercises
the component's real handler:

```js
(()=>{const f=document.querySelector('iframe[title="Screen Watch overlay"]');
f.contentWindow.tracely.screenWatch.setWidgetViewMode({mode:'structure'});
return 'sent';})()
```

Prefer this over synthesising clicks. Widget geometry, drag handling and hover
all involve handlers that are fiddly to hit with a fabricated `MouseEvent`, and
calling the bridge is what the button would have done anyway.

Two things the overlay cannot receive any other way, because they come from the
real cursor and the poll loop, are exposed on its window by `mockApi.ts`:

- `__previewEmitHover(event | null)` — stands in for `hoverTracking.ts`
- `__previewEmitOverlay(event)` — stands in for an overlay payload push

Send `__previewEmitOverlay` a **complete** `ScreenWatchOverlayUpdateEvent`. A
partial one blanks the overlay, and it looks exactly like a render crash.

## Measure, don't eyeball

`computer{action:"screenshot"}` fails when the Browser pane is not displayed —
the page is not compositing, so there is no frame to capture. Do not treat that
as a blocker. Numbers catch more than a picture does anyway:

```js
(()=>{const d=document.querySelector('iframe[title="Screen Watch overlay"]').contentDocument;
const panel=[...d.querySelectorAll('div')].find(n=>n.style.borderRadius==='20px');
const body=[...panel.querySelectorAll(':scope > div')].find(n=>getComputedStyle(n).overflowY==='auto');
return JSON.stringify({
  panel: panel.getBoundingClientRect(),
  hOverflow: body.scrollWidth > body.clientWidth,   // horizontal overflow is always a bug
  scrolls: body.scrollHeight > body.clientHeight,   // vertical is fine IF it was meant to
  clientH: body.clientHeight, scrollH: body.scrollHeight
});})()
```

Worth asserting, roughly in order of how often they catch something:

- **No horizontal overflow.** Nothing in these windows should scroll sideways.
- **The drawn rect matches the size main computed for it.** For overlay panels
  main owns the size (`services/screenWatch/panelSize.ts`) because
  `hoverTracking.ts` hit-tests the same rect. If the mock's hardcoded height
  disagrees with that function, the harness is lying about available room —
  check them against each other rather than trusting the mock.
- **Priority order under a cap.** When content is taller than the panel, the
  part that must stay visible is above the fold.
- **The degraded state renders.** Null payload, empty list, error banner.

The overlay draws **no text**, so read it through its data attributes —
`data-claim-id`, `data-hovered`, `data-paragraph`, `data-role`. They exist for
exactly this.

## Four things that will waste your time once each

**No top-level `await`, and `const` leaks between calls.** Wrap every snippet in
an IIFE. For anything asynchronous, return a Promise:

```js
(()=>{ /* act */ return new Promise(res=>setTimeout(()=>{ /* assert */ res(result) },120)); })()
```

**React state is asynchronous.** Reading the DOM in the same tick as the click
that changed it returns the *old* value, which reads as "the feature does not
work". Wait ~100ms.

**Anything that reloads resets the surfaces.** Changing a scenario control
reloads the frames on purpose (the mock is constructed once per document,
exactly like the real bridge), and saving a file triggers HMR on the harness
page itself. Both drop you back to the overlay alone. Re-enable and re-drive.

**Timers you are testing are real timers.** An auto-clear on a 2500ms timeout
needs a wait past 2500ms to prove it fires — and a wait under it to prove the
thing was ever lit at all. Check both; only one of them is evidence.

## Fixtures and the drift guard

`src/renderer/src/preview/fixtures.ts` holds the data. `mockApi.ts` is typed
`Window['tracely']`, so adding or reshaping anything in `src/preload/index.ts`
fails `npm run typecheck` here until the mock is updated. That is the point of
it — treat that error as the harness doing its job, not as an obstacle.

Adding a field to an IPC payload means adding it to the fixture. **Hand-trace
any derived number in a comment** (a score, a total) rather than copying what
the code produced, so a change to the formula shows up as a disagreement
instead of the fixture quietly following it along.

Fixtures use a fixed timestamp, never `Date.now()`, so two runs of unchanged UI
are identical.

## Clean up

Kill the background dev server when finished. It survives the turn otherwise.

## What this cannot tell you

Everything behind the mock: real SQLite, the relay, UIA reading another app's
text, packaging, auto-update. A Screen Watch layout can be perfect here and
still misalign against real UIA rects at a different DPI scale.

When the harness says yes and the risk is in that layer, say so plainly and
follow with `npm run dev` (see `/dev`) or a real installer (`/beta`).
