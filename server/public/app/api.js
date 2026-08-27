/** Typed-ish fetch wrappers — the renderer's only path to the server. */

/* ── usage metering ─────────────────────────────────────────────────────────
   Every response carrying {usage:{input,output}, model} is accumulated into a
   per-model-family ledger; after each accumulation a "tracely:usage" event
   fires on window with cumulative {input, output, cost}. Cost is a rough
   estimate from public per-MTok pricing. */
const PRICING = { // $ per MTok: [input, output]
  opus: [5, 25],
  sonnet: [3, 15],
  haiku: [1, 5],
};
const ledger = {
  opus: { input: 0, output: 0 },
  sonnet: { input: 0, output: 0 },
  haiku: { input: 0, output: 0 },
  other: { input: 0, output: 0 },
};

function familyOf(model) {
  const m = String(model ?? "").toLowerCase();
  for (const fam of Object.keys(PRICING)) if (m.includes(fam)) return fam;
  return "other";
}

function recordUsage(data) {
  const u = data?.usage;
  if (!u || typeof u !== "object") return;
  const input = Number(u.input) || 0;
  const output = Number(u.output) || 0;
  if (input === 0 && output === 0) return;
  const fam = familyOf(data.model);
  ledger[fam].input += input;
  ledger[fam].output += output;

  let totalIn = 0, totalOut = 0, cost = 0;
  for (const [name, tally] of Object.entries(ledger)) {
    totalIn += tally.input;
    totalOut += tally.output;
    const [pIn, pOut] = PRICING[name] ?? [0, 0];
    cost += (tally.input * pIn + tally.output * pOut) / 1e6;
  }
  window.dispatchEvent(new CustomEvent("tracely:usage", {
    detail: { input: totalIn, output: totalOut, cost },
  }));
}

async function call(path, body, method) {
  const res = await fetch(path, body === undefined
    ? { method: method ?? "GET" }
    : { method: method ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data?.error?.message ?? `HTTP ${res.status}`), {
      kind: data?.error?.kind, retryAfter: data?.error?.retryAfter, status: res.status,
    });
  }
  recordUsage(data);
  return data;
}

export const api = {
  status: () => call("/api/status"),

  // pipeline
  detectClaims: (text, opts = {}) => call("/api/detect-claims", { text, ...opts }),
  evidence: (req) => call("/api/evidence", req),                 // {claimId?, claim, query, claimType}
  critique: (req) => call("/api/critique", req),                 // {claim, sentence, citedRef?, sources?, model?}
  grade: (req) => call("/api/grade", req),                       // {text, level, rubric?, model?} → {components, custom?, model}
  structure: (text) => call("/api/structure", { text }),
  tracer: (req) => call("/api/tracer", req),                     // {conversationId?, documentId?, message}
  citeUrl: (url) => call("/api/cite-url", { url }),
  compareSource: (req) => call("/api/compare-source", req),      // {citedRef} → free Crossref/OpenLibrary resolution
  findSources: (req) => call("/api/sources", req),               // legacy web-search fallback

  documents: {
    list: (sort) => call(`/api/documents${sort ? `?sort=${sort}` : ""}`),
    get: (id) => call(`/api/documents/${id}`),
    create: (doc) => call("/api/documents", doc),
    update: (id, patch) => call(`/api/documents/${id}`, patch, "PUT"),
    remove: (id) => call(`/api/documents/${id}`, undefined, "DELETE"),
  },
  library: {
    list: (q) => call(`/api/library${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    add: (item) => call("/api/library", item),                   // {source, note}
    update: (id, patch) => call(`/api/library/${id}`, patch, "PUT"),
    remove: (id) => call(`/api/library/${id}`, undefined, "DELETE"),
  },
  prefs: {
    get: () => call("/api/prefs"),
    set: (patch) => call("/api/prefs", patch, "PUT"),
  },
  stats: () => call("/api/stats"),
  analyses: {
    create: (a) => call("/api/analyses", a),
    forDocument: (docId) => call(`/api/analyses?documentId=${docId}`),
  },
  clearHistory: (alsoLibrary) => call("/api/clear-history", { alsoLibrary }),
};
