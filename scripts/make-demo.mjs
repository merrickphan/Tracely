// Builds ui/demo.html: a single-file, fully OFFLINE demo of the Tracely main
// window, from the output of `vite build --config demo.vite.config.mts`.
//
// Everything dist-demo/index.html references is inlined here — each module
// script becomes an inline <script type="module">, each stylesheet a <style>
// block, and any asset file still referenced by path (fonts, images) becomes
// a data: URI. The demo config already inlines assets at build time
// (assetsInlineLimit), so the path-rewrite passes are belt-and-braces for the
// day an asset outgrows that; they are exercised by construction either way.
//
// Run:  node scripts/make-demo.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(repo, 'dist-demo')
const htmlPath = join(distDir, 'index.html')
const outPath = join(repo, 'demo.html')
const MAX_BYTES = 10 * 1024 * 1024

const MIME = {
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon'
}

function toDataUri(assetPath) {
  const ext = assetPath.split('.').pop().toLowerCase()
  const mime = MIME[ext]
  if (!mime) throw new Error(`make-demo: no MIME mapping for .${ext} (${assetPath})`)
  return `data:${mime};base64,${readFileSync(assetPath).toString('base64')}`
}

/** Resolve an "./assets/x" | "/assets/x" | "assets/x" reference to a dist file. */
function distFile(ref, baseDir) {
  const clean = ref.replace(/^\.\//, '').replace(/^\//, '')
  const candidates = [join(baseDir, clean), join(distDir, clean)]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** Rewrite url(...) references in CSS to data: URIs (data:/# left alone). */
function inlineCssUrls(css, cssDir) {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g, (whole, _q, ref) => {
    if (/^(data:|#|about:)/i.test(ref)) return whole
    if (/^https?:\/\//i.test(ref)) {
      throw new Error(`make-demo: external URL in CSS must not ship: ${ref}`)
    }
    const file = distFile(ref, cssDir)
    if (!file) throw new Error(`make-demo: CSS references missing asset: ${ref}`)
    return `url("${toDataUri(file)}")`
  })
}

/** Rewrite any string literal in the JS bundle that names an assets/ file. */
function inlineJsAssetRefs(js) {
  return js.replace(/(["'`])((?:\.?\/)?assets\/[^"'`\s]+?)\1/g, (whole, q, ref) => {
    const file = distFile(ref, distDir)
    if (!file) return whole // not actually a built asset (coincidental string)
    return `${q}${toDataUri(file)}${q}`
  })
}

let html = readFileSync(htmlPath, 'utf8')

// --- 1. Scripts -> inline <script type="module"> --------------------------
html = html.replace(
  /<script\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*><\/script>/g,
  (_whole, _q, src) => {
    const file = distFile(src, distDir)
    if (!file) throw new Error(`make-demo: script src not found in dist: ${src}`)
    let js = readFileSync(file, 'utf8')
    js = inlineJsAssetRefs(js)
    // "</script" inside the JS would terminate the inline tag mid-bundle.
    js = js.replace(/<\/script/gi, '<\\/script')
    // Sandboxed/cross-origin frames (hosted artifact viewers) throw on ANY
    // window.parent property read. The standalone shim already installs
    // __tracelyPreview on window itself, so read it there.
    js = js.replace(/window\.parent\.__tracelyPreview/g, 'window.__tracelyPreview')
    const prelude = [
      "/* Sandbox compatibility: storage access throws in sandboxed frames (e.g. hosted",
      "   artifact viewers). Shim it in-memory, and surface boot errors visibly. */",
      "(function(){",
      "  function memStorage(){ var m = {}; return {",
      "    getItem: function(k){ return Object.prototype.hasOwnProperty.call(m,k) ? m[k] : null },",
      "    setItem: function(k,v){ m[k] = String(v) },",
      "    removeItem: function(k){ delete m[k] },",
      "    clear: function(){ m = {} },",
      "    key: function(i){ var ks = Object.keys(m); return i < ks.length ? ks[i] : null },",
      "    get length(){ return Object.keys(m).length }",
      "  }; }",
      "  ['localStorage','sessionStorage'].forEach(function(name){",
      "    var ok = false;",
      "    try { window[name].getItem('__probe__'); ok = true; } catch (e) {}",
      "    if (!ok) { try { Object.defineProperty(window, name, { value: memStorage(), configurable: true }); } catch (e) {} }",
      "  });",
      "  window.addEventListener('error', function(e){",
      "    var root = document.getElementById('root');",
      "    if (root && !root.firstChild) {",
      "      var d = document.createElement('div');",
      "      d.style.cssText = 'padding:24px;font:13px/1.5 system-ui;color:#b91c1c;white-space:pre-wrap';",
      "      d.textContent = 'Demo failed to start: ' + (e && e.message ? e.message : 'unknown error');",
      "      root.appendChild(d);",
      "    }",
      "  });",
      "})();"
    ].join('\n')
    return `<script>\n${prelude}\n${js}\n</script>`
  }
)

// --- 2. Stylesheets -> inline <style> -------------------------------------
html = html.replace(
  /<link\b[^>]*\brel=(["'])stylesheet\1[^>]*>/g,
  (whole) => {
    const m = whole.match(/\bhref=(["'])([^"']+)\1/)
    if (!m) throw new Error(`make-demo: stylesheet link without href: ${whole}`)
    const file = distFile(m[2], distDir)
    if (!file) throw new Error(`make-demo: stylesheet not found in dist: ${m[2]}`)
    const css = inlineCssUrls(readFileSync(file, 'utf8'), dirname(file))
    return `<style>\n${css}\n</style>`
  }
)

// Preload hints for files that no longer exist as files.
html = html.replace(/<link\b[^>]*\brel=(["'])(?:modulepreload|preload|icon)\1[^>]*>\s*/g, '')

// --- 3. CSP: the shipped meta allows only 'self' scripts, which would block
// the inlined bundle. Replace it with an equally strict OFFLINE policy:
// inline script/style and data: assets only — no network fetch is even
// permitted by the browser, which is the demo's whole contract.
html = html.replace(
  /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
  `<meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"
    />`
)

// --- 4. Demo banner --------------------------------------------------------
const banner = `    <style>
      #tracely-demo-banner {
        position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
        z-index: 2147483647; display: flex; align-items: center; gap: 10px;
        padding: 8px 10px 8px 14px; max-width: calc(100vw - 32px);
        background: var(--surface, #fbfaf7); color: var(--text, #1c1c1c);
        border: 1px solid #ff5900; border-radius: 8px;
        box-shadow: 0 4px 18px rgba(28, 28, 28, 0.14);
        font: 500 12.5px/1.4 "Instrument Sans", system-ui, sans-serif;
      }
      #tracely-demo-banner b { color: #ff5900; font-weight: 600; }
      #tracely-demo-banner button {
        all: unset; cursor: pointer; color: var(--muted, #9a9aa4);
        font-size: 14px; line-height: 1; padding: 2px 5px; border-radius: 4px;
      }
      #tracely-demo-banner button:hover { color: #ff5900; }
    </style>
    <div id="tracely-demo-banner" role="note">
      <span><b>Tracely</b> — interactive demo with sample data. Nothing is sent anywhere.</span>
      <button type="button" aria-label="Dismiss" onclick="document.getElementById('tracely-demo-banner').remove()">✕</button>
    </div>
`
html = html.replace('</body>', `${banner}  </body>`)

// --- 5. Verify offline-clean before writing --------------------------------
const problems = []
for (const re of [/\bsrc="https?:\/\//i, /\bhref="https?:\/\//i, /\bsrc='https?:\/\//i, /\bhref='https?:\/\//i]) {
  if (re.test(html)) problems.push(`fetchable external reference matches ${re}`)
}
// url(http...) in CSS outside data: URIs (data: URIs percent-encode their
// quotes, so a raw url(" + http is a genuine external fetch).
if (/url\(\s*['"]?https?:\/\//i.test(html)) problems.push('external url(...) in CSS')
if (/<script\b[^>]*\bsrc=/i.test(html)) problems.push('a <script src> survived inlining')
if (/<link\b[^>]*\bhref=/i.test(html)) problems.push('a <link href> survived inlining')
if (problems.length) {
  console.error('make-demo: NOT offline-clean:\n  ' + problems.join('\n  '))
  process.exit(1)
}

writeFileSync(outPath, html)
const bytes = Buffer.byteLength(html)
if (bytes > MAX_BYTES) {
  console.error(`make-demo: demo.html is ${bytes} bytes (> 10 MB cap)`)
  process.exit(1)
}
console.log(`make-demo: wrote ${outPath} (${bytes} bytes, ${(bytes / 1024 / 1024).toFixed(2)} MB) — offline-clean`)
