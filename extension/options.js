/* Tracely options page — API key + model for standalone mode, the per-site
   auto-check list, and a live probe of the local server. */
"use strict";

const SERVER = "http://localhost:4477";
const $ = (id) => document.getElementById(id);

/* ── load + save ─────────────────────────────────────────────────────────── */

function load() {
  chrome.storage.local.get({ apiKey: "", model: "claude-opus-5", enabledSites: [] }, (cfg) => {
    $("apiKey").value = cfg.apiKey;
    $("model").value = cfg.model;
    renderSites(cfg.enabledSites);
  });
}

let savedTimer = null;
function flashSaved(text) {
  $("keySaved").textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $("keySaved").textContent = ""; }, 2500);
}

$("saveKey").addEventListener("click", () => {
  const apiKey = $("apiKey").value.trim();
  chrome.storage.local.set({ apiKey }, () => {
    flashSaved(apiKey ? "Saved — standalone mode is ready when the server is off." : "Key removed — Tracely will use the local server only.");
    probe(); // status line may change wording now that a key is (un)set
  });
});
$("apiKey").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("saveKey").click();
});

$("model").addEventListener("change", () => {
  chrome.storage.local.set({ model: $("model").value });
});

/* ── per-site auto-check list ────────────────────────────────────────────── */

function renderSites(sites) {
  const ul = $("sites");
  ul.textContent = "";
  const list = Array.isArray(sites) ? sites : [];
  $("noSites").style.display = list.length ? "none" : "";
  for (const origin of list) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "origin";
    span.textContent = origin;
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      chrome.storage.local.get({ enabledSites: [] }, (cfg) => {
        chrome.storage.local.set({ enabledSites: (cfg.enabledSites ?? []).filter((o) => o !== origin) });
      });
    });
    li.append(span, btn);
    ul.appendChild(li);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabledSites) renderSites(changes.enabledSites.newValue ?? []);
});

/* ── live server probe ───────────────────────────────────────────────────── */

async function probe() {
  const wrap = $("serverStatus");
  const text = $("serverStatusText");
  try {
    const res = await fetch(`${SERVER}/api/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = await res.json().catch(() => ({}));
    wrap.className = "status on";
    text.textContent = s.docsBridge
      ? "Local server: online — all features, Docs write-back ready"
      : "Local server: online — all features (web-search sources, URL citing)";
  } catch {
    chrome.storage.local.get({ apiKey: "" }, (cfg) => {
      wrap.className = "status off";
      text.textContent = cfg.apiKey
        ? "Local server: offline — standalone mode active (your API key, checks + sources)"
        : "Local server: offline — add an API key above to use Tracely standalone";
    });
  }
}

load();
probe();
setInterval(probe, 4000);
