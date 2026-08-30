import Anthropic from "@anthropic-ai/sdk";

export class CheckError extends Error {
  constructor(kind, message, { status = 400, retryAfter } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const ALLOWED_MODELS = new Set(["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]);
const ALLOWED_EFFORT = new Set(["low", "medium", "high"]);
const DEFAULT_MODEL = "claude-haiku-4-5"; // cost mandate: cheap unless explicitly chosen
const DEFAULT_EFFORT = "low";

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client = null;
let clientKey = null;
function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, timeout: 120_000, maxRetries: 1 });
    clientKey = key;
  }
  return client;
}

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["accurate", "needs_citation", "false", "questionable", "incoherent", "no_claim"] },
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

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Tracely, a rigorous real-time fact-checker and clarity editor embedded in a writing tool. The author sees your findings as underlines while they type.

You receive the full document for context plus a list of sentences to evaluate. Return exactly one finding for EVERY listed sentence id — no more, no fewer.

Verdicts:
- "false": the sentence contains at least one factual claim that is verifiably wrong.
- "questionable": claims that are unverifiable, seriously disputed, misleading, or stated with false precision.
- "incoherent": the sentence does not make sense — internally contradictory, a non-sequitur, garbled to the point of obscuring meaning, or a conclusion that does not follow from its premise.
- "needs_citation": the claim appears ACCURATE but is the kind of assertion that needs a source — a statistic, study finding, quote, dated event, or specific non-common-knowledge fact — and neither a citation marker nor an attribution appears in or around the sentence.
- "accurate": contains factual claims and they are correct, and either they are common knowledge or a citation/attribution is present.
- "no_claim": coherent but contains no checkable factual claim (opinions, greetings, instructions, questions, clearly framed fiction).

Rules:
- Judge each sentence in the context of the whole document (resolve pronouns and references from surrounding text).
- explanation: at most 25 words, concrete. For "false", state the correct fact. For "needs_citation", name what kind of source would support it. For "accurate" and "no_claim", use an empty string.
- revision: a minimal rewrite of the sentence that fixes the problem while preserving the author's voice and intent. Empty string for "accurate", "no_claim", and "needs_citation" (nothing to rewrite — it needs a source, not different words). Never include surrounding sentences.
- A citation can be a bracketed marker like [1], a parenthetical (Author, year), or prose attribution ("According to…", "X reported…"). Any of these count as cited — never flag them "needs_citation".
- Widely known facts (capitals, famous dates, basic science) are common knowledge: "accurate", not "needs_citation".
- Precedence: a wrong claim is "false" and an unverifiable one "questionable" even if it also lacks a citation.
- Ignore bracketed citation markers like [1] when judging a sentence.
- Do not flag style, tone, or grammar unless it makes the sentence incoherent.
- Reasonable, widely used approximations are accurate, not questionable.
- Be decisive: reserve "questionable" for genuine uncertainty, not as a hedge on facts you know.
- Today's date is ${today}. If a claim depends on events you cannot verify because they postdate your knowledge, mark it "questionable" and say why.`;
}

function userPrompt(text, sentences) {
  const list = sentences.map((s) => `[${s.id}] ${s.text}`).join("\n");
  return `DOCUMENT:\n"""\n${text}\n"""\n\nSENTENCES TO EVALUATE:\n${list}\n\nReturn one finding per id.`;
}

// Server-side refusal fallbacks are recommended-by-default for claude-opus-5.
// If the account/API rejects the parameter, we drop it once and remember.
let fallbacksSupported = true;

export async function runFactCheck({ text, sentences, model, effort, mock = false }) {
  const chosenModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
  const chosenEffort = ALLOWED_EFFORT.has(effort) ? effort : DEFAULT_EFFORT;

  if (mock) return mockFindings(sentences, chosenModel);
  // COST: never resend a whole long document as context — the sentences carry
  // their own text, and a short head (title/thesis) covers reference resolution.
  const context = text.length > 6000 ? text.slice(0, 2000) + "\n[… document trimmed for cost — judge sentences on their own text …]" : text;
  return checkBatch({ text: context, sentences, model: chosenModel, effort: chosenEffort });
}

async function checkBatch({ text, sentences, model, effort }) {
  const anthropic = getClient();
  // effort is rejected on claude-haiku-4-5 (400) — only opus/sonnet tiers take it
  const outputConfig = { format: { type: "json_schema", schema: FINDINGS_SCHEMA } };
  if (model !== "claude-haiku-4-5") outputConfig.effort = effort;
  const params = {
    model,
    max_tokens: 32_000, // streaming request: room for thinking + a revision per sentence
    system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt(text, sentences) }],
    output_config: outputConfig,
  };

  const useFallbacks = fallbacksSupported && model === "claude-opus-5";
  let response;
  try {
    response = await createMessage(anthropic, params, useFallbacks);
  } catch (err) {
    if (useFallbacks && err instanceof Anthropic.BadRequestError && /fallback/i.test(String(err.message))) {
      fallbacksSupported = false;
      try {
        response = await createMessage(anthropic, params, false);
      } catch (err2) {
        throw mapApiError(err2);
      }
    } else {
      throw mapApiError(err);
    }
  }

  if (response.stop_reason === "refusal") {
    throw new CheckError("refusal", "The model declined to evaluate this text.", { status: 502 });
  }
  if (response.stop_reason === "max_tokens") {
    // Output budget exhausted — split the batch so each retry makes progress.
    if (sentences.length > 1) {
      const mid = Math.ceil(sentences.length / 2);
      const first = await checkBatch({ text, sentences: sentences.slice(0, mid), model, effort });
      const second = await checkBatch({ text, sentences: sentences.slice(mid), model, effort });
      return {
        findings: [...first.findings, ...second.findings],
        model: second.model,
        usage: addUsage(first.usage, second.usage),
      };
    }
    throw new CheckError("server", "Response was truncated — try checking a smaller portion of text.", { status: 502 });
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new CheckError("server", "Model returned no text content.", { status: 502 });
  }

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new CheckError("server", "Model returned unparseable output.", { status: 502 });
  }

  const validIds = new Set(sentences.map((s) => s.id));
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .filter((f) => f && validIds.has(f.id))
    .map((f) => ({
      id: f.id,
      verdict: ["accurate", "needs_citation", "false", "questionable", "incoherent", "no_claim"].includes(f.verdict) ? f.verdict : "no_claim",
      explanation: String(f.explanation ?? "").slice(0, 400),
      revision: String(f.revision ?? "").slice(0, 2000),
      confidence: ["high", "medium", "low"].includes(f.confidence) ? f.confidence : "medium",
    }));

  return {
    findings,
    model: response.model,
    usage: usageOf(response),
  };
}

// ---------------------------------------------------------------------------
// Source finding: uses Anthropic's server-side web_search tool (billed through
// the same API key — no extra keys) to pull up candidate sources for a claim.
// ---------------------------------------------------------------------------
export async function findSources({ claim, correction, context, model, mock = false }) {
  const chosenModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
  if (mock) return mockSources(claim, chosenModel);

  const anthropic = getClient();
  // The dynamic-filtering search variant needs Opus/Sonnet 5-tier; Haiku uses the basic one.
  const searchTool = chosenModel === "claude-haiku-4-5"
    ? { type: "web_search_20250305", name: "web_search", max_uses: 2 } // cost: each search bills ~1c
    : { type: "web_search_20260209", name: "web_search", max_uses: 2 }; // cost: each search bills ~1c

  const sys = `You are Tracely's source finder. Given a claim from a document (and optionally a proposed correction), use web search to find authoritative sources that address it.

After researching, your FINAL message must be ONLY a JSON object, no prose, in this exact shape:
{"sources":[{"title":"...","url":"...","publisher":"...","snippet":"...","stance":"supports"|"refutes"|"context"}]}

Rules:
- 3 to 5 sources, ranked best-first. Prefer primary and authoritative sources (scientific bodies, encyclopedias, government agencies, reputable news) over blogs and content farms.
- "stance" is relative to the ORIGINAL claim: "supports" backs the claim as written, "refutes" contradicts it, "context" informs without settling it.
- "snippet": one sentence (max 30 words) describing what the source says about the claim.
- Use real URLs from your search results only. Never invent URLs.`;

  const userMsg =
    `CLAIM:\n${claim}\n` +
    (correction ? `\nPROPOSED CORRECTION:\n${correction}\n` : "") +
    (context ? `\nDOCUMENT CONTEXT (excerpt):\n${context.slice(0, 3000)}\n` : "") +
    `\nFind sources, then output only the JSON object.`;

  const params = {
    model: chosenModel,
    max_tokens: 12_000,
    system: sys,
    messages: [{ role: "user", content: userMsg }],
    tools: [searchTool],
    ...(chosenModel === "claude-haiku-4-5" ? {} : { output_config: { effort: "low" } }),
  };

  let response;
  try {
    response = await anthropic.messages.stream(params).finalMessage();
    let guard = 0;
    while (response.stop_reason === "pause_turn" && guard++ < 3) {
      response = await anthropic.messages
        .stream({ ...params, messages: [...params.messages, { role: "assistant", content: response.content }] })
        .finalMessage();
    }
  } catch (err) {
    throw mapApiError(err);
  }

  if (response.stop_reason === "refusal") {
    throw new CheckError("refusal", "The model declined to research this claim.", { status: 502 });
  }

  const textBlocks = response.content.filter((b) => b.type === "text");
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
    throw new CheckError("server", "No usable sources came back — try again.", { status: 502 });
  }

  return { sources: merged, model: response.model, usage: usageOf(response) };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function usageOf(response) {
  const u = response.usage ?? {};
  return {
    input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    output: u.output_tokens ?? 0,
    cached: u.cache_read_input_tokens ?? 0,
  };
}

async function createMessage(anthropic, params, withFallbacks) {
  if (withFallbacks) {
    return anthropic.beta.messages
      .stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      .finalMessage();
  }
  return anthropic.messages.stream(params).finalMessage();
}

function addUsage(a, b) {
  return { input: a.input + b.input, output: a.output + b.output, cached: a.cached + b.cached };
}

function mapApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return new CheckError("auth", "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in tracely/.env", { status: 401 });
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(err.headers?.get?.("retry-after")) || 30;
    return new CheckError("rate_limit", `Rate limited — retrying in ${retryAfter}s.`, { status: 429, retryAfter });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new CheckError("network", "Could not reach the Anthropic API — check your connection.", { status: 502 });
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) {
      return new CheckError("overloaded", "Anthropic API is temporarily overloaded — will retry on the next cycle.", { status: 502 });
    }
    return new CheckError("server", `Anthropic API error (${err.status ?? "?"}): ${err.message}`, { status: 502 });
  }
  return new CheckError("server", `Unexpected error: ${err?.message ?? err}`, { status: 500 });
}

// ---------------------------------------------------------------------------
// Mock mode (TRACELY_MOCK=1): deterministic canned verdicts and sources so the
// UI can be exercised end-to-end without an API key. Never used with a key.
// ---------------------------------------------------------------------------
const MOCK_RULES = [
  { re: /visible from space/i, verdict: "false", explanation: "Astronauts report the Great Wall is not visible to the naked eye from orbit; many other structures are easier to see.", revise: () => "Contrary to popular belief, the Great Wall of China is not visible to the naked eye from space." },
  { re: /einstein.*(failed|flunked).*math|math.*einstein/i, verdict: "false", explanation: "Einstein excelled at mathematics; the 'failed math' story is a myth, and Edison did not invent the lightbulb alone either.", revise: () => "Contrary to a popular myth, Albert Einstein excelled at mathematics from a young age." },
  { re: /napoleon.*(short|five feet)/i, verdict: "false", explanation: "Napoleon was about 5'7\" (170 cm) — average height for his era. The 'short' myth comes from French vs English units.", revise: () => "Despite the famous myth, Napoleon was around 5'7\" — average height for a Frenchman of his era." },
  { re: /stock market|because the mitochondria/i, verdict: "incoherent", explanation: "The conclusion does not follow from the premise — cell biology has no bearing on stock movements.", revise: () => "The mitochondria is the powerhouse of the cell." },
  { re: /boils at 100|206 bones|honey never spoils/i, verdict: "accurate", explanation: "", revise: () => "" },
];

function mockFindings(sentences, model) {
  const cycle = ["accurate", "questionable", "no_claim"];
  const findings = sentences.map((s, i) => {
    const rule = MOCK_RULES.find((r) => r.re.test(s.text));
    if (rule) {
      return { id: s.id, verdict: rule.verdict, explanation: rule.explanation, revision: rule.revise(), confidence: "high" };
    }
    const verdict = cycle[i % cycle.length];
    return {
      id: s.id,
      verdict,
      explanation: verdict === "questionable" ? "Mock mode: this claim could not be verified (canned response)." : "",
      revision: verdict === "questionable" ? s.text.replace(/\.$/, "") + " (citation needed)." : "",
      confidence: "medium",
    };
  });
  return { findings, model: `${model} (mock)`, usage: { input: 0, output: 0, cached: 0 } };
}

// ---------------------------------------------------------------------------
// Flow check: paragraph-level coaching. Where the fact checker judges single
// sentences, this reads the piece as a whole and flags places where the
// writing JUMPS — a paragraph that changes subject with no transition, an
// idea introduced before it is set up. One cheap call per structural change.
// ---------------------------------------------------------------------------
const FLOW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["passage", "explanation", "transition"],
        properties: {
          passage: { type: "string", description: "The first sentence of the passage that reads abruptly, copied VERBATIM from the document." },
          explanation: { type: "string", description: "One or two sentences: what the reader loses at this jump." },
          transition: { type: "string", description: "A single sentence that could be inserted immediately BEFORE the passage to bridge the gap. Plain prose, no quotes." },
        },
      },
    },
  },
};

function flowSystemPrompt() {
  return `You are Tracely's flow coach. You read a student's essay as a whole and find places where the WRITING JUMPS — where a reader would lose the thread.

Flag a passage only when one of these is true:
- The paragraph changes subject with no transition from what came before.
- An idea, term, or example arrives before it has been set up.
- Two adjacent paragraphs are in the wrong order for the argument.
- A conclusion appears without the step that earns it.

Do NOT flag: grammar, word choice, tone, sentence length, factual errors, or anything a proofreader would catch. Those are other tools' jobs. Do not flag a paragraph merely for starting a new topic if a transition is already present.

Be strict. Most well-organized essays have ZERO flow issues; return an empty list in that case. Never report more than 3, and rank the most damaging first.

For each issue:
- "passage": copy the FIRST SENTENCE of the offending passage exactly as it appears in the document, character for character. It must be findable with an exact string search. Never paraphrase it, never add ellipses.
- "explanation": what the reader loses here, in plain language, addressed to the writer. Max 2 sentences.
- "transition": one sentence the writer could insert immediately before that passage to bridge the gap, written in their voice and using their subject matter. It must stand alone as prose.`;
}

export async function runFlowCheck({ text, model, mock = false }) {
  const chosenModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
  if (mock) return mockFlow(chosenModel);

  const anthropic = getClient();
  // Flow is judged on structure, so the WHOLE piece goes in (clamped) — unlike
  // the sentence checker, a trimmed body would hide the very jumps we hunt.
  const body = text.length > 12_000 ? text.slice(0, 12_000) + "\n[… document truncated …]" : text;
  const params = {
    model: chosenModel,
    max_tokens: 8_000,
    system: [{ type: "text", text: flowSystemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `DOCUMENT:\n\n${body}\n\nFind the flow problems. Return an empty list if the piece already reads smoothly.` }],
    output_config: { format: { type: "json_schema", schema: FLOW_SCHEMA } },
  };

  let response;
  try {
    response = await createMessage(anthropic, params, false);
  } catch (err) {
    throw mapApiError(err);
  }
  if (response.stop_reason === "refusal") {
    throw new CheckError("refusal", "The model declined to review this document.", { status: 502 });
  }

  const textBlock = response.content.find((b) => b.type === "text");
  let parsed;
  try {
    parsed = JSON.parse(textBlock?.text ?? "{}");
  } catch {
    throw new CheckError("server", "Model returned unparseable output.", { status: 502 });
  }

  // Only keep issues whose passage really is in the document — a paraphrased
  // anchor can't be located on the page, so it would render nothing.
  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const hay = norm(text);
  const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
    .map((i) => ({
      passage: String(i?.passage ?? "").trim().slice(0, 400),
      explanation: String(i?.explanation ?? "").slice(0, 400),
      transition: String(i?.transition ?? "").slice(0, 400),
    }))
    .filter((i) => i.passage.length >= 12 && hay.includes(norm(i.passage)))
    .slice(0, 3);

  return { issues, model: response.model, usage: usageOf(response) };
}

function mockFlow(model) {
  return {
    issues: [{
      passage: "Grid storage remains one of the biggest technical challenges facing renewable adoption today.",
      explanation: "This part of the text doesn't flow correctly — it jumps into grid storage without transitioning from the point about solar and wind costs.",
      transition: "Falling costs, however, only solve half the problem.",
    }],
    model: `${model} (mock)`,
    usage: { input: 0, output: 0, cached: 0 },
  };
}

function mockSources(claim, model) {
  return {
    sources: [
      { title: "Great Wall of China — Visibility from space", url: "https://en.wikipedia.org/wiki/Great_Wall_of_China", publisher: "en.wikipedia.org", snippet: "Notes that the wall is not visible to the naked eye from low Earth orbit, per astronaut accounts.", stance: "refutes" },
      { title: "China's Wall Less Great in View from Space", url: "https://www.nasa.gov/vision/space/workinginspace/great_wall.html", publisher: "nasa.gov", snippet: "NASA explains the Great Wall is generally invisible to the unaided eye from orbit.", stance: "refutes" },
      { title: "Is the Great Wall of China visible from space?", url: "https://www.scientificamerican.com/article/is-chinas-great-wall-visible-from-space/", publisher: "scientificamerican.com", snippet: "Reviews the myth and what astronauts actually report seeing from orbit.", stance: "context" },
    ].map((s, i) => ({ ...s, snippet: `[mock] ${s.snippet}` })),
    model: `${model} (mock)`,
    usage: { input: 0, output: 0, cached: 0 },
  };
}
