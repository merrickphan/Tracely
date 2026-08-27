/**
 * Tracely shell — hash router over six tab modules.
 * CONTRACT for tab modules (home, documents, analyze, library, watch, settings):
 *   export async function render(mount, ctx)
 * ctx = {
 *   api,               // /app/api.js wrapper
 *   marks,             // /shared/marks.js (problem kinds — decided in main, drawn here)
 *   rubric,            // /shared/rubric.js
 *   guards,            // /shared/guards.js
 *   citations,         // /shared/citations.js (pure formatters)
 *   settings,          // current prefs object (refreshed on navigation)
 *   navigate(name, params), // switch tab, e.g. navigate("analyze", {docId})
 *   params,            // current route params
 *   toast(msg, isError),
 *   openTracer(documentId), // bottom-left tutor panel
 * }
 * Modules own their DOM under `mount` and inject their own <style data-tab=…>
 * (namespaced under their root class) exactly once.
 */
import { api } from "/app/api.js";
import * as marks from "/shared/marks.js";
import * as rubric from "/shared/rubric.js";
import * as guards from "/shared/guards.js";
import * as citations from "/shared/citations.js";
import { openTracer } from "/app/tracer.js";

const view = document.getElementById("view");
const tabsEl = document.getElementById("tabs");

const MODULES = {
  home: () => import("/app/home.js"),
  documents: () => import("/app/documents.js"),
  analyze: () => import("/app/analyze.js"),
  library: () => import("/app/library.js"),
  watch: () => import("/app/watch.js"),
  settings: () => import("/app/settings.js"),
};

export function toast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " err" : "");
  el.textContent = msg;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, qs] = h.split("?");
  const params = Object.fromEntries(new URLSearchParams(qs ?? ""));
  return { name: MODULES[name] ? name : "home", params };
}

export function navigate(name, params = {}) {
  const qs = new URLSearchParams(params).toString();
  location.hash = `#/${name}${qs ? "?" + qs : ""}`;
}

/* ── theme engine ──
   Resolves "light" | "dark" | "system"; "system" follows prefers-color-scheme
   with a live matchMedia listener. The resolved value lands on
   document.documentElement.dataset.theme, which style.css keys off. */
let systemMedia = null;
let systemListener = null;
export function applyTheme(settings) {
  const pref = settings?.theme ?? "system";
  if (systemMedia && systemListener) {
    systemMedia.removeEventListener("change", systemListener);
    systemMedia = null;
    systemListener = null;
  }
  if (pref === "system") {
    systemMedia = window.matchMedia("(prefers-color-scheme: dark)");
    systemListener = () => {
      document.documentElement.dataset.theme = systemMedia.matches ? "dark" : "light";
    };
    systemMedia.addEventListener("change", systemListener);
    systemListener();
  } else {
    document.documentElement.dataset.theme = pref === "dark" ? "dark" : "light";
  }
}

// settings.js dispatches this after saving prefs — re-theme without a reload.
window.addEventListener("tracely:prefs", (e) => {
  if (e.detail && typeof e.detail === "object") applyTheme(e.detail);
  else api.prefs.get().then(applyTheme).catch(() => {});
});

let renderSeq = 0;
async function route() {
  const { name, params } = parseHash();
  const seq = ++renderSeq;
  for (const b of tabsEl.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.nav === name);
  }
  const settings = await api.prefs.get().catch(() => ({}));
  if (seq !== renderSeq) return;
  applyTheme(settings);
  const mod = await MODULES[name]();
  if (seq !== renderSeq) return;
  view.innerHTML = "";
  view.dataset.tab = name;
  await mod.render(view, {
    api, marks, rubric, guards, citations, settings, params,
    navigate, toast, openTracer,
  });
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) navigate(nav.dataset.nav);
});
window.addEventListener("hashchange", route);

/* ── usage meter — cumulative token/cost readout in the topbar ── */
function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
window.addEventListener("tracely:usage", (e) => {
  const { input, output, cost } = e.detail ?? {};
  const el = document.getElementById("usageMeter");
  if (!el) return;
  el.textContent = `${fmtTokens(input ?? 0)} in · ${fmtTokens(output ?? 0)} out · ~$${(cost ?? 0).toFixed(2)}`;
  el.classList.remove("hidden");
});

async function pollStatus() {
  const serverState = document.getElementById("serverState");
  try {
    const s = await api.status();
    document.getElementById("keyBanner").classList.toggle("hidden", Boolean(s.hasKey));
    serverState.textContent = "";
  } catch {
    serverState.textContent = "server unreachable";
  }
}
pollStatus();
setInterval(pollStatus, 8000);

route();
