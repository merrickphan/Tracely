import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

/**
 * The window scales instead of reflowing, and this is what proves it.
 *
 * Home used to be a Figma transcription — `.home-canvas` filling the window
 * with sixteen `position: absolute` children at literal design coordinates —
 * which is why this file exists. It reflows now like every other view.
 * A window that reflowed would strand them in the corner with empty space
 * beside them, and nothing in a unit test can see that — the failure is
 * geometric and lives in the real compositor.
 *
 * So this resizes a real window and measures the real boxes. Two invariants:
 *
 *   1. `.app-shell` fills the window exactly at every size. Short of it leaves a
 *      transparent strip, past it clips the card — the two halves of the bug
 *      recorded at the top of shared/windowSize.ts.
 *   2. An element authored at a fixed px size occupies the SAME FRACTION of the
 *      window at every scale. That is what "scales rather than reflows" means,
 *      and it is the half that keeps Home's absolute coordinates correct.
 *
 * Measured through `getBoundingClientRect`, which in current Chromium reports
 * post-`zoom` pixels rather than design units — the first version of this file
 * assumed the opposite and failed at 0.7 against a layout that was correct.
 * Ratios are used precisely because they do not depend on which of the two it
 * is.
 */

const REPO = resolve(import.meta.dirname, '..')
const LAYOUT_WIDTH = 898
const LAYOUT_HEIGHT = 634

function launchIsolated() {
  const userData = mkdtempSync(join(tmpdir(), 'tracely-e2e-'))
  return {
    userData,
    app: electron.launch({ args: [REPO, `--user-data-dir=${userData}`], cwd: REPO })
  }
}

async function teardown(app, userData) {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {})
  await app.close().catch(() => {})
  rmSync(userData, { recursive: true, force: true })
}

async function mainWindow(app, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const w = app.windows().find((x) => x.url().endsWith('/index.html'))
    if (w) return w
    if (Date.now() > deadline) throw new Error('no index.html window')
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('the card fills the window at every size, and keeps its design units', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(800)

  const resizable = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html'))?.isResizable()
  )
  assert.equal(resizable, true, 'the main window is not resizable')

  // A real element from the Figma transcription, authored at a fixed px size.
  // Its share of the window is what must not move.
  // Home's brand lockup: a fixed-size logo beside fixed-size type, present on
  // every render of the screen. The old probe was `.home-el`, one of sixteen
  // absolutely-positioned children of a Figma transcription that the Home
  // rebuild replaced with ordinary flow and grid.
  const probe = '.home-brand'
  assert.ok(
    await page.locator(probe).first().isVisible().catch(() => false),
    `${probe} is not on screen — this test measures nothing without it`
  )

  const ratios = []

  // Every scale a user can reach, including both clamps.
  for (const scale of [0.7, 0.85, 1, 1.4, 2.5]) {
    const width = Math.round(LAYOUT_WIDTH * scale)
    const height = Math.round(LAYOUT_HEIGHT * scale)

    await app.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith('/index.html')
        )
        win.setSize(size.width, size.height)
      },
      { width, height }
    )
    await page.waitForTimeout(250)

    const m = await page.evaluate((sel) => {
      const shell = document.querySelector('.app-shell')
      const box = shell.getBoundingClientRect()
      const el = document.querySelector(sel).getBoundingClientRect()
      return {
        shellWidth: box.width,
        shellHeight: box.height,
        probeWidth: el.width,
        probeLeft: el.left,
        zoom: getComputedStyle(document.documentElement).zoom,
        appZoom: getComputedStyle(document.documentElement).getPropertyValue('--app-zoom').trim(),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        // Nothing may overflow the window — a transparent strip or a clipped
        // card both show up here.
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight
      }
    }, probe)

    ratios.push({
      scale,
      probeWidth: Math.round(m.probeWidth),
      width: m.probeWidth / m.innerWidth,
      left: m.probeLeft / m.innerWidth
    })

    console.log(
      `  scale ${String(scale).padEnd(4)} window ${String(m.innerWidth).padStart(4)}x${String(m.innerHeight).padStart(4)}  ` +
        `shell ${m.shellWidth.toFixed(1)}x${m.shellHeight.toFixed(1)}  zoom ${Number(m.zoom).toFixed(3)}  ` +
        `probe ${(100 * m.probeWidth / m.innerWidth).toFixed(2)}% wide at ${(100 * m.probeLeft / m.innerWidth).toFixed(2)}%`
    )

    // The card fills the window: one pixel of slack, because the window size is
    // rounded to whole pixels and the derived zoom cannot divide back exactly.
    assert.ok(
      Math.abs(m.shellWidth - m.innerWidth) <= 1,
      `at scale ${scale} the shell is ${m.shellWidth}px in a ${m.innerWidth}px window`
    )
    assert.ok(
      Math.abs(m.shellHeight - m.innerHeight) <= 1,
      `at scale ${scale} the shell is ${m.shellHeight}px in a ${m.innerHeight}px window`
    )
    // The two must never drift — one sets `zoom`, the other cancels it out of
    // the viewport units, and a mismatch is the off-the-bottom login bug.
    assert.equal(Number(m.appZoom).toFixed(4), Number(m.zoom).toFixed(4), `--app-zoom drifted from zoom at ${scale}`)
    assert.ok(m.scrollWidth <= m.innerWidth + 1, `the page overflows horizontally at scale ${scale}`)
    assert.ok(m.scrollHeight <= m.innerHeight + 1, `the page overflows vertically at scale ${scale}`)
  }

  // The assertion the whole file is for, INVERTED on 2026-08-18.
  //
  // It used to require the probe to keep the same FRACTION of the window at
  // every size — that is what "the UI scales as one piece" means, and it was
  // the contract until the owner asked for a window that resizes like any
  // other app. Now the opposite must hold: the element keeps its PIXEL size
  // and a bigger window is more room, not bigger type.
  //
  // Kept as a test rather than deleted because it is the only thing that would
  // catch the zoom being re-attached to the window width, which is a change
  // that looks harmless in a diff and breaks every viewport unit in the sheet.
  const base = ratios.find((r) => r.scale === 1)
  for (const r of ratios) {
    assert.ok(
      Math.abs(r.probeWidth - base.probeWidth) <= 1,
      `at ${r.scale}x the probe is ${r.probeWidth}px, not ${base.probeWidth}px — the UI scaled with the window instead of reflowing`
    )
  }
})

test('width and height resize independently', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  await mainWindow(app)

  // Asked of the REAL window rather than of the constants: the aspect lock was
  // a main-process `setAspectRatio` call, and a reinstated one would silently
  // drag height around with every width change. The symptom is only visible to
  // someone holding a side grip.
  const limits = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html'))
    const [minW, minH] = win.getMinimumSize()
    const before = win.getSize()
    // Width only. Under an aspect lock the height follows; without one it does
    // not move at all.
    win.setSize(before[0] + 220, before[1])
    const after = win.getSize()
    win.setSize(before[0], before[1])
    return { minW, minH, before, after }
  })

  assert.equal(
    limits.after[1],
    limits.before[1],
    `changing the width moved the height from ${limits.before[1]} to ${limits.after[1]} — the aspect ratio is still locked`
  )
  assert.equal(limits.after[0], limits.before[0] + 220, 'the width did not take the size it was given')

  // A floor low enough to be unusable would be worse than none, and it must
  // not be the layout's shape any more.
  assert.ok(limits.minW >= 600 && limits.minW < LAYOUT_WIDTH, `minimum width ${limits.minW} is out of range`)
  assert.ok(limits.minH >= 400 && limits.minH < LAYOUT_HEIGHT, `minimum height ${limits.minH} is out of range`)
})

/*
 * The window is an ORDINARY OS window now.
 *
 * Three tests were deleted here, and what they covered is worth recording:
 * "dragging a grip resizes the real window", "no control is buried under a
 * grip", and a minimize test that clicked the app's own button. All three
 * exercised chrome this app had to draw itself because a frameless TRANSPARENT
 * window receives no non-client hit-test on Windows — no resize border, no
 * title bar, so eight DOM handles and a three-button cluster stood in.
 *
 * With a real frame the OS provides all of it, and testing that Electron's
 * `frame: true` works would be testing Electron. What is worth pinning is that
 * the window is CONFIGURED to allow it: every one of these flags defaulted the
 * wrong way at some point in this file's history — `maximizable: false` and
 * `minimizable: false` both shipped — and a false here is silent, because
 * `maximize()` on a non-maximizable window simply does nothing.
 */
test('the window is a real, fully-capable OS window', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  await mainWindow(app)

  const caps = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html'))
    return {
      resizable: win.isResizable(),
      maximizable: win.isMaximizable(),
      minimizable: win.isMinimizable(),
      fullScreenable: win.isFullScreenable()
    }
  })

  for (const [name, value] of Object.entries(caps)) {
    assert.equal(value, true, `the window is not ${name}, so the title bar's control cannot work`)
  }
})

test('maximize really maximizes, and restores', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  await mainWindow(app)

  const result = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html'))
    const before = win.getSize()
    win.maximize()
    await new Promise((r) => setTimeout(r, 400))
    const maxed = win.getSize()
    const isMaximized = win.isMaximized()
    win.unmaximize()
    await new Promise((r) => setTimeout(r, 400))
    return {
      before,
      maxed,
      isMaximized,
      restored: win.getSize(),
      workArea: screen.getDisplayMatching(win.getBounds()).workArea
    }
  })

  console.log(
    `  maximize: ${result.before[0]}x${result.before[1]} -> ${result.maxed[0]}x${result.maxed[1]} ` +
      `(work area ${result.workArea.width}x${result.workArea.height})`
  )

  // The report this replaced: "the fullscreen is not actually fullscreening".
  // The old button sized the window to the work area LESS a margin and centred
  // it, which is a large window and not a maximized one — it did not snap, did
  // not restore, and `isMaximized()` was false the whole time.
  assert.equal(result.isMaximized, true, 'maximize did not put the window in the maximized state')
  assert.ok(
    result.maxed[0] >= result.workArea.width - 2,
    `maximized to ${result.maxed[0]}px wide in a ${result.workArea.width}px work area`
  )
  assert.deepEqual(result.restored, result.before, 'restore did not return the window to its old size')
})

test('the window can actually be minimized', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  // The window is created with `show: false` and shown on ready-to-show.
  // `minimize()` on a window that is not yet visible is a no-op on Windows, so
  // waiting for the load is not enough — wait for the window itself.
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html'))
    for (let i = 0; i < 40 && !win.isVisible(); i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
  })

  const isMin = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html'))
    win.minimize()
    // Polled rather than slept: the state change is asynchronous on Windows and
    // a fixed wait is either flaky or slow.
    for (let i = 0; i < 40 && !win.isMinimized(); i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
    const min = win.isMinimized()
    win.restore()
    return min
  })

  assert.equal(isMin, true, 'minimize did not minimize the window')
})
