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

async function reloadTabs() {
  try {
    // Every http(s) tab, not just the active one: runtime.reload() invalidates
    // the content script in ALL tabs, so a background tab left un-refreshed runs
    // a dead content script until you touch it. Dev-only, so reloading them all
    // is the right trade.
    const tabs = await chrome.tabs.query({})
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
    await reloadTabs()
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

// Belt-and-suspenders: if the worker is ever torn down anyway (the OS can kill
// it regardless of the keepalive), a registered alarm listener is one of the
// few things that WAKES a dead MV3 worker on a schedule — and top-level
// listener registration re-arms the poll each time the worker restarts, so the
// loop can never stay dead. The onAlarm handler runs a poll immediately.
try {
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === 'tracely-hot-reload') poll()
  })
  chrome.alarms.create('tracely-hot-reload', { periodInMinutes: 0.25 })
} catch {}

poll()
