import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

/**
 * Deleting a document from its card menu, driven by a REAL mouse.
 *
 * This is in e2e rather than the preview harness because the harness could not
 * catch the bug it exists for, twice over. The dismiss listener that closes the
 * menu is on `window` in the CAPTURE phase, so it runs before the menu item's
 * own handler: a real mousedown closed the menu, the popup unmounted, and the
 * click landed on nothing. Delete silently did nothing.
 *
 * The harness check passed anyway, because it called `element.click()` from
 * inside `page.evaluate()` — which dispatches a click event and NO mousedown.
 * It exercised a sequence no user can produce. Playwright's `locator.click()`
 * sends the real mousedown/mouseup/click, which is the only reason this test
 * means anything.
 *
 * Documents need no relay — they are SQLite — so this runs fine in the
 * credential-blanked e2e build.
 */

const REPO = resolve(import.meta.dirname, '..')

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

/**
 * Creates a document by name and returns to the grid, waiting for the CARD to
 * exist rather than for a fixed delay.
 *
 * The grid fetches its list when the view mounts, so coming back from the
 * editor is a remount and a fresh round trip through SQLite. A sleep long
 * enough on one machine is a flake on another; waiting for the card is the
 * condition the next step actually depends on.
 */
async function createDocument(page, title) {
  await page.getByRole('button', { name: /New document/i }).click()
  const body = page.locator('.docedit-body')
  await body.waitFor({ state: 'visible' })
  await page.locator('.docedit-name').fill(title)
  await body.click()
  await page.keyboard.insertText(`Body text for ${title}.`)
  // Autosave is debounced; the card cannot carry a title that was not saved.
  await page.waitForTimeout(900)
  await page.locator('.docedit-back').click()
  await page.locator('.docs-card', { hasText: title }).waitFor({ state: 'visible', timeout: 15_000 })
}

test('a document can be deleted from its card menu', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')

  await page.getByRole('button', { name: /^Documents$/i }).click()
  await page.locator('.docs-grid').waitFor({ state: 'visible' })

  await createDocument(page, 'Keep me')
  await createDocument(page, 'Delete me')

  const titles = () => page.locator('.docs-card-title').allTextContents()
  /** Waits for the grid to settle on an exact set, then returns it. */
  async function titlesEventually(expected, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const got = (await titles()).slice().sort()
      if (JSON.stringify(got) === JSON.stringify(expected.slice().sort())) return got
      if (Date.now() > deadline) {
        assert.deepEqual(got, expected.slice().sort(), 'the grid never settled on the expected set')
      }
      await page.waitForTimeout(200)
    }
  }

  await titlesEventually(['Delete me', 'Keep me'])

  // Real input throughout. The menu only appears on hover, so hover first —
  // which is itself part of what a user does and what a synthetic click skips.
  const target = page.locator('.docs-card', { hasText: 'Delete me' })
  await target.hover()
  await target.locator('.docs-card-menu').click()
  await page.locator('.docs-card-menu-popup').waitFor({ state: 'visible' })

  await page.locator('.docs-card-menu-delete').click()
  await page.waitForTimeout(700)

  await titlesEventually(['Keep me'])
  // The click must not also open the document underneath the menu.
  assert.equal(await page.locator('.docedit-body').count(), 0, 'deleting opened the editor')

  // And it must be gone from STORAGE, not just from the list — the removal is
  // optimistic, so a failed IPC would leave the grid looking right and the
  // document still there on the next open.
  await page.getByRole('button', { name: /Back/i }).first().click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /^Documents$/i }).click()
  await page.locator('.docs-grid').waitFor({ state: 'visible' })
  await titlesEventually(['Keep me'])
})

test('clicking elsewhere closes the card menu without deleting', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: /^Documents$/i }).click()
  await page.locator('.docs-grid').waitFor({ state: 'visible' })
  await createDocument(page, 'Still here')

  const card = page.locator('.docs-card').first()
  await card.hover()
  await card.locator('.docs-card-menu').click()
  await page.locator('.docs-card-menu-popup').waitFor({ state: 'visible' })

  // The other half of the capture-phase listener: dismissing must still work,
  // and must not open the document it was dismissed over.
  await page.locator('.docs-title').click()
  await page.locator('.docs-card-menu-popup').waitFor({ state: 'detached', timeout: 5000 })
  assert.deepEqual(await page.locator('.docs-card-title').allTextContents(), ['Still here'])
})
