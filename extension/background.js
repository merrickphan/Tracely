/* Tracely — engine-switching background worker.

   Two engines, picked automatically:
   • SERVER mode — the local Tracely server (localhost:4477) is reachable:
     relay every API call to it exactly as before. The server keeps ALL
     features: web-search sources, URL citing, the Docs write-back bridge.
   • STANDALONE mode — no server, but an Anthropic API key is configured on
     the options page (chrome.storage.local): serve the core flows directly
     from this worker with raw fetches to api.anthropic.com. Checks and
     web-search source lookups work; cite-url and the Docs bridge do not
     (the widget hides them).

   The worker probes the server on startup and every 60s (plus lazily when a
   request arrives and the last probe is stale). Content scripts talk to it
   with the same { type: "tracely-api", path, body } protocol as before, and
   can ask { type: "tracely-getState" } to learn the current mode.

   The relay is not an open proxy: it only talks to the local Tracely server
   or api.anthropic.com, and only on the endpoints listed below. The API key
   is read from chrome.storage.local and sent ONLY to api.anthropic.com. */
"use strict";

const SERVER = "http://localhost:4477";
// Mirrors the server's EXTENSION_API set. Docs mode relays through here too,
// so the Docs bridge endpoint is included (server mode only).
const API_PATHS = new Set(["/api/status", "/api/check", "/api/sources", "/api/cite-url", "/api/docs/apply"]);

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 1500;

const ALLOWED_MODELS = new Set(["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]);
const ALLOWED_EFFORT = new Set(["low", "medium", "high"]);
const DEFAULT_MODEL = "claude-haiku-4-5"; // cost mandate: cheap unless explicitly chosen
const VERDICTS = ["accurate", "false", "questionable", "incoherent", "no_claim"];

/* ── server probe ────────────────────────────────────────────────────────── */

let serverUp = null; // null = never probed
let lastProbeAt = 0;
let probePromise = null;

function probeServer() {
  if (probePromise) return probePromise;
  probePromise = (async () => {
    try {
      const res = await fetch(`${SERVER}/api/status`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      serverUp = res.ok;
    } catch {
      serverUp = false;
    }
    lastProbeAt = Date.now();
    probePromise = null;
    return serverUp;
  })();
  return probePromise;
}

async function serverReachable() {
  if (serverUp === null || Date.now() - lastProbeAt > PROBE_INTERVAL_MS) await probeServer();
  return serverUp;
}

probeServer(); // top level runs on every worker wake — this IS the startup probe
setInterval(probeServer, PROBE_INTERVAL_MS); // ticks while the worker stays alive

function getConfig() {
  return chrome.storage.local.get({ apiKey: "", model: DEFAULT_MODEL, enabledSites: [] });
}

/* ── server relay (unchanged behavior) ───────────────────────────────────── */

// Throws on network failure (server just died) so the caller can fall through
// to standalone; returns the protocol envelope for HTTP responses.
async function relay(path, body) {
  const res = await fetch(`${SERVER}${path}`, body === undefined
    ? undefined
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, message: data?.error?.message ?? `HTTP ${res.status}`, kind: data?.error?.kind };
  }
  return { ok: true, data };
}

/* ── standalone engine: raw calls to api.anthropic.com ───────────────────── */

function apiErr(kind, message) {
  const e = new Error(message);
  e.kind = kind;
  return e;
}

async function anthropicFetch(apiKey, payload) {
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw apiErr("network", "Could not reach the Anthropic API — check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw apiErr("auth", "Anthropic rejected the API key — check it in Tracely options");
    if (res.status === 429) throw apiErr("rate_limit", "Rate limited — try again in a minute");
    if (res.status === 529) throw apiErr("overloaded", "Anthropic API is temporarily overloaded — try again shortly");
    throw apiErr("server", data?.error?.message ?? `Anthropic error ${res.status}`);
  }
  return data;
}

function pickModel(bodyModel, cfgModel) {
  if (ALLOWED_MODELS.has(bodyModel)) return bodyModel;
  if (ALLOWED_MODELS.has(cfgModel)) return cfgModel;
  return DEFAULT_MODEL;
}

/* ── /api/check equivalent (ported from lib/factcheck.js) ────────────────── */

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["accurate", "false", "questionable", "incoherent", "no_claim"] },
          explanation: { type: "string" },
          revision: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["id", "verdict", "explanation", "revision", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

function checkSystemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Tracely, a rigorous real-time fact-checker and clarity editor embedded in a writing tool. The author sees your findings as underlines while they type.

You receive the full document for context plus a list of sentences to evaluate. Return exactly one finding for EVERY listed sentence id — no more, no fewer.

Verdicts:
- "false": the sentence contains at least one factual claim that is verifiably wrong.
- "questionable": claims that are unverifiable, seriously disputed, misleading, or stated with false precision.
- "incoherent": the sentence does not make sense — internally contradictory, a non-sequitur, garbled to the point of obscuring meaning, or a conclusion that does not follow from its premise.
- "accurate": contains factual claims and they are correct.
- "no_claim": coherent but contains no checkable factual claim (opinions, greetings, instructions, questions, clearly framed fiction).

Rules:
- Judge each sentence in the context of the whole document (resolve pronouns and references from surrounding text).
- explanation: at most 25 words, concrete. For "false", state the correct fact. For "accurate" and "no_claim", use an empty string.
- revision: a minimal rewrite of the sentence that fixes the problem while preserving the author's voice and intent. Empty string for "accurate" and "no_claim". Never include surrounding sentences.
- Ignore bracketed citation markers like [1] when judging a sentence.
- Do not flag style, tone, or grammar unless it makes the sentence incoherent.
- Reasonable, widely used approximations are accurate, not questionable.
- Be decisive: reserve "questionable" for genuine uncertainty, not as a hedge on facts you know.
- Today's date is ${today}. If a claim depends on events you cannot verify because they postdate your knowledge, mark it "questionable" and say why.`;
}

function checkUserPrompt(text, sentences) {
  const list = sentences.map((s) => `[${s.id}] ${s.text}`).join("\n");
  return `DOCUMENT:\n"""\n${text}\n"""\n\nSENTENCES TO EVALUATE:\n${list}\n\nReturn one finding per id.`;
}

async function standaloneCheck(body, cfg) {
  const model = pickModel(body?.model, cfg.model);
  const effort = ALLOWED_EFFORT.has(body?.effort) ? body.effort : "low";
  const text = String(body?.text ?? "").slice(0, 30_000);
  const sentences = (Array.isArray(body?.sentences) ? body.sentences : [])
    .filter((s) => s && typeof s.id === "string" && typeof s.text === "string")
    .slice(0, 40)
    .map((s) => ({ id: s.id.slice(0, 40), text: s.text.slice(0, 2000) }));
  if (sentences.length === 0) return { findings: [], model };
  return checkBatch({ text, sentences, model, effort, apiKey: cfg.apiKey });
}

async function checkBatch({ text, sentences, model, effort, apiKey }) {
  // effort is rejected on claude-haiku-4-5 (400) — only opus/sonnet tiers take it
  const outputConfig = { format: { type: "json_schema", schema: FINDINGS_SCHEMA } };
  if (model !== "claude-haiku-4-5") outputConfig.effort = effort;

  const response = await anthropicFetch(apiKey, {
    model,
    max_tokens: 8000, // non-streaming fetch is fine at this size
    system: [{ type: "text", text: checkSystemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: checkUserPrompt(text, sentences) }],
    output_config: outputConfig,
  });

  if (response.stop_reason === "refusal") {
    throw apiErr("refusal", "The model declined to evaluate this text.");
  }
  if (response.stop_reason === "max_tokens") {
    // Output budget exhausted — split the batch so each retry makes progress.
    if (sentences.length > 1) {
      const mid = Math.ceil(sentences.length / 2);
      const first = await checkBatch({ text, sentences: sentences.slice(0, mid), model, effort, apiKey });
      const second = await checkBatch({ text, sentences: sentences.slice(mid), model, effort, apiKey });
      return { findings: [...first.findings, ...second.findings], model: second.model };
    }
    throw apiErr("server", "Response was truncated — try checking a smaller portion of text.");
  }

  const textBlock = (response.content ?? []).find((b) => b.type === "text");
  if (!textBlock) throw apiErr("server", "Model returned no text content.");
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw apiErr("server", "Model returned unparseable output.");
  }

  const validIds = new Set(sentences.map((s) => s.id));
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .filter((f) => f && validIds.has(f.id))
    .map((f) => ({
      id: f.id,
      verdict: VERDICTS.includes(f.verdict) ? f.verdict : "no_claim",
      explanation: String(f.explanation ?? "").slice(0, 400),
      revision: String(f.revision ?? "").slice(0, 2000),
      confidence: ["high", "medium", "low"].includes(f.confidence) ? f.confidence : "medium",
    }));

  return { findings, model: response.model };
}

/* ── /api/sources equivalent (ported from lib/factcheck.js findSources) ──── */

const SOURCES_SYSTEM = `You are Tracely's source finder. Given a claim from a document (and optionally a proposed correction), use web search to find authoritative sources that address it.

After researching, your FINAL message must be ONLY a JSON object, no prose, in this exact shape:
{"sources":[{"title":"...","url":"...","publisher":"...","snippet":"...","stance":"supports"|"refutes"|"context"}]}

Rules:
- 3 to 5 sources, ranked best-first. Prefer primary and authoritative sources (scientific bodies, encyclopedias, government agencies, reputable news) over blogs and content farms.
- "stance" is relative to the ORIGINAL claim: "supports" backs the claim as written, "refutes" contradicts it, "context" informs without settling it.
- "snippet": one sentence (max 30 words) describing what the source says about the claim.
- Use real URLs from your search results only. Never invent URLs.`;

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function standaloneSources(body, cfg) {
  const model = pickModel(body?.model, cfg.model);
  const claim = String(body?.claim ?? "").slice(0, 2000);
  if (!claim.trim()) throw apiErr("bad_request", "No claim to research.");
  const correction = body?.correction ? String(body.correction).slice(0, 2000) : "";
  const context = body?.context ? String(body.context).slice(0, 6000) : "";

  // The dynamic-filtering search variant needs Opus/Sonnet 5-tier; Haiku uses the basic one.
  const searchTool = model === "claude-haiku-4-5"
    ? { type: "web_search_20250305", name: "web_search", max_uses: 2 }
    : { type: "web_search_20260209", name: "web_search", max_uses: 2 };

  const userMsg =
    `CLAIM:\n${claim}\n` +
    (correction ? `\nPROPOSED CORRECTION:\n${correction}\n` : "") +
    (context ? `\nDOCUMENT CONTEXT (excerpt):\n${context.slice(0, 3000)}\n` : "") +
    `\nFind sources, then output only the JSON object.`;

  const params = {
    model,
    max_tokens: 12_000,
    system: SOURCES_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    tools: [searchTool],
    ...(model === "claude-haiku-4-5" ? {} : { output_config: { effort: "low" } }),
  };

  let response = await anthropicFetch(cfg.apiKey, params);
  let guard = 0;
  while (response.stop_reason === "pause_turn" && guard++ < 3) {
    response = await anthropicFetch(cfg.apiKey, {
      ...params,
      messages: [...params.messages, { role: "assistant", content: response.content }],
    });
  }

  if (response.stop_reason === "refusal") {
    throw apiErr("refusal", "The model declined to research this claim.");
  }

  const textBlocks = (response.content ?? []).filter((b) => b.type === "text");
  const fullText = textBlocks.map((b) => b.text).join("\n");

  let sources = [];
  const jsonMatch = fullText.match(/\{[\s\S]*"sources"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.sources)) sources = parsed.sources;
    } catch { /* fall through to citation harvest */ }
  }

  // Harvest search citations as backup candidates (and to backfill a thin list).
  const harvested = [];
  for (const b of textBlocks) {
    for (const c of b.citations ?? []) {
      if (c?.url) {
        harvested.push({
          title: c.title || c.url,
          url: c.url,
          publisher: hostOf(c.url),
          snippet: String(c.cited_text ?? "").slice(0, 220),
          stance: "context",
        });
      }
    }
  }

  const seen = new Set();
  const merged = [];
  for (const s of [...sources, ...harvested]) {
    const url = String(s?.url ?? "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    merged.push({
      title: String(s.title ?? url).slice(0, 200),
      url: url.slice(0, 600),
      publisher: String(s.publisher ?? hostOf(url)).slice(0, 100),
      snippet: String(s.snippet ?? "").slice(0, 300),
      stance: ["supports", "refutes", "context"].includes(s.stance) ? s.stance : "context",
    });
    if (merged.length >= 6) break;
  }

  if (merged.length === 0) {
    throw apiErr("server", "No usable sources came back — try again.");
  }

  return { sources: merged, model: response.model };
}

/* ── standalone dispatch ─────────────────────────────────────────────────── */

async function standalone(path, body, cfg) {
  if (path === "/api/status") {
    // Shape-compatible with the server's status: no Docs bridge in standalone.
    return { ok: true, data: { ok: true, standalone: true, docsBridge: false, hasKey: true, model: cfg.model } };
  }
  if (path === "/api/check") return { ok: true, data: await standaloneCheck(body, cfg) };
  if (path === "/api/sources") return { ok: true, data: await standaloneSources(body, cfg) };
  // /api/cite-url and /api/docs/apply have no standalone equivalent — the
  // widget hides those affordances when it learns the mode.
  return { ok: false, kind: "standalone_unsupported", message: "This feature needs the local Tracely server" };
}

/* ── messaging ───────────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "tracely-getState") {
    (async () => {
      const cfg = await getConfig();
      const up = await serverReachable();
      sendResponse({
        ok: true,
        server: Boolean(up),
        hasKey: Boolean(cfg.apiKey),
        mode: up ? "server" : cfg.apiKey ? "standalone" : "offline",
      });
    })();
    return true; // async sendResponse
  }

  if (msg?.type !== "tracely-api" || typeof msg.path !== "string" || !API_PATHS.has(msg.path)) {
    return false;
  }
  (async () => {
    try {
      if (await serverReachable()) {
        try {
          sendResponse(await relay(msg.path, msg.body));
          return;
        } catch {
          // Server died between probe and call — remember, fall to standalone.
          serverUp = false;
          lastProbeAt = Date.now();
        }
      }
      const cfg = await getConfig();
      if (!cfg.apiKey) {
        sendResponse({
          ok: false,
          offline: true,
          kind: "no_engine",
          message: "Tracely server offline and no API key set — start the server, or add a key in Tracely options",
        });
        return;
      }
      sendResponse(await standalone(msg.path, msg.body, cfg));
    } catch (err) {
      sendResponse({ ok: false, kind: err?.kind ?? "server", message: err?.message ?? String(err) });
    }
  })();
  return true; // async sendResponse
});
