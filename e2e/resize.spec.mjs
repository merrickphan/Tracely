import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

/**
 * The window scales instead of reflowing, and this is what proves it.
 *
 * Home is a Figma transcription: `.home-canvas` fills the window but its
 * `.home-el` children are `position: absolute` at literal design coordinates.
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
  const probe = '.home-el'
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

    ratios.push({ scale, width: m.probeWidth / m.innerWidth, left: m.probeLeft / m.innerWidth })

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

  // The assertion the whole file is for. A reflowing layout would leave this
  // element the same PIXEL size while the window grew, so its share would fall
  // — at 2.5x it would occupy 40% of the fraction it does at 1x.
  const base = ratios.find((r) => r.scale === 1)
  for (const r of ratios) {
    assert.ok(
      Math.abs(r.width - base.width) < 0.005,
      `at scale ${r.scale} the probe is ${(100 * r.width).toFixed(2)}% of the window, not ${(100 * base.width).toFixed(2)}% — the layout reflowed instead of scaling`
    )
    assert.ok(
      Math.abs(r.left - base.left) < 0.005,
      `at scale ${r.scale} the probe sits at ${(100 * r.left).toFixed(2)}%, not ${(100 * base.left).toFixed(2)}%`
    )
  }
})

test('the aspect ratio is locked, so the card can never be letterboxed', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  await mainWindow(app)

  // Asked of the real window rather than of the constant: setAspectRatio is a
  // main-process call that a later refactor can quietly drop, and the symptom
  // would be a card letterboxed inside a wrongly-shaped window — visible only
  // to someone dragging a corner.
  const ratio = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html'))
    const [minW, minH] = win.getMinimumSize()
    const [maxW, maxH] = win.getMaximumSize()
    return { minW, minH, maxW, maxH }
  })

  const expected = LAYOUT_WIDTH / LAYOUT_HEIGHT
  assert.ok(
    Math.abs(ratio.minW / ratio.minH - expected) < 0.01,
    `the minimum size ${ratio.minW}x${ratio.minH} is not the layout's shape`
  )
  // A floor low enough to be unreadable, or a ceiling below the default, would
  // both be worse than having no limits at all.
  assert.ok(ratio.minW >= 600 && ratio.minW < LAYOUT_WIDTH, `minimum width ${ratio.minW} is out of range`)
  assert.ok(ratio.maxW > LAYOUT_WIDTH, `maximum width ${ratio.maxW} is not above the default`)
})

test('dragging a grip resizes the real window', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(800)

  // The grips exist because the OS resize border does not reach a transparent
  // frameless window — `resizable: true` was set and no corner caught, on a
  // real build. So "is the window resizable" is not the question any more;
  // "does a pointer drag on this DOM element move the window" is.
  const grips = await page.locator('.resize-grip').count()
  assert.equal(grips, 8, `expected 8 resize grips, found ${grips}`)

  // Every grip must opt out of the drag region. One that does not moves the
  // window instead of resizing it, which is silent and exactly the failure
  // these replaced.
  const dragging = await page.evaluate(() =>
    [...document.querySelectorAll('.resize-grip')]
      .filter((el) => getComputedStyle(el).webkitAppRegion !== 'no-drag')
      .map((el) => el.dataset.handle)
  )
  assert.deepEqual(dragging, [], `these grips sit inside the drag region: ${dragging.join(', ')}`)

  const sizeOf = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('/index.html'))
      const [width, height] = w.getSize()
      const [x, y] = w.getPosition()
      return { width, height, x, y }
    })

  const before = await sizeOf()

  // A real pointer drag on the south-east grip, through the browser's own input
  // pipeline — not a synthetic event and not a setSize call, because what is
  // being tested is precisely whether the DOM handler is reached and whether
  // its screen-coordinate maths lands.
  const box = await page.locator('.resize-grip-se').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // In steps: one jump gives the handler a single pointermove, which would pass
  // even if the in-flight coalescing dropped everything after the first.
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 20, box.y + box.height / 2 + i * 14)
    await page.waitForTimeout(60)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)

  const after = await sizeOf()
  console.log(`  se drag: ${before.width}x${before.height} -> ${after.width}x${after.height}`)

  assert.ok(after.width > before.width + 40, `the window did not grow: ${before.width} -> ${after.width}`)
  // The aspect ratio must survive a drag that pulled both axes by different
  // amounts — 120px across, 84px down.
  const expected = LAYOUT_WIDTH / LAYOUT_HEIGHT
  assert.ok(
    Math.abs(after.width / after.height - expected) < 0.02,
    `aspect drifted to ${(after.width / after.height).toFixed(3)}, expected ${expected.toFixed(3)}`
  )
  // The anchor: dragging the SE corner holds the top-left still. If this moves,
  // the window crawls away from the cursor across a drag.
  assert.ok(
    Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2,
    `the top-left moved from ${before.x},${before.y} to ${after.x},${after.y} during an SE drag`
  )
})

test('no control is buried under a grip', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(800)

  // The grips are `position: fixed` at z-index 9999, so anything they overlap
  // becomes unclickable — silently, and only near the window edge. The CSS
  // claims the Figma frames' 28-32px internal padding keeps every control
  // clear; this is that claim being checked rather than repeated.
  //
  // Checked by hit-testing the control's own centre, not by intersecting
  // rectangles: a button whose corner slips under a grip is still perfectly
  // usable, and failing on that would make this test noise nobody trusts.
  async function buried(label) {
    return page.evaluate(() =>
      [...document.querySelectorAll('button, a, input, textarea, select, [role="button"]')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return false
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return hit?.classList.contains('resize-grip')
        })
        .map((el) => (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40))
    ).then((found) => ({ label, found }))
  }

  const views = []
  views.push(await buried('home'))

  await page.getByRole('button', { name: /Settings/i }).first().click()
  await page.waitForTimeout(600)
  views.push(await buried('settings'))

  // At the minimum scale the gutter is under 10 physical px and the grips
  // overlap the card most — if anything is ever covered, it is here.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('/index.html'))
    w.setSize(629, 444)
  })
  await page.waitForTimeout(500)
  views.push(await buried('settings @ 0.7'))

  for (const v of views) {
    console.log(`  ${v.label.padEnd(16)} ${v.found.length === 0 ? 'clear' : v.found.join(' | ')}`)
  }
  for (const v of views) {
    assert.deepEqual(v.found, [], `controls buried under a grip on ${v.label}: ${v.found.join(', ')}`)
  }
})
