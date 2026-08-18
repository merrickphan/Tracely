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
      allPositioned: els.every((e) => e.getBoundingClientRect().width > 0),
      messages: els.map((e) => e.getAttribute('title'))
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

  for (const message of drawn.messages) {
    assert.ok(message && message.length > 0, 'a mark carries no explanation')
  }
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
