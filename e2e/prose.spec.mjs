import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

/**
 * Grammar and wordiness marks, drawn in the real editor.
 *
 * `proseIssues.test.ts` proves the rules; this proves they reach the page. The
 * measurement between them is the part that fails silently — offsets are
 * resolved against a live text map, and a mark measured against stale nodes
 * either lands on the wrong words or produces a zero-width rect that renders as
 * nothing at all. Neither shows up in a unit test.
 *
 * No relay involved: `findProseIssues` is local and pure, so this runs in the
 * credential-blanked e2e build like the rest.
 */

const REPO = resolve(import.meta.dirname, '..')

// One sentence per rule, plus a correct sentence that must stay unmarked.
const TEXT =
  'They was late to the the meeting. This is a error, and due to the fact that funding ran out the report was written by the committee. The data were collected in 2019.'

function launchIsolated() {
  const userData = mkdtempSync(join(tmpdir(), 'tracely-e2e-'))
  return { userData, app: electron.launch({ args: [REPO, `--user-data-dir=${userData}`], cwd: REPO }) }
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

test('grammar and wordiness are underlined in the editor', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: /^Documents$/i }).click()
  await page.getByRole('button', { name: /New document/i }).click()
  const body = page.locator('.docedit-body')
  await body.waitFor({ state: 'visible' })
  await body.click()
  await page.keyboard.insertText(TEXT)
  await page.locator('.docprose').first().waitFor({ state: 'visible', timeout: 10_000 })

  const drawn = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.docprose')]
    return {
      kinds: els.map((e) => e.dataset.proseKind),
      severities: els.map((e) => (e.className.includes('docprose-error') ? 'error' : 'style')),
      // A zero-width rect renders as nothing — the failure mode a unit test
      // cannot see.
      allPositioned: els.every((e) => e.getBoundingClientRect().width > 0)
    }
  })

  console.log(`  ${drawn.kinds.length} marks: ${drawn.kinds.join(', ')}`)

  for (const kind of ['subject-verb', 'repeated-word', 'article-agreement', 'wordiness', 'passive-voice']) {
    assert.ok(drawn.kinds.includes(kind), `no mark drawn for ${kind}`)
  }
  assert.ok(drawn.allPositioned, 'a mark measured to a zero-width rect')

  // The severity split is the whole reason the two treatments exist: a
  // mechanical error and a style suggestion must not be drawn the same weight.
  const severityOf = (kind) => drawn.severities[drawn.kinds.indexOf(kind)]
  assert.equal(severityOf('subject-verb'), 'error')
  assert.equal(severityOf('article-agreement'), 'error')
  assert.equal(severityOf('wordiness'), 'style')
  assert.equal(severityOf('passive-voice'), 'style')

  // The agentless passive in the last sentence must NOT be marked. "The data
  // were collected in 2019" is correct writing, and flagging it is what makes
  // people turn grammar tools off.
  assert.equal(
    drawn.kinds.filter((k) => k === 'passive-voice').length,
    1,
    'the agentless passive was flagged too'
  )

  // The explanation used to be a native `title` on the mark, which is what
  // forced `pointer-events: auto` and made the flagged words unclickable. It is
  // a hover card now, so it is asserted where it now lives — on the card, in
  // the two tests below.
})

/**
 * The bug this layer shipped with: `.docprose` carried `pointer-events: auto`
 * so a native `title` tooltip would fire, which made every flagged word a place
 * the caret could not be placed. Same class of bug as the Screen Watch overlay
 * capturing the whole screen, in miniature and in our own editor.
 *
 * Asserted by clicking the flagged word and reading back where the caret went.
 * A CSS assertion would pass on `pointer-events: none` while some other element
 * in the layer still swallowed the click.
 */
test('a flagged word can still be clicked into', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: /^Documents$/i }).click()
  await page.getByRole('button', { name: /New document/i }).click()
  const body = page.locator('.docedit-body')
  await body.waitFor({ state: 'visible' })
  await body.click()
  await page.keyboard.insertText('This is a error in the report.')
  const mark = page.locator('.docprose[data-prose-kind="article-agreement"]').first()
  await mark.waitFor({ state: 'visible', timeout: 10_000 })

  // Click the middle of the underlined word itself.
  const box = await mark.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  const caret = await page.evaluate(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const editor = document.querySelector('.docedit-body')
    return {
      inEditor: editor.contains(sel.anchorNode),
      offset: sel.anchorOffset
    }
  })

  assert.ok(caret, 'clicking a flagged word placed no caret at all')
  assert.ok(caret.inEditor, 'the click did not reach the contentEditable')

  // And typing there actually lands, which is the thing the writer was trying
  // to do when they clicked.
  await page.keyboard.type('X')
  const text = await body.innerText()
  assert.ok(text.includes('X'), `typing after the click did not reach the document: ${text}`)
})

/** The card that replaced the tooltip, and the button a tooltip could not hold. */
test('the prose card applies a fix, and Ctrl+Z takes it back', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: /^Documents$/i }).click()
  await page.getByRole('button', { name: /New document/i }).click()
  const body = page.locator('.docedit-body')
  await body.waitFor({ state: 'visible' })
  await body.click()
  await page.keyboard.insertText('This is a error in the report.')
  const mark = page.locator('.docprose[data-prose-kind="article-agreement"]').first()
  await mark.waitFor({ state: 'visible', timeout: 10_000 })

  const box = await mark.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

  const card = page.locator('.docprose-card')
  await card.waitFor({ state: 'visible', timeout: 5000 })

  // The band is up while the pointer is on the mark — the Screen Watch
  // treatment, which this layer did not have.
  assert.equal(await mark.getAttribute('data-hovered'), 'true', 'the mark did not register as hovered')

  const apply = page.getByRole('button', { name: /Change to/ })
  await apply.click()

  const after = await body.innerText()
  assert.ok(after.includes('an error'), `fix did not apply: ${after}`)
  assert.ok(!after.includes('a error'), `the old text is still there: ${after}`)

  // Through execCommand, so it is on the browser's undo stack like every other
  // edit this editor makes.
  await body.click()
  await page.keyboard.press('Control+z')
  const undone = await body.innerText()
  assert.ok(undone.includes('a error'), `Ctrl+Z did not restore the original: ${undone}`)
})

/**
 * Moving the pointer from the underline to the card must not close the card.
 *
 * The card is drawn a gap away from the text, so crossing that gap puts the
 * pointer over neither — and the card used to close on the first such frame,
 * which made it unreachable: it vanished exactly as you moved toward it.
 *
 * The existing "applies a fix" test above did NOT catch this, and the reason is
 * worth keeping: `locator.click()` jumps the pointer straight to the target and
 * fires no intermediate mousemove, so it never crosses the gap. `mouse.move`
 * with `steps` is what reproduces a human hand.
 */
test('the card survives the pointer travelling from the mark to it', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: /^Documents$/i }).click()
  await page.getByRole('button', { name: /New document/i }).click()
  const body = page.locator('.docedit-body')
  await body.waitFor({ state: 'visible' })
  await body.click()
  await page.keyboard.insertText('This is a error in the report.')

  const mark = page.locator('.docprose[data-prose-kind="article-agreement"]').first()
  await mark.waitFor({ state: 'visible', timeout: 10_000 })
  const markBox = await mark.boundingBox()
  await page.mouse.move(markBox.x + markBox.width / 2, markBox.y + markBox.height / 2)

  const card = page.locator('.docprose-card')
  await card.waitFor({ state: 'visible', timeout: 5000 })
  const cardBox = await card.boundingBox()

  // Travel like a hand: many small steps, through the dead zone between the
  // two. Every one of these fires a mousemove over neither element.
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2, { steps: 20 })

  assert.ok(await card.isVisible(), 'the card closed while the pointer was moving toward it')

  // And it is still usable once reached — the point of getting there.
  await page.getByRole('button', { name: /Change to/ }).click()
  const after = await body.innerText()
  assert.ok(after.includes('an error'), `fix did not apply after travelling to the card: ${after}`)
})

/** The other half: it must still close when the pointer genuinely goes away. */
test('the card still closes when the pointer leaves for good', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: /^Documents$/i }).click()
  await page.getByRole('button', { name: /New document/i }).click()
  const body = page.locator('.docedit-body')
  await body.waitFor({ state: 'visible' })
  await body.click()
  await page.keyboard.insertText('This is a error in the report.\n\nA second paragraph well away from it.')

  const mark = page.locator('.docprose[data-prose-kind="article-agreement"]').first()
  await mark.waitFor({ state: 'visible', timeout: 10_000 })
  const markBox = await mark.boundingBox()
  await page.mouse.move(markBox.x + markBox.width / 2, markBox.y + markBox.height / 2)
  await page.locator('.docprose-card').waitFor({ state: 'visible', timeout: 5000 })

  // Somewhere with no mark and no card. A lingering card covers the very text
  // the writer moved on to read, which is its own bug.
  const bodyBox = await body.boundingBox()
  await page.mouse.move(bodyBox.x + bodyBox.width - 12, bodyBox.y + bodyBox.height - 12, { steps: 20 })

  await page
    .locator('.docprose-card')
    .waitFor({ state: 'hidden', timeout: 3000 })
    .catch(() => {
      throw new Error('the card outstayed the pointer')
    })
})

test('the prose layer sits under the claim layer', async (t) => {
  const { userData, app: launching } = launchIsolated()
  const app = await launching
  t.after(async () => {
    await teardown(app, userData)
  })

  const page = await mainWindow(app)
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: /^Documents$/i }).click()
  await page.getByRole('button', { name: /New document/i }).click()
  await page.locator('.docedit-body').waitFor({ state: 'visible' })
  await page.locator('.docedit-body').click()
  await page.keyboard.insertText('They was late.')
  await page.locator('.docprose').first().waitFor({ state: 'visible' })

  // A sentence that is both unverified and clumsy must read as unverified
  // first — the credibility colours are the ones carrying the app's actual
  // judgement.
  const z = await page.evaluate(() => {
    const prose = document.querySelector('.docprose-layer')
    const claim = document.querySelector('.docmark-layer:not(.docprose-layer)')
    return {
      prose: Number(getComputedStyle(prose).zIndex),
      claim: claim ? Number(getComputedStyle(claim).zIndex) : null
    }
  })
  assert.ok(z.claim === null || z.prose < z.claim, `prose z-index ${z.prose} is not below claim ${z.claim}`)
})
