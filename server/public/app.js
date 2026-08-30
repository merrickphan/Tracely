/* Tracely frontend — watches typing, checks every 10s, renders wavy underlines,
   suggests fixes, and pulls up sources you can cite. */
"use strict";

const CHECK_INTERVAL_MS = 10_000;
const MAX_SENTENCES_PER_CHECK = 40;
const STORAGE_KEY = "tracely.v1";

const $ = (id) => document.getElementById(id);
const editor = $("editor");
const backdrop = $("backdrop");
const editorWrap = $("editorWrap");
const cardsEl = $("cards");
const emptyState = $("emptyState");
const tooltip = $("tooltip");

// ── state ──────────────────────────────────────────────────────────────
const cache = new Map();      // hash → finding {verdict, explanation, revision, confidence}
const dismissed = new Set();  // hash
const pending = new Set();    // hashes currently in-flight
const sourcesMap = new Map(); // hash → {loading, list: [{title,url,publisher,snippet,stance}], chosenUrl}
let segments = [];            // [{hash, text, start, end, checkable}]
let inflight = false;
let sourcesInflight = false;
let lastCheckEnd = Date.now();
let hasKey = false;
let totalUsage = { input: 0, output: 0 };
let lastError = null;
let autoRetryBlocked = false; // deterministic failure (bad_request): wait for an edit
let rateLimitedUntil = 0;     // honor the server's retry-after on 429s
let autoSourceTimes = [];     // rolling-hour spend guard for automatic source lookups

// Auto-source caps — two caps, per the build reference: a per-cycle cap assumes
// cycles are meaningful units; the rolling window holds when they aren't.
const AUTO_SOURCE_VERDICTS = ["false", "questionable"];
const AUTO_SOURCES_PER_CYCLE = 3;
const AUTO_SOURCES_PER_HOUR = 15;

// ── persistence ────────────────────────────────────────────────────────
function saveState() {
  try {
    const sources = [...sourcesMap.entries()]
      .filter(([, v]) => v.list?.length)
      .map(([k, v]) => [k, { list: v.list, chosenUrl: v.chosenUrl ?? null }]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      text: editor.value,
      cache: [...cache.entries()],
      dismissed: [...dismissed],
      sources,
      model: $("modelSelect").value,
      effort: $("effortSelect").value,
      autoSources: $("autoSources").checked,
    }));
  } catch { /* storage full or unavailable — nonfatal */ }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.text === "string") editor.value = s.text;
    for (const [k, v] of s.cache ?? []) cache.set(k, v);
    for (const h of s.dismissed ?? []) dismissed.add(h);
    for (const [k, v] of s.sources ?? []) sourcesMap.set(k, { loading: false, list: v.list, chosenUrl: v.chosenUrl });
    if (s.model) $("modelSelect").value = s.model;
    if (s.effort) $("effortSelect").value = s.effort;
    if (typeof s.autoSources === "boolean") $("autoSources").checked = s.autoSources;
  } catch { /* corrupt state — start fresh */ }
}

// ── segmentation ───────────────────────────────────────────────────────
function hashText(s) {
  const norm = s.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  return "s" + h.toString(36);
}

function segmentText(text) {
  const segs = [];
  const block = sourcesBlock(text);
  const lineRe = /[^\n]+/g;
  let lm;
  while ((lm = lineRe.exec(text))) {
    const line = lm[0];
    const base = lm.index;
    if (block && base >= block.headStart && base < block.end) continue; // don't fact-check the bibliography
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

// The "Sources:" bibliography block: header line + consecutive "N. Title — URL"
// entry lines. Bounded, so prose written after the block is still fact-checked.
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
  return { headStart, bodyStart, end: pos, entries };
}

// ── rendering ──────────────────────────────────────────────────────────
const VERDICT_CLASS = { false: "v-false", questionable: "v-quest", incoherent: "v-inco", accurate: "v-ok" };
const VERDICT_LABEL = { false: "False", questionable: "Questionable", incoherent: "Doesn't make sense", accurate: "Verified" };
const ISSUE_VERDICTS = ["false", "questionable", "incoherent"];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function markClass(seg) {
  if (!seg.checkable) return null;
  if (pending.has(seg.hash)) return cache.has(seg.hash) ? null : "v-pending";
  const f = cache.get(seg.hash);
  if (!f) return null;
  if (dismissed.has(seg.hash)) return null;
  return VERDICT_CLASS[f.verdict] ?? null;
}

function renderBackdrop() {
  const text = editor.value;
  let html = "";
  let pos = 0;
  for (const seg of segments) {
    const cls = markClass(seg);
    if (!cls) continue;
    html += esc(text.slice(pos, seg.start));
    html += `<mark class="${cls}" data-h="${seg.hash}">${esc(text.slice(seg.start, seg.end))}</mark>`;
    pos = seg.end;
  }
  html += esc(text.slice(pos));
  if (text.endsWith("\n")) html += " ";
  backdrop.innerHTML = html;
  syncScroll();
}

function syncScroll() {
  backdrop.scrollTop = editor.scrollTop;
  backdrop.scrollLeft = editor.scrollLeft;
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

function renderCards() {
  const prevScroll = cardsEl.scrollTop; // keep the user's place — re-renders happen on every keystroke
  const issues = currentIssues();
  const verified = [];
  const seen = new Set();
  for (const seg of segments) {
    if (!seg.checkable || seen.has(seg.hash)) continue;
    seen.add(seg.hash);
    const f = cache.get(seg.hash);
    if (f?.verdict === "accurate") verified.push({ seg, f });
  }

  $("panelCount").textContent = String(issues.length);
  emptyState.classList.toggle("hidden", issues.length > 0);
  const fixable = issues.filter((i) => i.f.revision).length;
  const fixAllBtn = $("fixAllBtn");
  fixAllBtn.classList.toggle("hidden", fixable < 2);
  fixAllBtn.textContent = `Fix all (${fixable})`;

  for (const el of cardsEl.querySelectorAll(".card")) el.remove();
  for (const { seg, f } of issues) {
    const card = document.createElement("div");
    const kind = f.verdict === "false" ? "false" : f.verdict === "questionable" ? "quest" : "inco";
    card.className = `card c-${kind}`;
    card.dataset.h = seg.hash;
    card.innerHTML = `
      <div class="card-top">
        <span class="badge badge-${kind}">${VERDICT_LABEL[f.verdict]}</span>
        <span class="conf">${f.confidence} confidence</span>
        <button class="dismiss" title="Dismiss">✕</button>
      </div>
      <div class="card-quote" title="Jump to sentence">“${esc(truncate(seg.text, 160))}”</div>
      ${f.explanation ? `<div class="card-expl">${esc(f.explanation)}</div>` : ""}
      ${f.revision ? `
      <div class="card-fix">
        <div class="card-fix-label">Suggested revision</div>
        <div class="card-fix-text">${esc(f.revision)}</div>
        <div class="card-actions">
          <button class="apply-btn">Apply fix</button>
          <button class="sources-btn">Find sources</button>
        </div>
      </div>` : `
      <div class="card-actions">
        <button class="sources-btn">Find sources</button>
      </div>`}
      <div class="sources-slot"></div>
    `;
    card.querySelector(".dismiss").addEventListener("click", () => {
      dismissed.add(seg.hash);
      refreshUI();
      saveState();
    });
    card.querySelector(".card-quote").addEventListener("click", () => jumpToSegment(seg.hash));
    const applyBtn = card.querySelector(".apply-btn");
    if (applyBtn) applyBtn.addEventListener("click", () => applyFix(seg.hash, f.revision));
    card.querySelector(".sources-btn").addEventListener("click", () => fetchSources(seg.hash));
    renderSourcesInto(card.querySelector(".sources-slot"), card.querySelector(".sources-btn"), seg.hash);
    cardsEl.appendChild(card);
  }

  cardsEl.scrollTop = prevScroll;

  $("verifiedCount").textContent = String(verified.length);
  $("verifiedSection").classList.toggle("hidden", verified.length === 0);
  const vl = $("verifiedList");
  vl.innerHTML = "";
  for (const { seg } of verified.slice(0, 30)) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${esc(truncate(seg.text, 90))}</span><button class="cite-btn">cite</button><div class="verified-sources"></div>`;
    li.querySelector(".cite-btn").addEventListener("click", () => fetchSources(seg.hash));
    renderSourcesInto(li.querySelector(".verified-sources"), li.querySelector(".cite-btn"), seg.hash);
    vl.appendChild(li);
  }
}

function renderSourcesInto(slot, triggerBtn, hash) {
  const st = sourcesMap.get(hash);
  slot.innerHTML = "";
  if (st && triggerBtn) triggerBtn.classList.add("hidden");
  if (st?.loading) {
    slot.innerHTML = `<div class="sources"><div class="sources-loading">Searching the web for sources…</div></div>`;
    return;
  }
  if (st?.list?.length) {
    const wrap = document.createElement("div");
    wrap.className = "sources";
    wrap.innerHTML = `<div class="sources-title">Sources — pick one to cite</div>`;
    for (const src of st.list) {
      const row = document.createElement("div");
      row.className = "source" + (st.chosenUrl === src.url ? " chosen" : "");
      row.innerHTML = `
        <span class="stance stance-${src.stance}">${src.stance}</span>
        <div class="source-body">
          <a class="source-title" href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>
          <div class="source-meta">${esc(src.publisher)}</div>
          ${src.snippet ? `<div class="source-snippet">${esc(src.snippet)}</div>` : ""}
        </div>
        <button class="use-source-btn">${st.chosenUrl === src.url ? "Cited ✓" : "Use"}</button>
      `;
      row.querySelector(".use-source-btn").addEventListener("click", () => insertCitation(hash, src));
      wrap.appendChild(row);
    }
    slot.appendChild(wrap);
  }
  // "Paste a URL and cite it" — always available, no model, no cost.
  const form = document.createElement("div");
  form.className = "cite-url";
  form.innerHTML = `<input type="url" placeholder="Or paste a URL you found…" /><button class="use-source-btn">Cite</button>`;
  const input = form.querySelector("input");
  const go = () => { if (input.value.trim()) { citeUrl(hash, input.value); input.value = ""; } };
  form.querySelector("button").addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  slot.appendChild(form);
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function renderStats() {
  const text = editor.value;
  const words = (text.match(/\S+/g) ?? []).length;
  const uniq = new Map();
  for (const s of segments) if (s.checkable && !uniq.has(s.hash)) uniq.set(s.hash, s);
  let checked = 0, issues = 0, accurate = 0, claims = 0;
  for (const [h] of uniq) {
    const f = cache.get(h);
    if (!f) continue;
    checked++;
    if (ISSUE_VERDICTS.includes(f.verdict)) issues++;
    if (f.verdict === "accurate") accurate++;
    if (f.verdict !== "no_claim") claims++;
  }
  $("statWords").textContent = `${words} word${words === 1 ? "" : "s"}`;
  $("statChecked").textContent = `${checked}/${uniq.size} sentences checked`;
  $("statIssues").textContent = `${issues} issue${issues === 1 ? "" : "s"}`;
  $("statVeracity").textContent = claims > 0 ? `${Math.round((accurate / claims) * 100)}% veracity` : "— veracity";
  $("statUsage").textContent = totalUsage.input + totalUsage.output > 0
    ? `${fmtTokens(totalUsage.input)} in / ${fmtTokens(totalUsage.output)} out`
    : "";
}

function fmtTokens(n) {
  return n >= 10_000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function refreshUI() {
  segments = segmentText(editor.value);
  renderBackdrop();
  renderCards();
  renderStats();
}

// ── check loop ─────────────────────────────────────────────────────────
function uncheckedSegments() {
  const out = [];
  const seen = new Set();
  for (const seg of segments) {
    if (!seg.checkable || seen.has(seg.hash)) continue;
    seen.add(seg.hash);
    if (cache.has(seg.hash) || pending.has(seg.hash)) continue;
    out.push(seg);
  }
  return out;
}

async function runCheck(force = false) {
  if (inflight || !hasKey) return;
  if (force) { autoRetryBlocked = false; rateLimitedUntil = 0; }
  const todo = uncheckedSegments().slice(0, MAX_SENTENCES_PER_CHECK);
  if (todo.length === 0) {
    if (force) toast("Everything is already checked.");
    lastCheckEnd = Date.now();
    return;
  }

  inflight = true;
  lastError = null;
  let newFindings = [];
  for (const s of todo) pending.add(s.hash);
  updateRing();
  renderBackdrop();
  setStatus(`checking ${todo.length} sentence${todo.length === 1 ? "" : "s"}…`);

  try {
    const res = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: editor.value.slice(0, 30_000), // server cap; sentences carry their own text
        sentences: todo.map((s) => ({ id: s.hash, text: s.text })),
        model: $("modelSelect").value,
        effort: $("effortSelect").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(data?.error?.message ?? `HTTP ${res.status}`), {
        kind: data?.error?.kind,
        retryAfter: data?.error?.retryAfter,
      });
    }
    newFindings = data.findings ?? [];
    for (const f of newFindings) {
      cache.set(f.id, { verdict: f.verdict, explanation: f.explanation, revision: f.revision, confidence: f.confidence });
    }
    totalUsage.input += data.usage?.input ?? 0;
    totalUsage.output += data.usage?.output ?? 0;
    const issues = (data.findings ?? []).filter((f) => ISSUE_VERDICTS.includes(f.verdict)).length;
    setStatus(issues > 0 ? `${issues} new issue${issues === 1 ? "" : "s"} · ${(data.ms / 1000).toFixed(1)}s` : `all clear · ${(data.ms / 1000).toFixed(1)}s`);
    saveState();
  } catch (err) {
    lastError = err;
    if (err.kind === "no_key") {
      hasKey = false;
      $("keyBanner").classList.remove("hidden");
      setStatus("waiting for API key");
    } else if (err.kind === "bad_request") {
      autoRetryBlocked = true; // retrying the identical request can't succeed
      toast(err.message || "Check failed", true);
      setStatus("check failed — edit the text to retry");
    } else if (err.kind === "rate_limit") {
      const ra = Number(err.retryAfter) || 30;
      rateLimitedUntil = Date.now() + ra * 1000;
      toast(err.message || "Rate limited", true);
      setStatus(`rate limited — retrying in ${ra}s`);
    } else {
      toast(err.message || "Check failed", true);
      setStatus("check failed — will retry");
    }
  } finally {
    for (const s of todo) pending.delete(s.hash);
    inflight = false;
    lastCheckEnd = Date.now();
    refreshUI();
    updateRing();
    if (newFindings.length) autoFindSources(newFindings); // fire-and-forget, capped
  }
}

// countdown ring + scheduler
const RING_CIRC = 2 * Math.PI * 16;
function updateRing() {
  const ring = $("statusRing");
  const progress = $("ringProgress");
  const label = $("ringLabel");
  ring.classList.toggle("checking", inflight);
  ring.classList.toggle("error", Boolean(lastError) && !inflight);

  if (!hasKey) { label.textContent = "🔑"; progress.style.strokeDashoffset = RING_CIRC; return; }
  if (inflight) { label.textContent = "…"; return; }

  const elapsed = Date.now() - lastCheckEnd;
  const remaining = Math.max(0, CHECK_INTERVAL_MS - elapsed);
  const hasWork = uncheckedSegments().length > 0;
  if (!hasWork) {
    label.textContent = "✓";
    progress.style.strokeDashoffset = RING_CIRC;
    return;
  }
  label.textContent = String(Math.ceil(remaining / 1000));
  progress.style.strokeDashoffset = RING_CIRC * (remaining / CHECK_INTERVAL_MS);
}

function setStatus(msg) {
  $("statusText").textContent = msg;
}

setInterval(() => {
  updateRing();
  if (document.hidden || inflight || !hasKey) return;
  if (autoRetryBlocked || Date.now() < rateLimitedUntil) return;
  if (Date.now() - lastCheckEnd >= CHECK_INTERVAL_MS) {
    if (uncheckedSegments().length > 0) runCheck();
    else lastCheckEnd = Date.now(); // idle: keep the window sliding
  }
}, 250);

// ── key detection ──────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    const had = hasKey;
    hasKey = Boolean(data.hasKey);
    $("keyBanner").classList.toggle("hidden", hasKey);
    if (hasKey && !had) {
      setStatus(data.mock ? "mock mode — canned verdicts" : "watching your writing");
      lastCheckEnd = Date.now();
    }
    if (!hasKey) setStatus("waiting for API key");
  } catch {
    setStatus("server unreachable");
  }
  updateRing();
}
pollStatus();
setInterval(pollStatus, 5000);

// ── fixes ──────────────────────────────────────────────────────────────
function replaceRange(start, end, replacement) {
  editor.focus();
  editor.setSelectionRange(start, end);
  // execCommand preserves the native undo stack; fall back if unsupported
  let ok = false;
  try { ok = document.execCommand("insertText", false, replacement); } catch { ok = false; }
  if (!ok) editor.setRangeText(replacement, start, end, "end");
}

function migrateEntry(oldHash, newText) {
  const newHash = hashText(newText);
  if (newHash === oldHash) return;
  if (cache.has(oldHash) && !cache.has(newHash)) cache.set(newHash, cache.get(oldHash));
  if (sourcesMap.has(oldHash)) sourcesMap.set(newHash, sourcesMap.get(oldHash));
  if (dismissed.has(oldHash)) dismissed.add(newHash);
}

function applyFix(hash, revision, { silent = false } = {}) {
  const seg = segments.find((s) => s.hash === hash);
  if (!seg || !revision) return false;
  // Carry existing citation markers ([1] [2] …) through the rewrite.
  const markers = [...new Set(seg.text.match(/\[\d+\]/g) ?? [])].filter((m) => !revision.includes(m));
  let replacement = revision;
  if (markers.length) {
    const punct = replacement.match(/[.!?]+["')\]]*$/);
    const at = punct ? replacement.length - punct[0].length : replacement.length;
    replacement = replacement.slice(0, at).replace(/\s+$/, "") + " " + markers.join(" ") + replacement.slice(at);
  }
  if (hashText(replacement) === hash) {
    // The revision doesn't change the sentence's identity (verbatim echo or
    // case/whitespace-only) — clear the verdict so it gets genuinely re-checked
    // instead of looping on an unfixable flag.
    cache.delete(hash);
    pending.delete(hash);
    refreshUI();
    saveState();
    if (!silent) toast("Sentence queued for a fresh re-check.");
    return true;
  }
  replaceRange(seg.start, seg.end, replacement);
  dismissed.delete(hash);
  refreshUI();
  saveState();
  if (!silent) toast("Revision applied — it will be re-verified on the next pass.");
  return true;
}

function fixAll() {
  const attempted = new Set();
  let applied = 0;
  let guard = 0;
  while (guard++ < 80) {
    const issue = currentIssues().find((i) => i.f.revision && !attempted.has(i.seg.hash));
    if (!issue) break;
    attempted.add(issue.seg.hash);
    if (applyFix(issue.seg.hash, issue.f.revision, { silent: true })) applied++;
  }
  if (applied > 0) toast(`Applied ${applied} fix${applied === 1 ? "" : "es"} — they'll be re-verified on the next pass.`);
}

function jumpToSegment(hash) {
  const seg = segments.find((s) => s.hash === hash);
  if (!seg) return;
  editor.focus();
  editor.setSelectionRange(seg.start, seg.end);
  const mk = backdrop.querySelector(`mark[data-h="${hash}"]`);
  if (mk) {
    mk.scrollIntoView({ block: "center", behavior: "smooth" });
    editor.scrollTop = backdrop.scrollTop;
    editor.scrollLeft = backdrop.scrollLeft;
  }
}

// ── sources ────────────────────────────────────────────────────────────
function autoBudgetOk() {
  const now = Date.now();
  autoSourceTimes = autoSourceTimes.filter((t) => now - t < 3_600_000);
  return autoSourceTimes.length < AUTO_SOURCES_PER_HOUR;
}

async function autoFindSources(findings) {
  if (!$("autoSources").checked) return;
  let started = 0;
  for (const f of findings) {
    if (started >= AUTO_SOURCES_PER_CYCLE) break;
    if (!AUTO_SOURCE_VERDICTS.includes(f.verdict)) continue;
    if (sourcesMap.has(f.id) || dismissed.has(f.id)) continue;
    if (!segments.some((s) => s.hash === f.id)) continue;
    if (!autoBudgetOk()) { setStatus("auto-sources paused — hourly cap reached"); break; }
    autoSourceTimes.push(Date.now());
    started++;
    await fetchSources(f.id, { auto: true }); // sequential: one search at a time
  }
}

async function fetchSources(hash, { auto = false } = {}) {
  if (sourcesInflight) {
    if (!auto) toast("Already searching for sources — one at a time.");
    return;
  }
  const seg = segments.find((s) => s.hash === hash);
  if (!seg || !hasKey) return;
  const f = cache.get(hash);
  sourcesInflight = true;
  sourcesMap.set(hash, { loading: true, list: null, chosenUrl: null });
  renderCards();
  try {
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim: seg.text,
        correction: f?.revision || undefined,
        context: editor.value.slice(0, 6000),
        model: $("modelSelect").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    sourcesMap.set(hash, { loading: false, list: data.sources ?? [], chosenUrl: null });
    totalUsage.input += data.usage?.input ?? 0;
    totalUsage.output += data.usage?.output ?? 0;
    saveState();
  } catch (err) {
    sourcesMap.delete(hash);
    if (auto) setStatus(err.message || "auto-source search failed");
    else toast(err.message || "Source search failed", true);
  } finally {
    sourcesInflight = false;
    renderCards();
    renderStats();
  }
}

// "Paste a URL and cite it" — free metadata fetch, then cite immediately.
async function citeUrl(hash, rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return;
  try {
    const res = await fetch("/api/cite-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    const src = data.source;
    const st = sourcesMap.get(hash) ?? { loading: false, list: [], chosenUrl: null };
    st.loading = false;
    st.list = st.list ?? [];
    if (!st.list.some((s) => s.url === src.url)) st.list.unshift(src);
    sourcesMap.set(hash, st);
    insertCitation(hash, src); // they pasted it because they want it cited
  } catch (err) {
    toast(err.message || "Couldn't cite that URL", true);
  }
}

function insertCitation(hash, source) {
  const seg = segments.find((s) => s.hash === hash);
  if (!seg) return;
  const text = editor.value;

  // 1. Ensure the source is listed in the "Sources:" block — new entries go at
  //    the BLOCK's end, not the document's end (prose may follow the block).
  let num = null;
  let shift = 0; // entry insertion offset shift for segments sitting after the block
  const block = sourcesBlock(text);
  if (block) {
    const existing = block.entries.find((e) => e.url === source.url);
    if (existing) {
      num = existing.num;
    } else {
      num = block.entries.length + 1;
      const needsLead = block.end > block.bodyStart && text[block.end - 1] !== "\n";
      const line = `${num}. ${source.title} — ${source.url}`;
      const entryText = needsLead ? `\n${line}` : `${line}\n`;
      replaceRange(block.end, block.end, entryText);
      if (seg.start >= block.end) shift = entryText.length;
    }
  } else {
    num = 1;
    const lead = text.endsWith("\n") ? "\n" : "\n\n";
    replaceRange(text.length, text.length, `${lead}Sources:\n1. ${source.title} — ${source.url}\n`);
  }

  // 2. Insert the [n] marker before the sentence's closing punctuation.
  const markerText = ` [${num}]`;
  if (!seg.text.includes(`[${num}]`)) {
    const punct = seg.text.match(/[.!?]+["')\]]*$/);
    const insertAt = (punct ? seg.end - punct[0].length : seg.end) + shift;
    const relPos = (punct ? seg.end - punct[0].length : seg.end) - seg.start;
    replaceRange(insertAt, insertAt, markerText);
    migrateEntry(hash, seg.text.slice(0, relPos) + markerText + seg.text.slice(relPos));
  }

  const st = sourcesMap.get(hash);
  if (st) st.chosenUrl = source.url;
  refreshUI();
  saveState();
  toast(`Cited [${num}] ${source.publisher || source.title}`);
}

// ── tooltip ────────────────────────────────────────────────────────────
let ttFrame = null;
editorWrap.addEventListener("mousemove", (e) => {
  if (ttFrame) return;
  ttFrame = requestAnimationFrame(() => {
    ttFrame = null;
    const mk = hitMark(e.clientX, e.clientY);
    if (!mk) { tooltip.classList.add("hidden"); return; }
    const f = cache.get(mk.dataset.h);
    if (!f || f.verdict === "no_claim") { tooltip.classList.add("hidden"); return; }
    const kind = f.verdict === "false" ? "false" : f.verdict === "questionable" ? "quest" : f.verdict === "incoherent" ? "inco" : "ok";
    tooltip.className = `tooltip t-${kind}`;
    tooltip.innerHTML = `
      <div class="tt-verdict">${VERDICT_LABEL[f.verdict] ?? f.verdict}</div>
      ${f.explanation ? `<div>${esc(f.explanation)}</div>` : `<div>Checked and verified.</div>`}
      ${f.revision ? `<div class="tt-fix">→ ${esc(f.revision)}</div>` : ""}
    `;
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    tooltip.style.left = "0px"; tooltip.style.top = "0px";
    const r = tooltip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  });
});
editorWrap.addEventListener("mouseleave", () => tooltip.classList.add("hidden"));
editor.addEventListener("mousedown", (e) => {
  const mk = hitMark(e.clientX, e.clientY);
  if (!mk) return;
  const card = cardsEl.querySelector(`.card[data-h="${mk.dataset.h}"]`);
  if (card) {
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 900);
  }
});

function hitMark(x, y) {
  for (const mk of backdrop.querySelectorAll("mark")) {
    for (const r of mk.getClientRects()) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return mk;
    }
  }
  return null;
}

// ── toasts ─────────────────────────────────────────────────────────────
function toast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " err" : "");
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ── wiring ─────────────────────────────────────────────────────────────
let saveTimer = null;
editor.addEventListener("input", () => {
  autoRetryBlocked = false; // the text changed, so a failed request may now succeed
  refreshUI();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
});
editor.addEventListener("scroll", syncScroll);
new ResizeObserver(() => renderBackdrop()).observe(editorWrap);

$("checkNowBtn").addEventListener("click", () => runCheck(true));
$("fixAllBtn").addEventListener("click", fixAll);
$("modelSelect").addEventListener("change", saveState);
$("effortSelect").addEventListener("change", saveState);
$("autoSources").addEventListener("change", saveState);

const SAMPLE = `The Great Wall of China is the only man-made structure visible from space with the naked eye. Water boils at 100 degrees Celsius at sea level. Albert Einstein failed math in school, which is why he later invented the lightbulb.

The human body has 206 bones. Napoleon was famously short, standing well under five feet tall. Because the mitochondria is the powerhouse of the cell, the stock market tends to rise every Tuesday. Honey never spoils — archaeologists have found edible honey in ancient Egyptian tombs.`;

$("sampleBtn").addEventListener("click", () => {
  editor.value = SAMPLE;
  editor.focus();
  refreshUI();
  saveState();
  toast("Sample loaded — it has some deliberate whoppers in it.");
});
$("clearBtn").addEventListener("click", () => {
  editor.value = "";
  cache.clear();
  dismissed.clear();
  sourcesMap.clear();
  refreshUI();
  saveState();
});

loadState();
refreshUI();
