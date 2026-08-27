/* Tracely — universal writing checker.

   Three modes, chosen at load:
   • Docs mode (docs.google.com/document/*) — the original behavior, untouched:
     reads the doc via the signed-in export endpoint every 10s, shows findings
     in the floating widget; edits go through the local server's Docs bridge
     (or copy-paste when the bridge isn't configured).
   • Harness mode (window.__tracelyHarness) — the test page stands in for Docs.
   • Field mode (everywhere else) — Grammarly's actual core mechanism: track
     the focused textarea / contenteditable, check its sentences, and rewrite
     flagged ones IN PLACE. Automatic 10s checking is opt-in per site
     ("tracely.site.enabled" in the page's localStorage); on a non-enabled
     site nothing is sent anywhere until the user clicks.

   All API traffic goes through the extension's background service worker,
   which picks the engine: the local Tracely server when it's reachable
   (all features), or direct api.anthropic.com calls when an API key is set
   on the options page (standalone — checks + web-search sources; cite-url
   and Docs write-back hide). Harness/plain test pages fetch directly.

   Field mode also draws Grammarly-style overlay underlines: flagged
   sentences get a 2px colored underline + faint wash (false #d93636,
   questionable #ffb800, incoherent #ff5900; grey dotted while pending);
   clicking one opens the panel and flashes that verdict's card. */
"use strict";

(() => {
  const SERVER = "http://localhost:4477";
  const CHECK_INTERVAL_MS = 10_000;
  const MAX_SENTENCES_PER_CHECK = 40;
  const MAX_INPUT_CHARS = 30_000; // GUARDS.maxInputChars — clamp before anything reaches a model
  const MIN_FIELD_CHARS = 80;     // GUARDS.detect.minChars — fields shorter than this are ignored

  const harness = window.__tracelyHarness ?? null; // test harness page stands in for Docs
  const IS_DOCS = !harness && location.hostname === "docs.google.com" && location.pathname.startsWith("/document/");
  if (document.getElementById("tracely-host")) return;

  const ISSUE_VERDICTS = ["false", "questionable", "incoherent"];
  const VERDICT_LABEL = { false: "False", questionable: "Questionable", incoherent: "Doesn't make sense" };
  const AUTO_SOURCE_VERDICTS = ["false", "questionable"];
  // The three-colour mark vocabulary for in-page underlines (field mode).
  const MARK_COLORS = { false: "#d93636", questionable: "#ffb800", incoherent: "#ff5900" };
  const MARK_PENDING = "#9a9ba1"; // grey dotted while a sentence's check is in flight

  /* ── shared helpers (mirror public/app.js) ─────────────────────────────── */

  function hashText(s) {
    const norm = s.toLowerCase().replace(/\s+/g, " ").trim();
    let h = 5381;
    for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
    return "s" + h.toString(36);
  }

  // Bibliography block ("Sources:" + numbered entries) — mirrors public/app.js.
  function sourcesBlock(text) {
    const m = text.match(/(?:^|\n)Sources:\n/);
    if (!m) return null;
    const headStart = m.index + (m[0].startsWith("\n") ? 1 : 0);
    const bodyStart = m.index + m[0].length;
    const entryRe = /^(\d+)\.\s+(.*?)\s+—\s+(\S+)\s*$/;
    const entries = [];
    let pos = bodyStart;
    while (pos < text.length) {
      const nl = text.indexOf("\n", pos);
      const lineEnd = nl === -1 ? text.length : nl;
      const em = text.slice(pos, lineEnd).match(entryRe);
      if (!em) break;
      entries.push({ num: Number(em[1]), title: em[2], url: em[3] });
      pos = nl === -1 ? text.length : nl + 1;
    }
    return { headStart, end: pos, entries };
  }

  function segmentText(text) {
    const segs = [];
    const block = sourcesBlock(text);
    const lineRe = /[^\n]+/g;
    let lm;
    while ((lm = lineRe.exec(text))) {
      const line = lm[0];
      const base = lm.index;
      if (block && base >= block.headStart && base < block.end) continue; // skip the bibliography
      const sentRe = /[^.!?]+(?:[.!?]+["')\]]*|$)/g;
      let sm;
      while ((sm = sentRe.exec(line))) {
        const raw = sm[0];
        const lead = raw.match(/^\s*/)[0].length;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const start = base + sm.index + lead;
        segs.push({ text: trimmed, start, end: start + trimmed.length, hash: hashText(trimmed) });
      }
    }
    for (const seg of segs) {
      const words = seg.text.split(/\s+/).length;
      const endsTerminal = /[.!?]["')\]]*$/.test(seg.text);
      const moreAfter = text.slice(seg.end).trim().length > 0;
      seg.checkable = words >= 3 && seg.text.length <= 2000 && (endsTerminal || moreAfter);
    }
    return segs;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Carry [n] citation markers from the original sentence into a revision that
  // dropped them (mirrors applyFix in the app).
  function withMarkers(original, revision) {
    const markers = [...new Set(original.match(/\[\d+\]/g) ?? [])].filter((m) => !revision.includes(m));
    if (!markers.length) return revision;
    const punct = revision.match(/[.!?]+["')\]]*$/);
    const at = punct ? revision.length - punct[0].length : revision.length;
    return revision.slice(0, at).replace(/\s+$/, "") + " " + markers.join(" ") + revision.slice(at);
  }

  /* ── transport ─────────────────────────────────────────────────────────── */

  // Inside the real extension, ALL modes relay through the background worker,
  // which picks the engine (local server vs standalone api.anthropic.com).
  // The harness and plain-script test pages fetch the server directly.
  const useRelay = !harness && typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

  async function api(path, body) {
    if (useRelay) {
      let resp;
      try {
        resp = await chrome.runtime.sendMessage({ type: "tracely-api", path, body });
      } catch {
        throw new Error("Tracely extension was reloaded — refresh this page");
      }
      if (!resp) throw new Error("No reply from the Tracely background worker");
      if (!resp.ok) {
        throw Object.assign(new Error(resp.message ?? `HTTP ${resp.status}`), { kind: resp.kind, offline: resp.offline });
      }
      return resp.data;
    }
    const res = await fetch(`${SERVER}${path}`, body === undefined
      ? undefined
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data?.error?.message ?? `HTTP ${res.status}`), { kind: data?.error?.kind });
    }
    return data;
  }

  function offlineError(err) {
    return Boolean(err?.offline) || err instanceof TypeError || /failed to fetch/i.test(String(err?.message));
  }

  /* ── widget chrome (shared shadow-DOM shell) ───────────────────────────── */

  const PLANE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`;

  const WIDGET_CSS = `
    :host { all: initial; }
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .root { position: fixed; right: 22px; bottom: 22px; z-index: 2147483647; }
    .pill {
      display: flex; align-items: center; gap: 8px;
      background: #fff; color: #23201a;
      border: 1px solid #eae5dd; border-radius: 999px;
      padding: 9px 16px 9px 12px;
      box-shadow: 0 4px 24px #00000026;
      cursor: pointer; user-select: none;
      font-size: 13px; font-weight: 600;
    }
    .pill:hover { border-color: #f97316; }
    .pill.quiet { color: #6f685c; }
    .pill.quiet .plane { background: linear-gradient(135deg, #b3a893, #a39a8a); }
    .plane {
      width: 26px; height: 26px; border-radius: 8px;
      background: linear-gradient(135deg, #f97316, #ea580c);
      display: flex; align-items: center; justify-content: center;
      color: #fff; flex-shrink: 0;
    }
    .plane svg { width: 14px; height: 14px; }
    .count { background: #fef1f0; color: #d92d20; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
    .count.ok { background: #ecfdf3; color: #15803d; }
    .count.off { background: #f1f0ee; color: #a39a8a; }
    .panel {
      position: absolute; right: 0; bottom: 52px;
      width: 380px; max-height: min(560px, 72vh);
      background: #faf8f5; border: 1px solid #eae5dd; border-radius: 14px;
      box-shadow: 0 12px 48px #00000033;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; background: #fff; border-bottom: 1px solid #eae5dd;
      cursor: grab;
    }
    .head .name { font-family: Georgia, serif; font-weight: 700; font-size: 16px; }
    .head .autosrc { flex-shrink: 0; }
    .status { margin-left: auto; font-size: 11px; color: #a39a8a; max-width: 170px; text-align: right; }
    .status.error { color: #d92d20; }
    .selects { display: flex; gap: 6px; padding: 8px 14px; background: #fff; border-bottom: 1px solid #eae5dd; align-items: center; }
    select { font-size: 12px; border: 1px solid #ddd6ca; border-radius: 6px; padding: 3px 6px; background: #fff; color: #23201a; outline: none; }
    .list { overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .empty { text-align: center; color: #a39a8a; font-size: 12.5px; padding: 26px 12px; }
    .card { background: #fff; border: 1px solid #eae5dd; border-left: 3px solid #a39a8a; border-radius: 10px; padding: 10px 12px; }
    .card.c-false { border-left-color: #d92d20; }
    .card.c-quest { border-left-color: #b45309; }
    .card.c-inco { border-left-color: #7c3aed; }
    .top { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
    .badge { font-size: 9px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; padding: 2px 7px; border-radius: 20px; }
    .badge-false { background: #d92d2015; color: #d92d20; }
    .badge-quest { background: #b4530915; color: #b45309; }
    .badge-inco { background: #7c3aed12; color: #7c3aed; }
    .x { margin-left: auto; background: none; border: none; color: #a39a8a; cursor: pointer; font-size: 13px; }
    .x:hover { color: #23201a; }
    .quote { font-family: Georgia, serif; font-style: italic; font-size: 12.5px; color: #6f685c; border-left: 2px solid #ddd6ca; padding-left: 8px; margin-bottom: 6px; }
    .expl { font-size: 12px; color: #23201a; margin-bottom: 8px; }
    .fix { background: #faf8f5; border: 1px solid #eae5dd; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; }
    .fix-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: #15803d; margin-bottom: 3px; }
    .fix-text { font-family: Georgia, serif; font-size: 12.5px; margin-bottom: 6px; }
    .row { display: flex; gap: 6px; }
    button.act {
      border: 1px solid #ddd6ca; background: #fff; color: #23201a; border-radius: 6px;
      padding: 4px 10px; font-size: 11.5px; cursor: pointer; font-weight: 600;
    }
    button.act:hover { border-color: #f97316; color: #ea580c; }
    button.act.primary { background: #fff1e6; border-color: #fbd6b5; color: #ea580c; }
    button.act[disabled] { opacity: .5; cursor: default; }
    .sources { border-top: 1px dashed #ddd6ca; margin-top: 8px; padding-top: 6px; }
    .sources-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: #ea580c; margin-bottom: 4px; }
    .src { display: flex; gap: 6px; align-items: flex-start; padding: 5px 6px; border-radius: 7px; }
    .src:hover { background: #fff1e6; }
    .stance { font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 8px; margin-top: 2px; flex-shrink: 0; }
    .st-supports { background: #ecfdf3; color: #15803d; }
    .st-refutes { background: #fef1f0; color: #d92d20; }
    .st-context { background: #f1f0ee; color: #6f685c; }
    .src-body { flex: 1; min-width: 0; }
    .src a { font-size: 11.5px; font-weight: 600; color: #23201a; text-decoration: none; display: block; }
    .src a:hover { color: #ea580c; text-decoration: underline; }
    .src-meta { font-size: 10px; color: #a39a8a; }
    .src-snip { font-size: 10.5px; color: #6f685c; }
    .loading { font-size: 11.5px; color: #a39a8a; font-style: italic; }
    .st-manual { background: #e8f1fb; color: #1d6fb8; }
    .cite-url { display: flex; gap: 6px; margin-top: 8px; }
    .cite-url input { flex: 1; min-width: 0; border: 1px solid #ddd6ca; border-radius: 6px; padding: 4px 8px; font-size: 11.5px; outline: none; color: #23201a; background: #fff; }
    .cite-url input:focus { border-color: #f97316; }
    .autosrc { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #6f685c; cursor: pointer; user-select: none; }
    .autosrc input { accent-color: #f97316; }
    .foot { padding: 7px 14px; background: #fff; border-top: 1px solid #eae5dd; font-size: 10.5px; color: #a39a8a; display: flex; justify-content: space-between; }
    .card.flash { animation: tracely-flash 1.2s ease-out; }
    @keyframes tracely-flash {
      0% { background: #fff7ed; box-shadow: 0 0 0 3px #f9731666; }
      100% { background: #fff; box-shadow: none; }
    }
  `;

  function makeWidget() {
    const host = document.createElement("div");
    host.id = "tracely-host";
    const shadow = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
    const style = document.createElement("style");
    style.textContent = WIDGET_CSS;
    shadow.appendChild(style);
    const root = document.createElement("div");
    root.className = "root";
    shadow.appendChild(root);
    return { host, shadow, root };
  }

  function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, value); } catch { /* sandboxed page */ } }
  function jsonParse(raw, fallback) { try { return JSON.parse(raw); } catch { return fallback; } }

  if (harness || IS_DOCS) docsMode();
  else fieldMode();

  /* ════════════════════════════════════════════════════════════════════════
     DOCS MODE — the original Google Docs widget, behavior unchanged.
     ════════════════════════════════════════════════════════════════════════ */
  function docsMode() {
    const DOC_ID = harness ? "harness" : (location.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([^/]+)/)?.[1] ?? null);
    if (!DOC_ID) return;

    const SETTINGS_KEY = "tracely.widget.settings";
    const DISMISS_KEY = `tracely.widget.dismissed.${DOC_ID}`;

    // ── state ──
    const cache = new Map();
    const dismissed = new Set(jsonParse(lsGet(DISMISS_KEY) ?? "[]", []));
    const sourcesMap = new Map(); // hash → {loading, list, copiedUrl}
    let settings = { model: "claude-haiku-4-5", effort: "low", ...jsonParse(lsGet(SETTINGS_KEY) ?? "{}", {}) };
    let segments = [];
    let inflight = false;
    let sourcesInflight = false;
    let lastCheckEnd = Date.now();
    let statusMsg = "starting…";
    let statusKind = "idle"; // idle | checking | error | offline
    let expanded = false;
    let docText = "";
    let copiedFixHash = null; // survives re-renders, unlike a bare textContent swap
    let bridgeReady = false;  // Docs bridge configured server-side → in-doc edit buttons
    let standaloneMode = false; // background worker is talking to api.anthropic.com directly
    let docBusy = false;
    const docFixed = new Set();
    let autoSourceTimes = []; // rolling-hour guard on automatic source lookups

    // ── doc reading ──
    async function getDocText() {
      if (harness) return harness.getText();
      const res = await fetch(`https://docs.google.com/document/d/${DOC_ID}/export?format=txt`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`doc export failed (${res.status})`);
      const t = await res.text();
      return t.replace(/^﻿/, "").replace(/\r\n/g, "\n");
    }

    function uncheckedSegments() {
      const out = [];
      const seen = new Set();
      for (const seg of segments) {
        if (!seg.checkable || seen.has(seg.hash)) continue;
        seen.add(seg.hash);
        if (cache.has(seg.hash)) continue;
        out.push(seg);
      }
      return out;
    }

    async function cycle() {
      if (inflight || document.hidden) return;
      inflight = true;
      try {
        docText = await getDocText();
        segments = segmentText(docText);
        const todo = uncheckedSegments().slice(0, MAX_SENTENCES_PER_CHECK);
        if (todo.length > 0) {
          statusKind = "checking";
          statusMsg = `checking ${todo.length}…`;
          render();
          const data = await api("/api/check", {
            text: docText.slice(0, MAX_INPUT_CHARS),
            sentences: todo.map((s) => ({ id: s.hash, text: s.text })),
            model: settings.model,
            effort: settings.effort,
          });
          for (const f of data.findings ?? []) {
            cache.set(f.id, { verdict: f.verdict, explanation: f.explanation, revision: f.revision, confidence: f.confidence });
          }
          autoFindSources(data.findings ?? []); // fire-and-forget, capped
        }
        statusKind = "idle";
        const n = currentIssues().length;
        statusMsg = n > 0 ? `${n} issue${n === 1 ? "" : "s"} found` : "all clear";
      } catch (err) {
        if (err?.kind === "no_key") {
          statusKind = "error";
          statusMsg = "add ANTHROPIC_API_KEY to tracely/.env";
        } else if (err?.kind === "no_engine") {
          statusKind = "offline";
          statusMsg = err.message;
        } else if (offlineError(err)) {
          statusKind = "offline";
          statusMsg = "Tracely server offline — run: node ~/tracely/server.js";
        } else {
          statusKind = "error";
          statusMsg = err?.message ?? "check failed";
        }
      } finally {
        inflight = false;
        lastCheckEnd = Date.now();
        render();
      }
    }

    function currentIssues() {
      const out = [];
      const seen = new Set();
      for (const seg of segments) {
        if (!seg.checkable || seen.has(seg.hash)) continue;
        seen.add(seg.hash);
        const f = cache.get(seg.hash);
        if (!f || dismissed.has(seg.hash) || !ISSUE_VERDICTS.includes(f.verdict)) continue;
        out.push({ seg, f });
      }
      return out;
    }

    async function fetchSources(hash, auto = false) {
      if (sourcesInflight) return;
      const seg = segments.find((s) => s.hash === hash);
      if (!seg) return;
      const f = cache.get(hash);
      sourcesInflight = true;
      sourcesMap.set(hash, { loading: true, list: null, copiedUrl: null });
      render();
      try {
        const data = await api("/api/sources", {
          claim: seg.text,
          correction: f?.revision || undefined,
          context: docText.slice(0, 6000),
          model: settings.model,
        });
        sourcesMap.set(hash, { loading: false, list: data.sources ?? [], copiedUrl: null });
      } catch (err) {
        sourcesMap.delete(hash);
        if (!auto) statusKind = "error";
        statusMsg = err?.message ?? "source search failed";
      } finally {
        sourcesInflight = false;
        render();
      }
    }

    // Auto-sources for flagged claims — capped per cycle and per rolling hour.
    async function autoFindSources(findings) {
      if (settings.autoSources !== true) return; // cost: auto web-search is opt-in
      let started = 0;
      for (const f of findings) {
        if (started >= 3) break;
        if (!AUTO_SOURCE_VERDICTS.includes(f.verdict)) continue;
        if (sourcesMap.has(f.id) || dismissed.has(f.id)) continue;
        if (!segments.some((s) => s.hash === f.id)) continue;
        autoSourceTimes = autoSourceTimes.filter((t) => Date.now() - t < 3_600_000);
        if (autoSourceTimes.length >= 15) { statusMsg = "auto-sources paused — hourly cap"; break; }
        autoSourceTimes.push(Date.now());
        started++;
        await fetchSources(f.id, true); // sequential: one paid search at a time
      }
    }

    // "Paste a URL and cite it" — free metadata fetch, then cite in the doc if we can.
    async function citeUrlWidget(hash, rawUrl) {
      if (docBusy) return;
      try {
        const data = await api("/api/cite-url", { url: rawUrl });
        const src = data.source;
        const st = sourcesMap.get(hash) ?? { loading: false, list: [], copiedUrl: null };
        st.loading = false;
        st.list = st.list ?? [];
        if (!st.list.some((s) => s.url === src.url)) st.list.unshift(src);
        sourcesMap.set(hash, st);
        if (canEditDoc()) {
          await docCite(hash, st.list.findIndex((s) => s.url === src.url));
        } else {
          statusKind = "idle";
          statusMsg = "source added — use Copy cite";
        }
      } catch (e) {
        statusKind = "error";
        statusMsg = e?.message ?? "couldn't cite that URL";
      }
      render();
    }

    function copyText(text, hash, url) {
      navigator.clipboard?.writeText(text).catch(() => {});
      if (hash && url) {
        const st = sourcesMap.get(hash);
        if (st) st.copiedUrl = url;
      }
      render();
    }

    // ── in-doc editing via the local server's Docs bridge ──
    const canEditDoc = () => bridgeReady && !harness;

    async function fetchServerStatus() {
      try {
        const s = await api("/api/status");
        bridgeReady = Boolean(s.docsBridge);
        standaloneMode = Boolean(s.standalone);
      } catch { bridgeReady = false; }
    }

    function docApply(payload) {
      return api("/api/docs/apply", { docId: DOC_ID, ...payload });
    }

    async function docFix(hash) {
      const seg = segments.find((s) => s.hash === hash);
      const f = cache.get(hash);
      if (!seg || !f?.revision || docBusy) return;
      docBusy = true;
      render();
      try {
        await docApply({ action: "replace", find: seg.text, replacement: withMarkers(seg.text, f.revision) });
        docFixed.add(hash);
        cache.delete(hash); // the rewritten sentence gets re-verified on the next read
        statusKind = "idle";
        statusMsg = "fixed in doc";
        lastCheckEnd = Date.now() - CHECK_INTERVAL_MS + 3000; // re-read soon (export lags slightly)
      } catch (e) {
        statusKind = "error";
        statusMsg = e?.message ?? "doc edit failed";
      } finally {
        docBusy = false;
        render();
      }
    }

    async function docCite(hash, i) {
      const seg = segments.find((s) => s.hash === hash);
      const st = sourcesMap.get(hash);
      const src = st?.list?.[Number(i)];
      if (!seg || !src || docBusy) return;
      docBusy = true;
      render();
      try {
        const block = sourcesBlock(docText);
        let num;
        const existing = block?.entries.find((e) => e.url === src.url);
        if (existing) {
          num = existing.num;
        } else {
          num = (block?.entries.length ?? 0) + 1;
          if (!block) await docApply({ action: "appendLine", line: "Sources:" });
          await docApply({ action: "appendLine", line: `${num}. ${src.title} — ${src.url}` });
        }
        if (!seg.text.includes(`[${num}]`)) {
          const punct = seg.text.match(/[.!?]+["')\]]*$/);
          const at = punct ? seg.text.length - punct[0].length : seg.text.length;
          const replacement = seg.text.slice(0, at).replace(/\s+$/, "") + ` [${num}]` + seg.text.slice(at);
          await docApply({ action: "replace", find: seg.text, replacement });
          const newHash = hashText(replacement);
          if (cache.has(hash) && !cache.has(newHash)) cache.set(newHash, cache.get(hash));
          if (sourcesMap.has(hash) && !sourcesMap.has(newHash)) sourcesMap.set(newHash, sourcesMap.get(hash));
        }
        st.citedUrl = src.url;
        statusKind = "idle";
        statusMsg = `cited [${num}] in doc`;
        lastCheckEnd = Date.now() - CHECK_INTERVAL_MS + 3000;
      } catch (e) {
        statusKind = "error";
        statusMsg = e?.message ?? "cite failed";
      } finally {
        docBusy = false;
        render();
      }
    }

    async function highlightAllInDoc() {
      if (docBusy) return;
      docBusy = true;
      render();
      try {
        const issues = currentIssues();
        for (const { seg, f } of issues) {
          await docApply({ action: "highlight", sentence: seg.text, verdict: f.verdict });
        }
        statusKind = "idle";
        statusMsg = `highlighted ${issues.length} sentence${issues.length === 1 ? "" : "s"}`;
      } catch (e) {
        statusKind = "error";
        statusMsg = e?.message ?? "highlight failed";
      } finally {
        docBusy = false;
        render();
      }
    }

    async function clearHighlightsInDoc() {
      if (docBusy) return;
      docBusy = true;
      render();
      try {
        await docApply({ action: "clearHighlights" });
        statusKind = "idle";
        statusMsg = "highlights cleared";
      } catch (e) {
        statusKind = "error";
        statusMsg = e?.message ?? "clear failed";
      } finally {
        docBusy = false;
        render();
      }
    }

    // ── widget UI ──
    const { shadow, root } = makeWidget();

    function render() {
      const issues = currentIssues();
      const countdown = Math.max(0, Math.ceil((CHECK_INTERVAL_MS - (Date.now() - lastCheckEnd)) / 1000));
      const countCls = statusKind === "offline" || statusKind === "error" ? "off" : issues.length > 0 ? "" : "ok";
      const countTxt = statusKind === "offline" ? "off" : inflight ? "…" : issues.length > 0 ? String(issues.length) : "✓";

      let panelHtml = "";
      if (expanded) {
        const cards = issues.map(({ seg, f }) => {
          const kind = f.verdict === "false" ? "false" : f.verdict === "questionable" ? "quest" : "inco";
          const st = sourcesMap.get(seg.hash);
          let sourcesHtml = "";
          if (st?.loading) {
            sourcesHtml = `<div class="sources"><div class="loading">Searching the web for sources…</div></div>`;
          } else if (st?.list?.length) {
            sourcesHtml = `<div class="sources"><div class="sources-title">Sources — pick one to cite</div>` +
              st.list.map((src, i) => `
                <div class="src">
                  <span class="stance st-${esc(src.stance)}">${esc(src.stance)}</span>
                  <div class="src-body">
                    <a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>
                    <div class="src-meta">${esc(src.publisher)}</div>
                    ${src.snippet ? `<div class="src-snip">${esc(src.snippet)}</div>` : ""}
                  </div>
                  ${canEditDoc() ? `<button class="act primary" data-doc-cite="${seg.hash}" data-i="${i}"${docBusy ? " disabled" : ""}>${st.citedUrl === src.url ? "Cited ✓" : "Cite in doc"}</button>` : ""}
                  <button class="act" data-copy-src="${seg.hash}" data-i="${i}">${st.copiedUrl === src.url ? "Copied ✓" : "Copy cite"}</button>
                </div>`).join("") + `</div>`;
          }
          return `
          <div class="card c-${kind}">
            <div class="top">
              <span class="badge badge-${kind}">${VERDICT_LABEL[f.verdict]}</span>
              <button class="x" data-dismiss="${seg.hash}" title="Dismiss">✕</button>
            </div>
            <div class="quote">“${esc(seg.text.length > 140 ? seg.text.slice(0, 139) + "…" : seg.text)}”</div>
            ${f.explanation ? `<div class="expl">${esc(f.explanation)}</div>` : ""}
            ${f.revision ? `
            <div class="fix">
              <div class="fix-label">Suggested revision</div>
              <div class="fix-text">${esc(f.revision)}</div>
              <div class="row">
                ${canEditDoc() ? `<button class="act primary" data-doc-fix="${seg.hash}"${docBusy ? " disabled" : ""}>${docFixed.has(seg.hash) ? "Fixed ✓" : "Fix in doc"}</button>` : ""}
                <button class="act${canEditDoc() ? "" : " primary"}" data-copy-fix="${seg.hash}">${copiedFixHash === seg.hash ? "Copied ✓" : "Copy fix"}</button>
                <button class="act" data-sources="${seg.hash}">Find sources</button>
              </div>
            </div>` : `<div class="row"><button class="act" data-sources="${seg.hash}">Find sources</button></div>`}
            ${sourcesHtml}
            ${standaloneMode ? "" : `<div class="cite-url"><input type="url" placeholder="Or paste a URL you found…" data-url-input="${seg.hash}" /><button class="act" data-url-add="${seg.hash}"${docBusy ? " disabled" : ""}>Cite</button></div>`}
          </div>`;
        }).join("");

        panelHtml = `
        <div class="panel">
          <div class="head" id="dragHead">
            <span class="plane">${PLANE_SVG}</span>
            <span class="name">Tracely</span>
            <span class="status ${statusKind === "error" || statusKind === "offline" ? "error" : ""}">${esc(statusMsg)}</span>
          </div>
          <div class="selects">
            <select id="modelSel">
              <option value="claude-opus-5"${settings.model === "claude-opus-5" ? " selected" : ""}>Opus 5 · sharpest</option>
              <option value="claude-sonnet-5"${settings.model === "claude-sonnet-5" ? " selected" : ""}>Sonnet 5 · balanced</option>
              <option value="claude-haiku-4-5"${settings.model === "claude-haiku-4-5" ? " selected" : ""}>Haiku 4.5 · fastest</option>
            </select>
            <select id="effortSel">
              <option value="low"${settings.effort === "low" ? " selected" : ""}>Fast</option>
              <option value="medium"${settings.effort === "medium" ? " selected" : ""}>Balanced</option>
              <option value="high"${settings.effort === "high" ? " selected" : ""}>Thorough</option>
            </select>
            <label class="autosrc" title="Automatically look up sources for flagged claims (capped)"><input type="checkbox" id="autoSrcTgl"${settings.autoSources === true ? " checked" : ""} /><span>Auto-src</span></label>
            <button class="act" id="checkNow" style="margin-left:auto">Check now</button>
          </div>
          ${canEditDoc() ? `
          <div class="selects">
            <button class="act" id="hlAll"${docBusy ? " disabled" : ""}>Highlight issues in doc</button>
            <button class="act" id="hlClear"${docBusy ? " disabled" : ""}>Clear highlights</button>
          </div>` : ""}
          <div class="list">
            ${cards || `<div class="empty">${statusKind === "offline" ? "Start the Tracely server, then reopen this doc." : "Nothing flagged. Keep writing — checking every 10s."}</div>`}
          </div>
          <div class="foot">
            <span id="countdownTxt">${inflight ? "checking…" : `next check in ${countdown}s`}</span>
            <span>${canEditDoc()
              ? "in-doc marks apply as background tints (bridge)"
              : standaloneMode
                ? "standalone — no Docs write-back; fixes are copy-paste"
                : "fixes are copy-paste (Docs API needs OAuth)"}</span>
          </div>
        </div>`;
      }

      const prevScroll = shadow.querySelector(".list")?.scrollTop ?? 0;
      root.innerHTML = `
        ${panelHtml}
        <div class="pill" id="pill">
          <span class="plane">${PLANE_SVG}</span>
          Tracely
          <span class="count ${countCls}">${countTxt}</span>
        </div>
      `;
      const listEl = shadow.querySelector(".list");
      if (listEl) listEl.scrollTop = prevScroll;

      shadow.getElementById("pill").addEventListener("click", () => { expanded = !expanded; render(); });
      if (expanded) {
        shadow.getElementById("modelSel").addEventListener("change", (e) => { settings.model = e.target.value; saveSettings(); });
        shadow.getElementById("effortSel").addEventListener("change", (e) => { settings.effort = e.target.value; saveSettings(); });
        shadow.getElementById("checkNow").addEventListener("click", () => { lastCheckEnd = 0; cycle(); });
        for (const btn of shadow.querySelectorAll("[data-dismiss]")) {
          btn.addEventListener("click", () => {
            dismissed.add(btn.dataset.dismiss);
            lsSet(DISMISS_KEY, JSON.stringify([...dismissed]));
            render();
          });
        }
        for (const btn of shadow.querySelectorAll("[data-copy-fix]")) {
          btn.addEventListener("click", () => {
            const f = cache.get(btn.dataset.copyFix);
            if (f?.revision) { copiedFixHash = btn.dataset.copyFix; copyText(f.revision); }
          });
        }
        for (const btn of shadow.querySelectorAll("[data-sources]")) {
          btn.addEventListener("click", () => fetchSources(btn.dataset.sources));
        }
        for (const btn of shadow.querySelectorAll("[data-copy-src]")) {
          btn.addEventListener("click", () => {
            const st = sourcesMap.get(btn.dataset.copySrc);
            const src = st?.list?.[Number(btn.dataset.i)];
            if (src) copyText(`${src.title} — ${src.url}`, btn.dataset.copySrc, src.url);
          });
        }
        shadow.getElementById("hlAll")?.addEventListener("click", highlightAllInDoc);
        shadow.getElementById("hlClear")?.addEventListener("click", clearHighlightsInDoc);
        for (const btn of shadow.querySelectorAll("[data-doc-fix]")) {
          btn.addEventListener("click", () => docFix(btn.dataset.docFix));
        }
        for (const btn of shadow.querySelectorAll("[data-doc-cite]")) {
          btn.addEventListener("click", () => docCite(btn.dataset.docCite, btn.dataset.i));
        }
        shadow.getElementById("autoSrcTgl")?.addEventListener("change", (e) => {
          settings.autoSources = e.target.checked;
          saveSettings();
        });
        for (const btn of shadow.querySelectorAll("[data-url-add]")) {
          btn.addEventListener("click", () => {
            const input = shadow.querySelector(`[data-url-input="${btn.dataset.urlAdd}"]`);
            if (input?.value.trim()) citeUrlWidget(btn.dataset.urlAdd, input.value.trim());
          });
        }
        for (const input of shadow.querySelectorAll("[data-url-input]")) {
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && input.value.trim()) citeUrlWidget(input.dataset.urlInput, input.value.trim());
          });
        }
      }
    }

    function saveSettings() {
      lsSet(SETTINGS_KEY, JSON.stringify(settings));
    }

    // ── loop ──
    setInterval(() => {
      if (!inflight && !document.hidden && Date.now() - lastCheckEnd >= CHECK_INTERVAL_MS) {
        cycle();
      } else if (expanded && !inflight) {
        // Targeted countdown update — a full render() every second would reset
        // the list scroll and close open dropdowns.
        const el = shadow.getElementById("countdownTxt");
        if (el) el.textContent = `next check in ${Math.max(0, Math.ceil((CHECK_INTERVAL_MS - (Date.now() - lastCheckEnd)) / 1000))}s`;
      }
    }, 1000);
    fetchServerStatus();
    setInterval(fetchServerStatus, 30_000);
    cycle();
  }

  /* ════════════════════════════════════════════════════════════════════════
     FIELD MODE — any other site: ordinary editable fields, in-place fixes.
     Money rule: automatic 10s checking runs ONLY when this site is enabled
     ("tracely.site.enabled"). Otherwise nothing is sent until the user clicks.
     ════════════════════════════════════════════════════════════════════════ */
  function fieldMode() {
    const SITE_KEY = "tracely.site.enabled";
    const SETTINGS_KEY = "tracely.widget.settings";
    const DISMISS_KEY = "tracely.widget.dismissed.field"; // localStorage is origin-scoped → per-site

    // Per-site enable lives in chrome.storage.local ("enabledSites": [origin])
    // so the options page can list and manage it. The old per-site localStorage
    // flag is kept in sync (and migrated in) for back-compat and for plain
    // test pages without extension APIs.
    const extStorage = useRelay && typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
    let siteOn = lsGet(SITE_KEY) === "1"; // seed from the legacy flag, then sync below
    const siteEnabled = () => siteOn;
    if (extStorage) {
      chrome.storage.local.get({ enabledSites: [] }, (st) => {
        const list = Array.isArray(st.enabledSites) ? st.enabledSites : [];
        if (siteOn && !list.includes(location.origin)) {
          chrome.storage.local.set({ enabledSites: [...list, location.origin] }); // migrate legacy opt-in
        } else if (siteOn !== list.includes(location.origin)) {
          siteOn = list.includes(location.origin);
          lsSet(SITE_KEY, siteOn ? "1" : "0");
          if (widget) render();
        }
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.enabledSites) return;
        const on = (changes.enabledSites.newValue ?? []).includes(location.origin);
        if (on !== siteOn) {
          siteOn = on;
          lsSet(SITE_KEY, on ? "1" : "0");
          if (widget) render();
        }
      });
    }

    // ── engine (server | standalone | offline) — learned from the background ──
    let engine = { mode: "server", hasKey: true };
    const isStandalone = () => engine.mode === "standalone";
    async function refreshEngine() {
      if (!useRelay) return;
      try {
        const s = await chrome.runtime.sendMessage({ type: "tracely-getState" });
        if (s?.ok) {
          const changed = s.mode !== engine.mode;
          engine = s;
          if (changed && widget) render();
        }
      } catch { /* extension reloaded mid-flight */ }
    }
    refreshEngine();
    setInterval(refreshEngine, 30_000);

    // ── state (mirrors docs mode) ──
    const cache = new Map();
    const dismissed = new Set(jsonParse(lsGet(DISMISS_KEY) ?? "[]", []));
    const sourcesMap = new Map();
    let settings = { model: "claude-haiku-4-5", effort: "low", ...jsonParse(lsGet(SETTINGS_KEY) ?? "{}", {}) };
    let segments = [];
    let inflight = false;
    let sourcesInflight = false;
    let lastCheckEnd = Date.now();
    let statusMsg = siteEnabled() ? "waiting for a text field…" : "auto-check off — click to check";
    let statusKind = "idle"; // idle | checking | error | offline
    let expanded = false;
    let fieldText = "";
    let copiedFixHash = null;
    const fieldFixed = new Set();
    let autoSourceTimes = [];
    let tracked = null;       // the editable element we watch
    let checkedOnce = false;  // pill leaves its quiet state after the first check

    let widget = null; // created lazily — pages without qualifying fields get zero UI
    function ensureWidget() {
      if (!widget) widget = makeWidget();
      return widget;
    }

    /* ── editable tracking ── */

    const SECURE_RE = /passw|secret|token|otp|2fa|cvc|cvv|card[-_ ]?num|ssn|social[-_ ]?security|\bpin\b/i;
    function looksSecure(el) {
      const hints = [
        el.getAttribute?.("name"), el.id, el.getAttribute?.("aria-label"),
        el.getAttribute?.("autocomplete"), el.getAttribute?.("placeholder"),
      ].filter(Boolean).join(" ");
      return SECURE_RE.test(hints);
    }

    // Resolve a focus target to the editable we should track, or null.
    // <input> never qualifies (short, and where the secure stuff lives).
    function resolveEditable(target) {
      if (!(target instanceof Element)) return null;
      if (widget && (target === widget.host || widget.host.contains(target))) return null; // our own shadow DOM
      if (target instanceof HTMLInputElement) return null;
      if (target instanceof HTMLTextAreaElement) return looksSecure(target) ? null : target;
      if (target.isContentEditable) {
        let top = target;
        while (top.parentElement && top.parentElement.isContentEditable) top = top.parentElement;
        const attr = top.getAttribute("contenteditable");
        if (attr !== null && attr !== "" && attr.toLowerCase() !== "true") return null; // plaintext-only etc.
        return looksSecure(top) ? null : top;
      }
      return null;
    }

    /* ── canonical text index for contenteditable (ports public/app/analyze.js) ── */

    const BLOCK_TAGS = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "TR", "SECTION", "ARTICLE"]);

    function buildTextIndex(rootEl) {
      let text = "";
      const nodeSegs = [];
      (function walk(node) {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const data = child.data.replace(/ /g, " "); // NBSP → space, 1:1
            nodeSegs.push({ node: child, start: text.length, end: text.length + data.length });
            text += data;
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.nodeName === "BR") { text += "\n"; continue; }
            const isBlock = BLOCK_TAGS.has(child.nodeName);
            if (isBlock && text.length > 0 && !text.endsWith("\n")) text += "\n";
            walk(child);
            if (isBlock && text.length > 0 && !text.endsWith("\n")) text += "\n";
          }
        }
      })(rootEl);
      return { text, segments: nodeSegs };
    }

    function rangeForOffsets(index, start, end) {
      const segs = index.segments;
      let a = null;
      let b = null;
      for (const seg of segs) {
        if (a == null && start >= seg.start && start < seg.end) a = { node: seg.node, off: start - seg.start };
        if (end > seg.start && end <= seg.end) b = { node: seg.node, off: end - seg.start };
      }
      if (a == null) {
        for (const seg of segs) {
          if (start === seg.end) { a = { node: seg.node, off: seg.end - seg.start }; break; }
        }
      }
      if (a == null || b == null) return null;
      const range = document.createRange();
      try {
        range.setStart(a.node, a.off);
        range.setEnd(b.node, b.off);
      } catch { return null; }
      return range;
    }

    function readField(el) {
      if (el instanceof HTMLTextAreaElement) return el.value;
      return buildTextIndex(el).text;
    }

    function fieldEligible() {
      if (!tracked || !tracked.isConnected) return false;
      const len = (tracked instanceof HTMLTextAreaElement ? tracked.value : tracked.textContent ?? "").trim().length;
      return len >= MIN_FIELD_CHARS;
    }

    /* ── Grammarly-style overlay underlines (ports the Ethos technique) ──
       A fixed, pointer-events-none layer holds one absolutely-positioned bar
       per line-box of each flagged sentence. Textareas are measured through
       an offscreen mirror div; contenteditable through offset→Range rects on
       the existing canonical text index. Repositioning is rAF-throttled off
       input/scroll/resize; clicks are hit-tested manually since the layer
       never intercepts pointer events. */

    let overlayEl = null;
    let mirror = null;
    const markRects = new Map(); // hash → visible rects (issue marks only — used for hit-testing)
    let marksRaf = null;

    function ensureOverlay() {
      if (overlayEl && overlayEl.isConnected) return overlayEl;
      overlayEl = document.createElement("div");
      overlayEl.id = "tracely-marks";
      Object.assign(overlayEl.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483646" });
      document.documentElement.appendChild(overlayEl);
      return overlayEl;
    }

    // Offscreen mirror-div measurement for textarea sentence rects.
    function taRects(el, start, end) {
      const cs = getComputedStyle(el);
      if (!mirror) {
        mirror = document.createElement("div");
        document.documentElement.appendChild(mirror);
      }
      Object.assign(mirror.style, {
        position: "fixed", left: "-10000px", top: "0", visibility: "hidden",
        whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: cs.wordBreak,
        width: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + "px",
        font: cs.font, letterSpacing: cs.letterSpacing, tabSize: cs.tabSize,
      });
      const text = el.value;
      mirror.textContent = "";
      mirror.append(document.createTextNode(text.slice(0, start)));
      const span = document.createElement("span");
      span.textContent = text.slice(start, end);
      mirror.append(span, document.createTextNode(text.slice(end)));
      const mBox = mirror.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const padL = parseFloat(cs.paddingLeft), padT = parseFloat(cs.paddingTop);
      const bordL = parseFloat(cs.borderLeftWidth), bordT = parseFloat(cs.borderTopWidth);
      const out = [];
      for (const r of span.getClientRects()) {
        const x = box.left + bordL + padL + (r.left - mBox.left) - el.scrollLeft;
        const y = box.top + bordT + padT + (r.top - mBox.top) - el.scrollTop;
        if (y + r.height < box.top || y > box.bottom) continue; // clip to the visible box
        out.push({ left: x, top: y, width: r.width, height: r.height });
      }
      return out;
    }

    // Offset→Range rects for contenteditable, via the canonical text index.
    function ceRects(el, index, start, end) {
      const range = rangeForOffsets(index, start, end);
      if (!range) return [];
      const box = el.getBoundingClientRect();
      const out = [];
      for (const r of range.getClientRects()) {
        if (r.width === 0) continue;
        if (r.bottom < box.top || r.top > box.bottom) continue; // clip to the visible box
        out.push({ left: r.left, top: r.top, width: r.width, height: r.height });
      }
      return out;
    }

    function scheduleMarks() {
      if (marksRaf) return;
      marksRaf = requestAnimationFrame(() => { marksRaf = null; drawMarks(); });
    }

    function drawMarks() {
      if (!overlayEl && !(tracked && tracked.isConnected)) return; // nothing drawn, nothing to clear
      const layer = ensureOverlay();
      layer.textContent = "";
      markRects.clear();
      if (!tracked || !tracked.isConnected) return;
      const isTa = tracked instanceof HTMLTextAreaElement;
      let index = null;
      let liveText;
      if (isTa) {
        liveText = tracked.value;
      } else {
        index = buildTextIndex(tracked);
        liveText = index.text;
      }
      if (liveText.trim().length < MIN_FIELD_CHARS) return;
      const seen = new Set();
      for (const seg of segmentText(liveText)) {
        if (!seg.checkable || seen.has(seg.hash) || dismissed.has(seg.hash)) continue;
        seen.add(seg.hash);
        const f = cache.get(seg.hash);
        let color = null;
        let pending = false;
        if (f && ISSUE_VERDICTS.includes(f.verdict)) {
          color = MARK_COLORS[f.verdict];
        } else if (!f && inflight) {
          color = MARK_PENDING; // awaiting a verdict this cycle
          pending = true;
        } else {
          continue;
        }
        const rects = isTa ? taRects(tracked, seg.start, seg.end) : ceRects(tracked, index, seg.start, seg.end);
        if (rects.length === 0) continue;
        if (!pending) markRects.set(seg.hash, rects);
        for (const r of rects) {
          const bar = document.createElement("div");
          Object.assign(bar.style, {
            position: "fixed", left: r.left + "px", top: r.top + "px",
            width: r.width + "px", height: r.height + "px",
            borderBottom: pending ? `2px dotted ${color}` : `2px solid ${color}`,
            background: pending ? "transparent" : color + "14", // very faint wash
            borderRadius: "2px",
          });
          layer.appendChild(bar);
        }
      }
    }

    function hitMark(x, y) {
      for (const [h, rects] of markRects) {
        for (const r of rects) {
          if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height + 2) return h;
        }
      }
      return null;
    }

    let flashTimer = null;
    function flashCard(hash) {
      if (!widget) return;
      const card = widget.shadow.querySelector(`[data-card="${hash}"]`);
      if (!card) return;
      card.scrollIntoView({ block: "nearest" });
      card.classList.add("flash");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => card.classList.remove("flash"), 1300);
    }

    // Clicking an underline opens the panel and flashes that verdict's card.
    document.addEventListener("mousedown", (e) => {
      if (widget && e.composedPath().includes(widget.host)) return;
      const h = hitMark(e.clientX, e.clientY);
      if (!h) return;
      expanded = true;
      ensureWidget();
      render();
      flashCard(h);
    }, true);

    document.addEventListener("input", (e) => {
      if (tracked && (e.target === tracked || (tracked.contains && tracked.contains(e.target)))) scheduleMarks();
    }, true);
    document.addEventListener("scroll", () => scheduleMarks(), true);
    window.addEventListener("resize", () => scheduleMarks());

    /* ── check pipeline (same guards as docs mode) ── */

    function uncheckedSegments() {
      const out = [];
      const seen = new Set();
      for (const seg of segments) {
        if (!seg.checkable || seen.has(seg.hash)) continue;
        seen.add(seg.hash);
        if (cache.has(seg.hash)) continue;
        out.push(seg);
      }
      return out;
    }

    function currentIssues() {
      const out = [];
      const seen = new Set();
      for (const seg of segments) {
        if (!seg.checkable || seen.has(seg.hash)) continue;
        seen.add(seg.hash);
        const f = cache.get(seg.hash);
        if (!f || dismissed.has(seg.hash) || !ISSUE_VERDICTS.includes(f.verdict)) continue;
        out.push({ seg, f });
      }
      return out;
    }

    async function cycle() {
      if (inflight || document.hidden) return;
      if (!tracked || !tracked.isConnected) {
        statusKind = "idle";
        statusMsg = "click into a text field first";
        render();
        return;
      }
      inflight = true;
      try {
        fieldText = readField(tracked);
        if (fieldText.trim().length < MIN_FIELD_CHARS) {
          statusKind = "idle";
          statusMsg = `field under ${MIN_FIELD_CHARS} characters — keep writing`;
          segments = [];
          return;
        }
        segments = segmentText(fieldText);
        const todo = uncheckedSegments().slice(0, MAX_SENTENCES_PER_CHECK);
        if (todo.length > 0) {
          statusKind = "checking";
          statusMsg = `checking ${todo.length}…`;
          render();
          const data = await api("/api/check", {
            text: fieldText.slice(0, MAX_INPUT_CHARS),
            sentences: todo.map((s) => ({ id: s.hash, text: s.text })),
            model: settings.model,
            effort: settings.effort,
          });
          checkedOnce = true;
          for (const f of data.findings ?? []) {
            cache.set(f.id, { verdict: f.verdict, explanation: f.explanation, revision: f.revision, confidence: f.confidence });
          }
          autoFindSources(data.findings ?? []); // fire-and-forget, capped
        }
        statusKind = "idle";
        const n = currentIssues().length;
        statusMsg = n > 0 ? `${n} issue${n === 1 ? "" : "s"} found` : "all clear";
      } catch (err) {
        if (err?.kind === "no_key") {
          statusKind = "error";
          statusMsg = "add ANTHROPIC_API_KEY to tracely/.env";
        } else if (err?.kind === "no_engine") {
          statusKind = "offline";
          statusMsg = err.message;
        } else if (offlineError(err)) {
          statusKind = "offline";
          statusMsg = "Tracely offline — start the server or add an API key in options";
        } else {
          statusKind = "error";
          statusMsg = err?.message ?? "check failed";
        }
      } finally {
        inflight = false;
        lastCheckEnd = Date.now();
        render();
      }
    }

    async function fetchSources(hash, auto = false) {
      if (sourcesInflight) return;
      const seg = segments.find((s) => s.hash === hash);
      if (!seg) return;
      const f = cache.get(hash);
      sourcesInflight = true;
      sourcesMap.set(hash, { loading: true, list: null, copiedUrl: null });
      render();
      try {
        const data = await api("/api/sources", {
          claim: seg.text,
          correction: f?.revision || undefined,
          context: fieldText.slice(0, 6000),
          model: settings.model,
        });
        sourcesMap.set(hash, { loading: false, list: data.sources ?? [], copiedUrl: null });
      } catch (err) {
        sourcesMap.delete(hash);
        if (!auto) statusKind = "error";
        statusMsg = err?.message ?? "source search failed";
      } finally {
        sourcesInflight = false;
        render();
      }
    }

    // Auto-sources — same toggle and rolling-hour guard as docs mode. Only
    // reachable after a check, which on a non-enabled site takes a click.
    async function autoFindSources(findings) {
      if (settings.autoSources !== true) return; // cost: auto web-search is opt-in
      let started = 0;
      for (const f of findings) {
        if (started >= 3) break;
        if (!AUTO_SOURCE_VERDICTS.includes(f.verdict)) continue;
        if (sourcesMap.has(f.id) || dismissed.has(f.id)) continue;
        if (!segments.some((s) => s.hash === f.id)) continue;
        autoSourceTimes = autoSourceTimes.filter((t) => Date.now() - t < 3_600_000);
        if (autoSourceTimes.length >= 15) { statusMsg = "auto-sources paused — hourly cap"; break; }
        autoSourceTimes.push(Date.now()); // stamp BEFORE the call
        started++;
        await fetchSources(f.id, true); // sequential: one paid search at a time
      }
    }

    async function citeUrlWidget(hash, rawUrl) {
      try {
        const data = await api("/api/cite-url", { url: rawUrl });
        const src = data.source;
        const st = sourcesMap.get(hash) ?? { loading: false, list: [], copiedUrl: null };
        st.loading = false;
        st.list = st.list ?? [];
        if (!st.list.some((s) => s.url === src.url)) st.list.unshift(src);
        sourcesMap.set(hash, st);
        statusKind = "idle";
        statusMsg = "source added — use Copy cite";
      } catch (e) {
        statusKind = "error";
        statusMsg = e?.message ?? "couldn't cite that URL";
      }
      render();
    }

    function copyText(text, hash, url) {
      navigator.clipboard?.writeText(text).catch(() => {});
      if (hash && url) {
        const st = sourcesMap.get(hash);
        if (st) st.copiedUrl = url;
      }
      render();
    }

    /* ── in-place fix — the point of field mode ── */

    function nativeValueSetter() {
      return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set ?? null;
    }

    function fixInField(hash) {
      const f = cache.get(hash);
      if (!f?.revision) return;
      const known = segments.find((s) => s.hash === hash);

      // Fallback when the live range can't be located (framework re-rendered,
      // field gone, execCommand refused): copy instead, and say so.
      const fallbackCopy = () => {
        copiedFixHash = hash;
        navigator.clipboard?.writeText(known ? withMarkers(known.text, f.revision) : f.revision).catch(() => {});
        statusKind = "idle";
        statusMsg = "couldn't edit in place — copied instead";
      };

      const el = tracked;
      if (!el || !el.isConnected) { fallbackCopy(); render(); return; }

      try {
        if (el instanceof HTMLTextAreaElement) {
          // Recompute the sentence's range against the CURRENT value.
          const seg = segmentText(el.value).find((s) => s.hash === hash);
          if (!seg) { fallbackCopy(); render(); return; }
          const replacement = withMarkers(seg.text, f.revision);
          el.focus();
          el.setRangeText(replacement, seg.start, seg.end, "end");
          // Controlled inputs (React et al.): re-assert through the native
          // setter so the framework's value tracker sees the change, then
          // dispatch input so it re-renders from the new value.
          nativeValueSetter()?.call(el, el.value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          // contenteditable: map sentence offsets onto text-node ranges, then
          // insertText over the selection so the page's own undo stack works.
          const index = buildTextIndex(el);
          const seg = segmentText(index.text).find((s) => s.hash === hash);
          const range = seg ? rangeForOffsets(index, seg.start, seg.end) : null;
          if (!range) { fallbackCopy(); render(); return; }
          const replacement = withMarkers(seg.text, f.revision);
          el.focus();
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          let ok = false;
          try { ok = document.execCommand("insertText", false, replacement); } catch { ok = false; }
          if (!ok) { sel.removeAllRanges(); fallbackCopy(); render(); return; }
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        fieldFixed.add(hash);
        cache.delete(hash); // the rewritten sentence gets re-verified on the next read
        statusKind = "idle";
        statusMsg = "fixed in field";
        lastCheckEnd = Date.now() - CHECK_INTERVAL_MS + 3000; // re-read soon
      } catch {
        fallbackCopy();
      }
      render();
    }

    /* ── per-site opt-in ── */

    function setSiteEnabled(on) {
      siteOn = on;
      lsSet(SITE_KEY, on ? "1" : "0");
      if (extStorage) {
        chrome.storage.local.get({ enabledSites: [] }, (st) => {
          const list = (Array.isArray(st.enabledSites) ? st.enabledSites : []).filter((o) => o !== location.origin);
          if (on) list.push(location.origin);
          chrome.storage.local.set({ enabledSites: list });
        });
      }
      if (on) {
        statusMsg = "auto-check on for this site";
        lastCheckEnd = 0;
        cycle(); // the toggle click is the prompt
      } else {
        statusKind = "idle";
        statusMsg = "auto-check off — click to check";
      }
      render();
    }

    /* ── render ── */

    function render() {
      scheduleMarks(); // keep in-page underlines in step with every state change
      if (!widget) return;
      const { shadow, root } = widget;
      const enabled = siteEnabled();
      const show = Boolean(tracked && (expanded || fieldEligible() || segments.length > 0));
      root.style.display = show ? "" : "none";

      const issues = currentIssues();
      const quiet = !enabled && !checkedOnce && !inflight && statusKind === "idle";
      const countdown = Math.max(0, Math.ceil((CHECK_INTERVAL_MS - (Date.now() - lastCheckEnd)) / 1000));
      const countCls = statusKind === "offline" || statusKind === "error" ? "off" : issues.length > 0 ? "" : "ok";
      const countTxt = statusKind === "offline" ? "off" : inflight ? "…" : issues.length > 0 ? String(issues.length) : "✓";

      let panelHtml = "";
      if (expanded) {
        const cards = issues.map(({ seg, f }) => {
          const kind = f.verdict === "false" ? "false" : f.verdict === "questionable" ? "quest" : "inco";
          const st = sourcesMap.get(seg.hash);
          let sourcesHtml = "";
          if (st?.loading) {
            sourcesHtml = `<div class="sources"><div class="loading">Searching the web for sources…</div></div>`;
          } else if (st?.list?.length) {
            sourcesHtml = `<div class="sources"><div class="sources-title">Sources — copy one to cite</div>` +
              st.list.map((src, i) => `
                <div class="src">
                  <span class="stance st-${esc(src.stance)}">${esc(src.stance)}</span>
                  <div class="src-body">
                    <a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>
                    <div class="src-meta">${esc(src.publisher)}</div>
                    ${src.snippet ? `<div class="src-snip">${esc(src.snippet)}</div>` : ""}
                  </div>
                  <button class="act" data-copy-src="${seg.hash}" data-i="${i}">${st.copiedUrl === src.url ? "Copied ✓" : "Copy cite"}</button>
                </div>`).join("") + `</div>`;
          }
          return `
          <div class="card c-${kind}" data-card="${seg.hash}">
            <div class="top">
              <span class="badge badge-${kind}">${VERDICT_LABEL[f.verdict]}</span>
              <button class="x" data-dismiss="${seg.hash}" title="Dismiss">✕</button>
            </div>
            <div class="quote">“${esc(seg.text.length > 140 ? seg.text.slice(0, 139) + "…" : seg.text)}”</div>
            ${f.explanation ? `<div class="expl">${esc(f.explanation)}</div>` : ""}
            ${f.revision ? `
            <div class="fix">
              <div class="fix-label">Suggested revision</div>
              <div class="fix-text">${esc(f.revision)}</div>
              <div class="row">
                <button class="act primary" data-field-fix="${seg.hash}">${fieldFixed.has(seg.hash) ? "Fixed ✓" : "Fix in field"}</button>
                <button class="act" data-copy-fix="${seg.hash}">${copiedFixHash === seg.hash ? "Copied ✓" : "Copy fix"}</button>
                <button class="act" data-sources="${seg.hash}">Find sources</button>
              </div>
            </div>` : `<div class="row"><button class="act" data-sources="${seg.hash}">Find sources</button></div>`}
            ${sourcesHtml}
            ${isStandalone() ? "" : `<div class="cite-url"><input type="url" placeholder="Or paste a URL you found…" data-url-input="${seg.hash}" /><button class="act" data-url-add="${seg.hash}">Cite</button></div>`}
          </div>`;
        }).join("");

        const emptyMsg = statusKind === "offline"
          ? "Start the Tracely server — or add an API key in Tracely options — then try again."
          : enabled
            ? "Nothing flagged. Checking every 10s while this field is focused."
            : "Nothing sent yet. “Check once” reviews this field — or turn on auto-check for this site.";

        panelHtml = `
        <div class="panel">
          <div class="head" id="dragHead">
            <span class="plane">${PLANE_SVG}</span>
            <span class="name">Tracely</span>
            <label class="autosrc" title="Run automatic checks on this site every 10s. Off: nothing is sent until you click."><input type="checkbox" id="siteTgl"${enabled ? " checked" : ""} /><span>Auto-check on this site</span></label>
            <span class="status ${statusKind === "error" || statusKind === "offline" ? "error" : ""}">${esc(statusMsg)}</span>
          </div>
          <div class="selects">
            <select id="modelSel">
              <option value="claude-opus-5"${settings.model === "claude-opus-5" ? " selected" : ""}>Opus 5 · sharpest</option>
              <option value="claude-sonnet-5"${settings.model === "claude-sonnet-5" ? " selected" : ""}>Sonnet 5 · balanced</option>
              <option value="claude-haiku-4-5"${settings.model === "claude-haiku-4-5" ? " selected" : ""}>Haiku 4.5 · fastest</option>
            </select>
            <select id="effortSel">
              <option value="low"${settings.effort === "low" ? " selected" : ""}>Fast</option>
              <option value="medium"${settings.effort === "medium" ? " selected" : ""}>Balanced</option>
              <option value="high"${settings.effort === "high" ? " selected" : ""}>Thorough</option>
            </select>
            <label class="autosrc" title="Automatically look up sources for flagged claims (capped)"><input type="checkbox" id="autoSrcTgl"${settings.autoSources === true ? " checked" : ""} /><span>Auto-src</span></label>
            <button class="act" id="checkNow" style="margin-left:auto">${enabled ? "Check now" : "Check once"}</button>
          </div>
          <div class="list">
            ${cards || `<div class="empty">${emptyMsg}</div>`}
          </div>
          <div class="foot">
            <span id="countdownTxt">${inflight ? "checking…" : enabled ? `next check in ${countdown}s` : "auto-check off — checks run only when you click"}</span>
            <span>${isStandalone() ? "standalone — key goes only to api.anthropic.com" : "fixes apply in the field"}</span>
          </div>
        </div>`;
      }

      const prevScroll = shadow.querySelector(".list")?.scrollTop ?? 0;
      root.innerHTML = `
        ${panelHtml}
        <div class="pill${quiet ? " quiet" : ""}" id="pill">
          <span class="plane">${PLANE_SVG}</span>
          ${quiet ? "Check this field" : "Tracely"}
          ${quiet ? "" : `<span class="count ${countCls}">${countTxt}</span>`}
        </div>
      `;
      const listEl = shadow.querySelector(".list");
      if (listEl) listEl.scrollTop = prevScroll;

      shadow.getElementById("pill").addEventListener("click", () => { expanded = !expanded; render(); });
      if (expanded) {
        shadow.getElementById("siteTgl").addEventListener("change", (e) => setSiteEnabled(e.target.checked));
        shadow.getElementById("modelSel").addEventListener("change", (e) => { settings.model = e.target.value; saveSettings(); });
        shadow.getElementById("effortSel").addEventListener("change", (e) => { settings.effort = e.target.value; saveSettings(); });
        shadow.getElementById("checkNow").addEventListener("click", () => { lastCheckEnd = 0; cycle(); });
        for (const btn of shadow.querySelectorAll("[data-dismiss]")) {
          btn.addEventListener("click", () => {
            dismissed.add(btn.dataset.dismiss);
            lsSet(DISMISS_KEY, JSON.stringify([...dismissed]));
            render();
          });
        }
        for (const btn of shadow.querySelectorAll("[data-field-fix]")) {
          btn.addEventListener("click", () => fixInField(btn.dataset.fieldFix));
        }
        for (const btn of shadow.querySelectorAll("[data-copy-fix]")) {
          btn.addEventListener("click", () => {
            const f = cache.get(btn.dataset.copyFix);
            if (f?.revision) { copiedFixHash = btn.dataset.copyFix; copyText(f.revision); }
          });
        }
        for (const btn of shadow.querySelectorAll("[data-sources]")) {
          btn.addEventListener("click", () => fetchSources(btn.dataset.sources));
        }
        for (const btn of shadow.querySelectorAll("[data-copy-src]")) {
          btn.addEventListener("click", () => {
            const st = sourcesMap.get(btn.dataset.copySrc);
            const src = st?.list?.[Number(btn.dataset.i)];
            if (src) copyText(`${src.title} — ${src.url}`, btn.dataset.copySrc, src.url);
          });
        }
        shadow.getElementById("autoSrcTgl")?.addEventListener("change", (e) => {
          settings.autoSources = e.target.checked;
          saveSettings();
        });
        for (const btn of shadow.querySelectorAll("[data-url-add]")) {
          btn.addEventListener("click", () => {
            const input = shadow.querySelector(`[data-url-input="${btn.dataset.urlAdd}"]`);
            if (input?.value.trim()) citeUrlWidget(btn.dataset.urlAdd, input.value.trim());
          });
        }
        for (const input of shadow.querySelectorAll("[data-url-input]")) {
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && input.value.trim()) citeUrlWidget(input.dataset.urlInput, input.value.trim());
          });
        }
      }
    }

    function saveSettings() {
      lsSet(SETTINGS_KEY, JSON.stringify(settings));
    }

    /* ── focus tracking + loop ── */

    document.addEventListener("focusin", (e) => {
      const el = resolveEditable(e.target);
      if (el && el !== tracked) {
        tracked = el;
        segments = [];
        statusKind = "idle";
        statusMsg = siteEnabled() ? "watching this field" : "auto-check off — click to check";
        ensureWidget();
        render();
      }
      // Focus moving elsewhere (including into our widget) keeps the tracked
      // field, so panel buttons can still act on it.
    }, true);

    // Pick up a field that was already focused when we loaded.
    const initial = resolveEditable(document.activeElement);
    if (initial) {
      tracked = initial;
      ensureWidget();
      render();
    }

    setInterval(() => {
      if (tracked && !tracked.isConnected) {
        tracked = null;
        segments = [];
        scheduleMarks(); // clear any leftover underline bars
        if (widget) render();
        return;
      }
      if (!tracked || !widget) return;
      if (siteEnabled() && !inflight && !document.hidden && fieldEligible()
          && Date.now() - lastCheckEnd >= CHECK_INTERVAL_MS) {
        cycle(); // opted-in automatic path — still floored at 10s + hash cache
      } else if (expanded && !inflight) {
        const el = widget.shadow.getElementById("countdownTxt");
        if (el && siteEnabled()) el.textContent = `next check in ${Math.max(0, Math.ceil((CHECK_INTERVAL_MS - (Date.now() - lastCheckEnd)) / 1000))}s`;
      } else if (!expanded) {
        // Keep pill visibility fresh as the field grows/shrinks — no re-render.
        const show = Boolean(tracked && (fieldEligible() || segments.length > 0));
        widget.root.style.display = show ? "" : "none";
      }
    }, 1000);
    // Deliberately NO startup network calls in field mode: on a non-enabled
    // site, nothing is sent anywhere until the user clicks.
  }
})();
