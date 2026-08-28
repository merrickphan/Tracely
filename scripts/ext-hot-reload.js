/* Tracely extension hot-reloader — DEV ONLY.
 *
 * This file ships only in the generated `extension-dev/` copy (see
 * scripts/live-extension.mjs), never in the real `extension/`. The live
 * session's watcher rewrites `DEV-VERSION` in this copy every time it pulls new
 * code from the live-preview branch; this worker notices and reloads the
 * extension (and the tab you're looking at) so a change made by the Discord bot
 * shows up without you touching Chrome.
 *
 * Two dev-only capabilities the production extension deliberately does not have
 * make this work, and they exist only in the dev copy's manifest:
 *   - the `tabs` permission, so the active tab can be refreshed to re-inject the
 *     content script after a reload;
 *   - a keep-alive ping, because MV3 kills an idle service worker after ~30s and
 *     a sleeping worker cannot notice a file change.
 */
const POLL_MS = 1500
const KEEPALIVE_MS = 20000
let knownVersion = null

async function readVersion() {
  try {
    // cache-bust so the fetch reads the file from disk, not Chrome's cache
    const res = await fetch(chrome.runtime.getURL('DEV-VERSION') + '?t=' + Date.now())
    return (await res.text()).trim()
  } catch {
    return knownVersion // transient; treat as unchanged
  }
}

async function reloadActiveTabs() {
  try {
    const tabs = await chrome.tabs.query({ active: true })
    for (const tab of tabs) {
      if (tab.id != null && /^https?:/.test(tab.url || '')) chrome.tabs.reload(tab.id)
    }
  } catch {
    // no tabs permission (shouldn't happen in the dev copy) — extension still reloads
  }
}

async function poll() {
  const version = await readVersion()
  if (version == null) return
  if (knownVersion == null) {
    knownVersion = version
    return
  }
  if (version !== knownVersion) {
    console.log(`[tracely-hot-reload] change detected (${knownVersion} → ${version}) — reloading`)
    await reloadActiveTabs()
    chrome.runtime.reload() // restarts with the new code from disk; the fresh worker re-baselines
  }
}

// A chrome API call every 20s resets the idle timer, keeping the worker alive
// through a dev session so it can actually observe changes. Dev-only by design.
setInterval(() => {
  try {
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError)
  } catch {}
}, KEEPALIVE_MS)

setInterval(poll, POLL_MS)
poll()
