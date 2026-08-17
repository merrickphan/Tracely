import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

/**
 * The one thing no other test in this repo can reach: a REAL Ctrl+Z.
 *
 * The editor writes citations and applied revisions through
 * `execCommand('insertText')` specifically so the browser's own undo stack owns
 * them — `documentMarks.ts` says so, the popover's copy promises it out loud
 * ("Undo — or Ctrl+Z — puts it back exactly as it was"), and every check of it
 * so far has pressed the card's Undo BUTTON instead. That button calls
 * `execCommand('undo')`, so it proves the stack has one entry; it does not
 * prove the keystroke reaches it.
 *
 * The gap is not pedantic. In Electron, Ctrl+Z in a contentEditable arrives via
 * the default application menu's `undo` role accelerator. An app that calls
 * `Menu.setApplicationMenu(null)`, installs a custom menu without an Edit
 * submenu, or swallows the key in a renderer keydown handler loses it while
 * every unit test and every synthetic-event check still passes. Synthetic
 * KeyboardEvents cannot cover this: they are untrusted and do not drive native
 * undo, which is why this needs a real browser driving a real window.
 *
 * Run with `npm run test:e2e`. Deliberately NOT part of `npm test`: it needs a
 * build in `out/` and takes seconds rather than milliseconds, and the fast
 * suite staying fast is what keeps it run.
 */

const REPO = resolve(import.meta.dirname, '..')

/** The sentence under test, and the narrowing the fix flow would apply. */
const ORIGINAL = 'Studies prove that later school start times always improve student outcomes.'
const REVISED = 'Studies indicate that later school start times generally improve student outcomes.'

/**
 * A throwaway `userData` per run.
 *
 * Two reasons, both load-bearing. It keeps the test off the real
 * `%APPDATA%\Tracely\tracely.db`, which holds the user's actual analyses — a
 * test that writes documents into it would be destroying data to check a
 * keystroke. And Electron keys `requestSingleInstanceLock` on this directory,
 * so an isolated one means this can run while the real app is open instead of
 * silently quitting into the running instance (`app.quit()` in main/index.ts).
 */
function launchIsolated() {
  const userData = mkdtempSync(join(tmpdir(), 'tracely-e2e-'))
  return {
    userData,
    // The REPO ROOT, not `out/main/index.js`. Electron then reads the `main`
    // field from package.json exactly as `npm start` and the packaged app do,
    // and `app.getAppPath()` is the repo rather than the bundle directory.
    // That matters more than it looks: `storage/paths.ts` derives `appRoot`
    // from it, and `db.ts` reads sql.js's wasm from `<appRoot>/node_modules`.
    // Pointing Electron straight at the bundle made appRoot `out/main`, so
    // initDb threw ENOENT on sql-wasm.wasm, no window was ever created, and
    // the failure surfaced only as "Timeout waiting for event window".
    app: electron.launch({
      args: [REPO, `--user-data-dir=${userData}`],
      cwd: REPO
    })
  }
}

/**
 * Quits the app, rather than asking it to.
 *
 * `electronApplication.close()` closes the windows and then waits for the
 * process to exit — which never happens here. `window-all-closed` deliberately
 * does NOT quit this app (main/index.ts keeps it alive in the tray so the
 * global hotkey still works with no window open), so close() sat until the
 * processes were killed by hand: the assertions had long since passed and the
 * run still took ten and a half minutes.
 *
 * `app.exit(0)` skips the quit handlers and ends the process. Losing the final
 * `persist()` in `before-quit` costs nothing — the only database it could write
 * is the throwaway one this run created.
 */
async function teardown(app, userData) {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {})
  await app.close().catch(() => {})
  rmSync(userData, { recursive: true, force: true })
}

/**
 * The MAIN window, chosen by which entry point it loaded.
 *
 * NOT `app.firstWindow()`. main/index.ts creates the main window and then the
 * hidden floating one, and Playwright hands back whichever it happens to see
 * first — measured at 6 index.html to 2 floating.html over eight launches. A
 * handle on the floating window fails in a way that reads like a broken app
 * rather than a broken selector: it has no PASSWORD field, so the auth-gate
 * assertion below passes, and then "New Session" times out after 30 seconds
 * because that window has never had one.
 *
 * Polled rather than awaited via the 'window' event, because a window can be
 * reported before it has navigated, and its url() is empty until it does.
 */
async function mainWindow(app, timeoutMs = 30_000) {
  const isMain = (w) => w.url().endsWith('/index.html')
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = app.windows().find(isMain)
    if (found) return found
    if (Date.now() > deadline) {
      throw new Error(`no index.html window after ${timeoutMs}ms; saw: ${app.windows().map((w) => w.url()).join(', ') || '(none)'}`)
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('a real Ctrl+Z reverts an applied revision in one press', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')

  // The auth gate is skipped only because `test:e2e` builds with the Supabase
  // constants blanked (see electron.vite.e2e.config.mts). Asserted rather than
  // assumed: running this against a normally-built `out/` lands on the login
  // screen, and the failure then arrives 30 seconds later as "waiting for
  // New Session" — which reads as a broken test rather than the wrong build.
  //
  // Matched on the PASSWORD field, not on a button label. The first version
  // looked for "Sign in" while the screen says "Login", so it sailed past the
  // gate it existed to catch.
  const gated = await page
    .locator('text=PASSWORD')
    .first()
    .isVisible()
    .catch(() => false)
  assert.equal(
    gated,
    false,
    'the auth gate is showing — run via `npm run test:e2e`, which builds with the credentials blanked'
  )

  await page.getByRole('button', { name: /New Session/i }).click()
  await page.getByRole('button', { name: /Create Document/i }).click()
  const body = page.locator('.docedit-body')
  await body.waitFor({ state: 'visible' })

  // Typed through the keyboard rather than injected, so the undo stack is built
  // the way a writer's would be.
  await body.click()
  await page.keyboard.type(ORIGINAL)
  await page.waitForTimeout(150)
  assert.ok((await body.innerText()).includes(ORIGINAL), 'the sentence was not typed into the editor')

  // Exactly what `replaceClaimText` does: select the claim's span and type over
  // it. Driven here rather than through the popover because reaching the
  // popover needs a critique with a suggestedRevision, i.e. a paid relay call —
  // and the button's wiring is already covered in the preview harness. What is
  // being tested here is the undo behaviour of the write itself.
  await page.evaluate(
    ({ original, revised }) => {
      const el = document.querySelector('.docedit-body')
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.data.indexOf(original)
        if (at === -1) continue
        const range = document.createRange()
        range.setStart(n, at)
        range.setEnd(n, at + original.length)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        el.focus()
        document.execCommand('insertText', false, revised)
        return
      }
      throw new Error('sentence not found in the editor')
    },
    { original: ORIGINAL, revised: REVISED }
  )
  await page.waitForTimeout(200)

  const applied = await body.innerText()
  assert.ok(applied.includes(REVISED), 'the revision was not applied')
  assert.ok(!applied.includes(ORIGINAL), 'the original sentence survived the replacement')

  // The assertion this whole file exists for.
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)

  const undone = await body.innerText()
  assert.ok(
    undone.includes(ORIGINAL),
    `one Ctrl+Z did not restore the sentence. Got: ${JSON.stringify(undone.slice(-160))}`
  )
  assert.ok(!undone.includes(REVISED), 'the revision was still present after one Ctrl+Z')
})

test('the Edit role that carries Ctrl+Z is actually installed', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  // Wait for the window before asking the main process anything. Without this
  // the evaluate below races the app's own startup, and Playwright reports the
  // loss as "Resulting promise was garbage collected" — which reads like a
  // broken assertion rather than a test that asked too early. It only started
  // failing when resize.spec.mjs made this the fifth Electron launch in a run.
  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')

  // Read in the MAIN process: the accelerator lives on the application menu,
  // which the renderer cannot see. This fails loudly the day someone calls
  // Menu.setApplicationMenu(null) to hide the default menu bar — a change that
  // looks purely cosmetic and silently takes undo, cut, copy and paste with it.
  const hasUndoRole = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    if (!menu) return false
    const roleOf = (item) => String(item.role ?? '').toLowerCase()
    const walk = (items) =>
      items.some((item) => roleOf(item) === 'undo' || (item.submenu ? walk(item.submenu.items) : false))
    return walk(menu.items)
  })

  assert.equal(hasUndoRole, true, 'no menu item with the undo role — Ctrl+Z will not reach the editor')
})
