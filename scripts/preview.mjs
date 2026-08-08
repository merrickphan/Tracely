#!/usr/bin/env node
// Builds eval/preview.html — a standalone replica of Tracely's document
// view, populated with the newest evaluation run's real claims and sources.
//
// Why this exists: reading a pipeline change out of a Markdown dump is
// miserable, and the alternative (boot the whole Electron app, paste an
// essay, wait through four provider searches and a relay call per claim) is
// slow enough that you stop checking. This renders the same output in the
// app's own UI as a single file you can open, keep, or send to someone.
//
// It is a REPLICA, not the app: no relay, no database, no Electron, and
// nothing here is imported by the app. Styling is copied from the app's
// stylesheet rather than shared, so drift is possible — if the real UI
// changes, this needs the same change by hand. That tradeoff is deliberate:
// a preview that can't break the shipping app is worth more than one that
// stays automatically in sync.
//
//   npm run preview            # newest report in eval/reports
//   npm run preview -- <path>  # a specific report .json

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fontDir = join(repoRoot, 'node_modules', '@fontsource', 'instrument-sans', 'files')
const reportsDir = join(repoRoot, 'eval', 'reports')
const outPath = join(repoRoot, 'eval', 'preview.html')

const explicit = process.argv[2]
let reportPath
if (explicit) {
  reportPath = resolve(explicit)
} else {
  if (!existsSync(reportsDir)) {
    console.error('No eval/reports yet — run `npm run evaluate` first.')
    process.exit(1)
  }
  const newest = readdirSync(reportsDir).filter((f) => f.endsWith('.json')).sort().pop()
  if (!newest) {
    console.error('No report .json in eval/reports — run `npm run evaluate` first.')
    process.exit(1)
  }
  reportPath = join(reportsDir, newest)
}

const essays = JSON.parse(readFileSync(reportPath, 'utf-8'))

// The app renders in Instrument Sans. Inlining it as a data URI rather than
// linking a CDN keeps the file self-contained (and artifact CSP blocks
// external font hosts outright) — without this the replica silently falls
// back to a system sans and stops looking like the app at all.
function fontFaces() {
  return [400, 600, 700]
    .map((weight) => {
      const file = join(fontDir, `instrument-sans-latin-${weight}-normal.woff2`)
      if (!existsSync(file)) return ''
      const b64 = readFileSync(file).toString('base64')
      return `@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`
    })
    .join('\n')
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const CLAIM_TYPE_LABEL = {
  statistic: 'Statistic',
  causal: 'Causal claim',
  factual: 'Factual claim',
  prediction: 'Prediction',
  opinion: 'Opinion'
}

const VERDICT_LABEL = {
  'well-supported': 'Well Supported',
  'partially-supported': 'Partially Supported',
  weak: 'Weak',
  unsupported: 'Unsupported',
  contradicted: 'Contradicted — False'
}

const VERDICT_CLASS = {
  'well-supported': 'evidence-verdict-good',
  'partially-supported': 'evidence-verdict-mid',
  weak: 'evidence-verdict-mid',
  unsupported: 'evidence-verdict-low',
  contradicted: 'evidence-verdict-danger'
}

const BREAKDOWN = [
  ['sourceCount', 'Sources'],
  ['quality', 'Quality'],
  ['recency', 'Recency'],
  ['relevance', 'Relevance']
]

const ESSAY_TITLES = {
  '01-school-start-times.txt': 'School start times',
  '02-remote-work.txt': 'Remote work',
  '03-printing-press.txt': 'The printing press'
}

function essayText(file) {
  const path = join(repoRoot, 'eval', 'essays', file)
  return existsSync(path) ? readFileSync(path, 'utf-8').trim() : ''
}

// The document body highlights each detected claim in place. The real app
// only lists claims underneath the editor, but seeing WHICH sentence was
// flagged, inside the paragraph it came from, is the fastest way to judge
// detection quality -- so the preview shows it and marks it as an addition.
function renderBody(file, claims) {
  const text = essayText(file)
  if (!text) return '<p class="muted">essay file missing</p>'

  const spans = []
  for (const [i, claim] of claims.entries()) {
    const at = text.indexOf(claim.text)
    if (at !== -1) spans.push({ start: at, end: at + claim.text.length, index: i })
  }
  spans.sort((a, b) => a.start - b.start)

  let html = ''
  let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    html += esc(text.slice(cursor, span.start))
    html += `<mark class="claim-mark" data-claim="${span.index}" tabindex="0" role="button">${esc(
      text.slice(span.start, span.end)
    )}</mark>`
    cursor = span.end
  }
  html += esc(text.slice(cursor))

  return html
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.replace(/\n/g, ' ')}</p>`)
    .join('')
}

function renderSource(source) {
  const authors = source.authors?.length
    ? source.authors.slice(0, 3).join(', ') + (source.authors.length > 3 ? ' et al.' : '')
    : 'Unknown author'
  const meta = [authors, source.year, source.venue, source.venueType].filter(Boolean).join(' · ')
  const title = source.url
    ? `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)}</a>`
    : esc(source.title)

  // Coverage is diagnostic, not app UI -- it is what the retrieval fix will
  // move, so it is here behind the Diagnostics toggle rather than shown to
  // a user who only wants sources.
  const cov = source.textRelevance
  const covClass = cov >= 0.3 ? 'cov-good' : cov >= 0.15 ? 'cov-mid' : 'cov-low'

  return `<div class="evidence-card">
      <div class="evidence-title">${title}</div>
      <div class="evidence-meta">${esc(meta)}</div>
      ${source.abstract ? `<p class="evidence-abstract">${esc(source.abstract.slice(0, 280))}…</p>` : ''}
      <div class="evidence-actions">
        <button class="btn-ghost" type="button">Cite</button>
        <button class="btn-ghost" type="button">Save to Library</button>
        <span class="diag cov ${covClass}">coverage ${cov.toFixed(3)}</span>
        <span class="diag provider">${esc(source.provider)}</span>
      </div>
    </div>`
}

function renderClaim(claim, index) {
  const verdictClass = VERDICT_CLASS[claim.verdict] ?? ''
  const breakdown = BREAKDOWN.map(([key, label]) => {
    const pct = Math.round((claim.breakdown?.[key] ?? 0) * 100)
    return `<div class="evidence-score-stat">
        <div class="evidence-score-stat-label"><span>${label}</span><span>${pct}%</span></div>
        <div class="evidence-score-stat-track"><div class="evidence-score-stat-fill" style="width:${pct}%"></div></div>
      </div>`
  }).join('')

  return `<div class="claim-card" id="claim-${index}">
      <div class="claim-header">
        <span class="claim-type">${esc(CLAIM_TYPE_LABEL[claim.claimType] ?? claim.claimType)}</span>
        <span class="claim-confidence">Detected as claim: ${Math.round(claim.confidence * 100)}%</span>
      </div>
      <p class="claim-text">&ldquo;${esc(claim.text)}&rdquo;</p>
      <div class="claim-actions">
        <button class="btn-primary" type="button">Refresh Evidence</button>
        <button class="btn-secondary" type="button">Re-check Argument</button>
        <span class="diag query">query: ${esc(claim.searchQuery)}</span>
      </div>
      <div class="evidence-score-card ${verdictClass}">
        <div class="evidence-score-header">
          <span class="evidence-score-verdict">${esc(VERDICT_LABEL[claim.verdict] ?? '—')}</span>
          <span class="evidence-score-number">${claim.strengthScore}<span class="evidence-score-number-max">/100</span></span>
        </div>
        <div class="evidence-score-breakdown">${breakdown}</div>
        ${
          claim.critique
            ? `<div class="evidence-score-critique">
                <div class="evidence-score-critique-label">Critique</div>
                <p>${esc(claim.critique)}</p>
              </div>`
            : ''
        }
      </div>
      <div class="evidence-list">${claim.sources.map(renderSource).join('')}</div>
    </div>`
}

function renderEssay(essay, index) {
  const words = essayText(essay.file).split(/\s+/).filter(Boolean).length
  return `<section class="doc" data-doc="${index}" ${index === 0 ? '' : 'hidden'}>
    <div class="docedit-view">
      <div class="docedit-toolbar">
        <button class="docedit-back" type="button">&larr; Back</button>
        <div class="docedit-divider"></div>
        <span class="docedit-name">${esc(ESSAY_TITLES[essay.file] ?? essay.file)}</span>
        <div class="docedit-divider"></div>
        <span class="docedit-fontname">Instrument Sans</span>
        <span class="docedit-fontsize">15</span>
        <div class="docedit-spacer"></div>
        <button class="docedit-insights" type="button">Insights</button>
      </div>

      <div class="docedit-body-wrap">
        <div class="docedit-body">${renderBody(essay.file, essay.claims)}</div>
        <div class="docedit-wordcount"><b>${words}</b> words</div>
      </div>

      <section class="docedit-results">
        ${essay.claims.map(renderClaim).join('')}
      </section>
    </div>
  </section>`
}

const totalSources = essays.reduce((n, e) => n + e.claims.reduce((m, c) => m + c.sources.length, 0), 0)
const totalClaims = essays.reduce((n, e) => n + e.claims.length, 0)

const html = `<title>Tracely — preview build</title>
<style>
${fontFaces()}

:root{
  color-scheme: light dark;
  --font: 'Instrument Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  --bg:#f0f0f1; --surface:#fff; --surface-2:rgba(0,0,0,.02);
  --border:rgba(0,0,0,.18); --text:#000; --muted:rgba(0,0,0,.6); --label:rgba(0,0,0,.56);
  --accent:#f47b20; --accent-2:#f9a050; --accent-gradient:linear-gradient(164deg,#f47b20 0%,#f9a050 100%);
  --danger:#fb2c36;
  --score-good:#1f9d63; --score-good-wash:rgba(31,157,99,.13);
  --score-mid:#b3690a;  --score-mid-wash:rgba(240,150,30,.15);
  --score-low:#d6301a;  --score-low-wash:rgba(214,48,26,.12);
  --shadow-sm:0 1px 3px rgba(15,15,16,.06);
  --doc-ink:#1a1a1a; --doc-edge:#000; --doc-shadow:rgba(0,0,0,.25);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme='light']){
    --bg:#0b0b0d; --surface:#17171b; --surface-2:rgba(255,255,255,.04);
    --border:rgba(255,255,255,.18); --text:#f6f6f8; --muted:rgba(246,246,248,.66); --label:rgba(246,246,248,.62);
    --danger:#ff5c4d;
    --score-good:#34d399; --score-good-wash:rgba(52,211,153,.16);
    --score-mid:#ffab3d;  --score-mid-wash:rgba(255,171,61,.18);
    --score-low:#ff5a36;  --score-low-wash:rgba(255,90,54,.18);
    --shadow-sm:0 1px 3px rgba(0,0,0,.4);
    --doc-ink:#e8e8ea; --doc-edge:rgba(255,255,255,.22); --doc-shadow:rgba(0,0,0,.6);
  }
}
:root[data-theme='dark']{
  --bg:#0b0b0d; --surface:#17171b; --surface-2:rgba(255,255,255,.04);
  --border:rgba(255,255,255,.18); --text:#f6f6f8; --muted:rgba(246,246,248,.66); --label:rgba(246,246,248,.62);
  --danger:#ff5c4d;
  --score-good:#34d399; --score-good-wash:rgba(52,211,153,.16);
  --score-mid:#ffab3d;  --score-mid-wash:rgba(255,171,61,.18);
  --score-low:#ff5a36;  --score-low-wash:rgba(255,90,54,.18);
  --shadow-sm:0 1px 3px rgba(0,0,0,.4);
  --doc-ink:#e8e8ea; --doc-edge:rgba(255,255,255,.22); --doc-shadow:rgba(0,0,0,.6);
}
:root[data-theme='light']{
  --bg:#f0f0f1; --surface:#fff; --surface-2:rgba(0,0,0,.02);
  --border:rgba(0,0,0,.18); --text:#000; --muted:rgba(0,0,0,.6); --label:rgba(0,0,0,.56);
  --danger:#fb2c36;
  --score-good:#1f9d63; --score-good-wash:rgba(31,157,99,.13);
  --score-mid:#b3690a;  --score-mid-wash:rgba(240,150,30,.15);
  --score-low:#d6301a;  --score-low-wash:rgba(214,48,26,.12);
  --doc-ink:#1a1a1a; --doc-edge:#000; --doc-shadow:rgba(0,0,0,.25);
}

body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
a{color:inherit}

/* ---- preview-only chrome (not part of the app) ---- */
.preview-bar{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:14px 20px;border-bottom:1px solid var(--border);background:var(--surface);
}
.preview-tag{
  font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:3px 9px;
}
.preview-note{font-size:12px;color:var(--muted)}
.preview-bar .spacer{flex:1}
.preview-bar button{
  font:inherit;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;cursor:pointer;
  border:1px solid var(--border);background:var(--surface);color:var(--text);
}
.preview-bar button[aria-pressed='true'],.preview-bar button.on{
  background:var(--accent);border-color:var(--accent);color:#fff;
}
.preview-bar button:focus-visible,.claim-mark:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.stage{display:flex;justify-content:center;padding:40px 20px 64px}

/* ---- app replica ---- */
.docedit-view{
  position:relative;width:868px;max-width:100%;height:606px;
  background:var(--surface);border:1px solid var(--doc-edge);border-radius:28px;
  box-shadow:-13px 13px 4px var(--doc-shadow);
  overflow:hidden;display:flex;flex-direction:column;
}
.docedit-toolbar{
  height:42px;flex-shrink:0;display:flex;align-items:center;gap:8px;padding:0 16px;
  border-bottom:1px solid var(--border);font-size:12px;color:var(--muted);
}
.docedit-divider{width:1px;height:18px;background:var(--border)}
.docedit-back{border:none;background:transparent;font:inherit;font-size:12px;color:var(--muted);cursor:pointer;padding:4px}
.docedit-name{font-weight:600;color:var(--text)}
.docedit-spacer{flex:1}
.docedit-insights{
  border:1px solid var(--accent);background:var(--accent);color:#fff;font:inherit;font-size:11px;font-weight:700;
  border-radius:999px;padding:4px 12px;cursor:pointer;
}
.docedit-body-wrap{position:relative;flex:1;overflow-y:auto}
.docedit-body{padding:24px 43px 60px;font-size:15px;line-height:1.6;color:var(--doc-ink)}
.docedit-body p{margin:0 0 14px}
.docedit-wordcount{
  position:absolute;left:23px;bottom:16px;background:var(--surface);
  border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:13px;color:var(--muted);
}
.docedit-wordcount b{color:var(--text);font-weight:600}

.claim-mark{
  background:rgba(244,123,32,.16);border-bottom:2px solid var(--accent);
  color:inherit;padding:1px 0;cursor:pointer;border-radius:2px;
}
.claim-mark:hover{background:rgba(244,123,32,.3)}
.claim-mark.active{background:rgba(244,123,32,.42)}

.docedit-results{
  position:relative;z-index:1;background:var(--surface);border-top:1px solid var(--border);
  max-height:220px;overflow-y:auto;padding:16px 24px;
  display:flex;flex-direction:column;gap:14px;
}
.docedit-results.expanded{max-height:none}

.claim-card{border:1px solid var(--border);border-radius:14px;padding:16px 18px;background:var(--surface);box-shadow:var(--shadow-sm);scroll-margin-top:12px}
.claim-card.flash{animation:flash 1.1s ease}
@keyframes flash{0%,100%{box-shadow:var(--shadow-sm)}30%{box-shadow:0 0 0 3px rgba(244,123,32,.45)}}
@media (prefers-reduced-motion: reduce){.claim-card.flash{animation:none;border-color:var(--accent)}}

.claim-header{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--muted);flex-wrap:wrap}
.claim-type{padding:2px 10px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);text-transform:uppercase;letter-spacing:.03em;font-weight:600}
.claim-text{font-size:15px;font-weight:600;line-height:1.45;margin:10px 0 12px}
.claim-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}

.btn-primary,.btn-secondary,.btn-ghost{font:inherit;font-size:12px;font-weight:600;border-radius:999px;padding:6px 14px;cursor:pointer}
.btn-primary{background:var(--accent-gradient);border:1px solid var(--accent);color:#fff}
.btn-secondary{background:var(--surface);border:1px solid var(--border);color:var(--text)}
.btn-ghost{background:transparent;border:1px solid transparent;color:var(--muted);padding:4px 8px}
.btn-ghost:hover{color:var(--text);border-color:var(--border)}

.evidence-score-card{margin-top:14px;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--surface)}
.evidence-score-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--score-mid-wash);border-bottom:1px solid var(--border)}
.evidence-verdict-good .evidence-score-header{background:var(--score-good-wash)}
.evidence-verdict-low .evidence-score-header,.evidence-verdict-danger .evidence-score-header{background:var(--score-low-wash)}
.evidence-score-verdict{font-size:13px;font-weight:700;color:var(--score-mid)}
.evidence-verdict-good .evidence-score-verdict{color:var(--score-good)}
.evidence-verdict-low .evidence-score-verdict{color:var(--score-low)}
.evidence-verdict-danger .evidence-score-verdict{color:var(--danger)}
.evidence-score-number{font-size:18px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums}
.evidence-score-number-max{font-size:12px;font-weight:500;color:var(--muted)}
.evidence-score-breakdown{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;padding:14px 16px;border-bottom:1px solid var(--border)}
.evidence-score-stat{display:flex;flex-direction:column;gap:4px}
.evidence-score-stat-label{display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--label)}
.evidence-score-stat-label span:last-child{color:var(--text);font-variant-numeric:tabular-nums}
.evidence-score-stat-track{height:5px;border-radius:999px;background:var(--surface-2);overflow:hidden;border:1px solid var(--border)}
.evidence-score-stat-fill{height:100%;border-radius:999px;background:var(--accent-gradient)}
.evidence-score-critique{padding:14px 16px}
.evidence-score-critique-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--label);margin-bottom:6px}
.evidence-score-critique p{margin:0;font-size:13px;line-height:1.55}

.evidence-list{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.evidence-card{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--surface-2)}
.evidence-title{font-weight:600;font-size:14px;line-height:1.35}
.evidence-meta{font-size:12px;color:var(--muted);margin-top:2px}
.evidence-abstract{font-size:13px;margin:8px 0;line-height:1.5;color:var(--muted)}
.evidence-actions{display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap}

/* diagnostics: preview-only, off by default */
.diag{display:none;font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:999px;border:1px solid var(--border);color:var(--muted);font-variant-numeric:tabular-nums}
body.diagnostics .diag{display:inline-block}
.cov-good{color:var(--score-good);border-color:var(--score-good)}
.cov-mid{color:var(--score-mid);border-color:var(--score-mid)}
.cov-low{color:var(--score-low);border-color:var(--score-low)}
.query{font-weight:500;letter-spacing:0}

@media (max-width:900px){
  .docedit-view{height:auto;min-height:606px}
  .docedit-results{max-height:none}
  .evidence-score-breakdown{grid-template-columns:1fr}
}
</style>

<div class="preview-bar">
  <span class="preview-tag">Preview build</span>
  <span class="preview-note">${totalClaims} claims · ${totalSources} sources · not connected to the relay</span>
  <div class="spacer"></div>
  ${essays
    .map(
      (e, i) =>
        `<button type="button" class="doc-tab${i === 0 ? ' on' : ''}" data-target="${i}">${esc(
          ESSAY_TITLES[e.file] ?? e.file
        )}</button>`
    )
    .join('')}
  <button type="button" id="diag" aria-pressed="false">Diagnostics</button>
  <button type="button" id="expand" aria-pressed="false">Expand panel</button>
  <button type="button" id="theme">Theme</button>
</div>

<div class="stage">
  ${essays.map(renderEssay).join('')}
</div>

<script>
const docs = [...document.querySelectorAll('.doc')]
const tabs = [...document.querySelectorAll('.doc-tab')]
tabs.forEach((tab) => tab.addEventListener('click', () => {
  const target = Number(tab.dataset.target)
  docs.forEach((d, i) => { d.hidden = i !== target })
  tabs.forEach((t) => t.classList.toggle('on', t === tab))
}))

// Clicking a highlighted sentence scrolls its card into view -- the fastest
// way to check whether the right sentence was flagged and what it retrieved.
document.addEventListener('click', (event) => {
  const mark = event.target.closest('.claim-mark')
  if (!mark) return
  const doc = mark.closest('.doc')
  const card = doc.querySelector('#claim-' + mark.dataset.claim)
  if (!card) return
  doc.querySelectorAll('.claim-mark').forEach((m) => m.classList.toggle('active', m === mark))
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  card.classList.remove('flash')
  void card.offsetWidth
  card.classList.add('flash')
})
document.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.classList?.contains('claim-mark')) {
    event.preventDefault()
    event.target.click()
  }
})

const diag = document.getElementById('diag')
diag.addEventListener('click', () => {
  const on = document.body.classList.toggle('diagnostics')
  diag.setAttribute('aria-pressed', String(on))
  diag.classList.toggle('on', on)
})

const expand = document.getElementById('expand')
expand.addEventListener('click', () => {
  const on = !document.querySelector('.docedit-results').classList.contains('expanded')
  document.querySelectorAll('.docedit-results').forEach((r) => r.classList.toggle('expanded', on))
  expand.setAttribute('aria-pressed', String(on))
  expand.classList.toggle('on', on)
})

document.getElementById('theme').addEventListener('click', () => {
  const root = document.documentElement
  const dark = root.getAttribute('data-theme') === 'dark' ||
    (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
  root.setAttribute('data-theme', dark ? 'light' : 'dark')
})
</script>
`

writeFileSync(outPath, html, 'utf-8')
console.log(`Preview: ${outPath}`)
console.log(`From:    ${reportPath}`)
