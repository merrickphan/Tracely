/**
 * Pure-piece tests for the evidence pipeline — no network. Providers are
 * exercised only through the exported pure functions (dedupe, relevance,
 * strength, venue classification, routing).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDoi,
  dedupeSources,
  lexicalRelevance,
  strengthScore,
  classifyVenueType,
  routeProviders,
  isCitable,
  compareSource,
  COMPARE_RESOLVE_FLOOR,
} from "../lib/evidence.js";
import { RELEVANCE_FLOOR_LEXICAL } from "../shared/marks.js";

// ── normalizeDoi ───────────────────────────────────────────────────────

test("normalizeDoi lowercases and strips resolver prefixes", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1000/ABC"), "10.1000/abc");
  assert.equal(normalizeDoi("http://dx.doi.org/10.5555/Y12"), "10.5555/y12");
  assert.equal(normalizeDoi("doi:10.1/x"), "10.1/x");
  assert.equal(normalizeDoi("  10.1000/xyz  "), "10.1000/xyz");
  assert.equal(normalizeDoi(null), null);
  assert.equal(normalizeDoi(""), null);
});

// ── dedupeSources ──────────────────────────────────────────────────────

test("dedupes by DOI across resolver-prefix and case differences", () => {
  const kept = {
    doi: "https://doi.org/10.1000/XYZ", title: "Paper One", year: 2020,
    provider: "openalex", authors: [], abstract: null, oaUrl: null, venueType: "journal",
  };
  const dupe = {
    doi: "10.1000/xyz", title: "Paper One — publisher variant title", year: 2020,
    provider: "crossref", authors: ["A. Author"], abstract: "The abstract.", oaUrl: null, venueType: "journal",
  };
  const out = dedupeSources([kept, dupe]);
  assert.equal(out.length, 1);
  assert.equal(out[0].provider, "openalex"); // first occurrence wins
  assert.equal(out[0].abstract, "The abstract."); // missing fields backfilled
  assert.deepEqual(out[0].authors, ["A. Author"]);
});

test("falls back to normalized title+year when there is no DOI", () => {
  const a = { doi: null, title: "Shared  Title!", year: 2019, provider: "openalex", venueType: "web" };
  const b = { doi: null, title: "shared title", year: 2019, provider: "semanticscholar", venueType: "journal" };
  const c = { doi: null, title: "shared title", year: 2018, provider: "crossref", venueType: "journal" };
  const out = dedupeSources([a, b, c]);
  assert.equal(out.length, 2); // same title, different year → distinct
  assert.equal(out[0].venueType, "journal"); // "web" default upgraded by the dupe
});

test("a titleless or null entry is dropped, not crashed on", () => {
  const out = dedupeSources([null, { doi: null, title: "", year: 2020 }, { doi: null, title: "Real", year: 2020 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Real");
});

// ── lexicalRelevance ───────────────────────────────────────────────────

const CLAIM = "Coffee consumption reduces the risk of type 2 diabetes";

test("relevance orders a full match above a partial match above junk", () => {
  const full = lexicalRelevance(CLAIM, "Coffee consumption and risk of type 2 diabetes: a systematic review");
  const partial = lexicalRelevance(CLAIM, "Tea consumption and cardiovascular risk in adults");
  const junk = lexicalRelevance(CLAIM, "Deep learning approaches for semantic image segmentation");
  assert.ok(full > partial, `expected ${full} > ${partial}`);
  assert.ok(partial > junk, `expected ${partial} > ${junk}`);
  assert.equal(junk, 0);
});

test("floor separates on-topic sources from junk", () => {
  const full = lexicalRelevance(CLAIM, "Coffee consumption and risk of type 2 diabetes: a systematic review");
  const junk = lexicalRelevance(CLAIM, "Deep learning approaches for semantic image segmentation");
  assert.ok(full >= RELEVANCE_FLOOR_LEXICAL, `expected ${full} >= floor ${RELEVANCE_FLOOR_LEXICAL}`);
  assert.ok(junk < RELEVANCE_FLOOR_LEXICAL);
});

test("relevance is deterministic, bounded 0..1, and empty-safe", () => {
  const a = lexicalRelevance(CLAIM, "Coffee and diabetes");
  const b = lexicalRelevance(CLAIM, "Coffee and diabetes");
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 1);
  assert.equal(lexicalRelevance("", "anything"), 0);
  assert.equal(lexicalRelevance(CLAIM, ""), 0);
  assert.equal(lexicalRelevance("the of and", "the of and"), 0); // stopwords only
});

// ── strengthScore ──────────────────────────────────────────────────────

test("empty above-floor set → strength null, never a 0 score", () => {
  assert.equal(strengthScore([]), null);
  assert.equal(strengthScore(undefined), null);
});

test("known value: one recent journal source at full relevance → 81", () => {
  const s = strengthScore(
    [{ venueType: "journal", year: 2026, relevance: 1 }],
    { nowYear: 2026 }
  );
  assert.deepEqual(s, {
    score: 81,
    metric: "lexical",
    breakdown: { sourceCount: 6, venueQuality: 25, recency: 25, relevanceRank: 25 },
  });
});

test("known value: four web sources, no years, top relevance 0.5 → 52", () => {
  const list = [0.5, 0.4, 0.3, 0.2].map((relevance) => ({ venueType: "web", year: null, relevance }));
  const s = strengthScore(list, { nowYear: 2026 });
  assert.deepEqual(s.breakdown, { sourceCount: 25, venueQuality: 6, recency: 8, relevanceRank: 13 });
  assert.equal(s.score, 52);
  assert.equal(s.metric, "lexical");
});

test("recency scales: ≤5y=25, 30y interpolates to 15, ≥60y=3, missing=8", () => {
  const mk = (year) => strengthScore([{ venueType: "journal", year, relevance: 1 }], { nowYear: 2026 });
  assert.equal(mk(2024).breakdown.recency, 25);
  assert.equal(mk(1996).breakdown.recency, 15);
  assert.equal(mk(1950).breakdown.recency, 3);
  assert.equal(mk(null).breakdown.recency, 8);
});

test("venueQuality takes the best above-floor source; sourceCount caps at 4+", () => {
  const s = strengthScore(
    [
      { venueType: "web", year: 2025, relevance: 0.9 },
      { venueType: "journal", year: 2025, relevance: 0.6 },
      { venueType: "news", year: 2025, relevance: 0.5 },
      { venueType: "book", year: 2025, relevance: 0.4 },
      { venueType: "web", year: 2025, relevance: 0.3 },
    ],
    { nowYear: 2026 }
  );
  assert.equal(s.breakdown.venueQuality, 25); // journal is the best present
  assert.equal(s.breakdown.sourceCount, 25); // 5 sources → 4+ bucket
});

test("every breakdown part stays within 0-25", () => {
  const s = strengthScore(
    [{ venueType: "encyclopedia", year: 2024, relevance: 0.9 }],
    { nowYear: 2026 }
  );
  for (const part of Object.values(s.breakdown)) {
    assert.ok(part >= 0 && part <= 25, `part ${part} out of range`);
  }
  assert.equal(s.breakdown.venueQuality, 2);
  assert.equal(s.score, 6 + 2 + 25 + 23);
});

// ── classifyVenueType ──────────────────────────────────────────────────

test("venue classification table", () => {
  assert.equal(classifyVenueType({ provider: "crossref", type: "journal-article" }), "journal");
  assert.equal(classifyVenueType({ provider: "openalex", type: "article" }), "journal");
  assert.equal(classifyVenueType({ provider: "crossref", type: "book" }), "book");
  assert.equal(classifyVenueType({ provider: "crossref", type: "book-chapter" }), "chapter");
  assert.equal(classifyVenueType({ provider: "crossref", type: "report" }), "report");
  assert.equal(classifyVenueType({ provider: "pubmed" }), "journal");
  assert.equal(classifyVenueType({ provider: "wikipedia" }), "encyclopedia");
  assert.equal(classifyVenueType({ provider: "worldbank" }), "report");
  assert.equal(classifyVenueType({ provider: "openlibrary" }), "book");
  assert.equal(classifyVenueType({ provider: "semanticscholar", venue: "Nature" }), "journal");
  assert.equal(classifyVenueType({ provider: "semanticscholar", venue: "" }), "web");
  assert.equal(classifyVenueType({ provider: "openalex", type: "dataset" }), "web"); // unknown type → default
  assert.equal(classifyVenueType({}), "web");
});

// ── citability ─────────────────────────────────────────────────────────

test("encyclopedias are never citable; DOI or a real venue type is", () => {
  assert.equal(isCitable({ venueType: "encyclopedia", doi: "10.1/x" }), false);
  assert.equal(isCitable({ venueType: "journal", doi: null }), true);
  assert.equal(isCitable({ venueType: "web", doi: "10.1/x" }), true);
  assert.equal(isCitable({ venueType: "web", doi: null }), false);
  assert.equal(isCitable({ venueType: "report", doi: null }), true);
  assert.equal(isCitable(null), false);
});

// ── routeProviders ─────────────────────────────────────────────────────

test("core three always run and Wikipedia rides along on the general tier", () => {
  const names = routeProviders({ claim: "The Great Wall of China is over 13,000 miles long", claimType: "factual" });
  assert.deepEqual(names, ["openalex", "crossref", "semanticscholar", "wikipedia"]);
});

test("statistic claims ADD World Bank — never replacing the core three", () => {
  const names = routeProviders({ claim: "Global literacy rose to 87 percent", claimType: "statistic" });
  assert.deepEqual(names, ["openalex", "crossref", "semanticscholar", "worldbank", "wikipedia"]);
});

test("biomedical keywords ADD PubMed", () => {
  const names = routeProviders({ claim: "The vaccine reduced mortality in cancer patients", claimType: "factual" });
  assert.deepEqual(names, ["openalex", "crossref", "semanticscholar", "pubmed", "wikipedia"]);
});

test("biomedical statistic gets both PubMed and World Bank", () => {
  const names = routeProviders({ claim: "Diabetes affects 10 percent of adults", claimType: "statistic" });
  assert.deepEqual(names, ["openalex", "crossref", "semanticscholar", "pubmed", "worldbank", "wikipedia"]);
});

test("biomedical match may come from the query, not just the claim", () => {
  const names = routeProviders({ claim: "It spreads quickly", query: "influenza virus transmission", claimType: "factual" });
  assert.ok(names.includes("pubmed"));
});

// ── compareSource (fetch stubbed — no network) ─────────────────────────
// Crossref's fuzzy bibliographic search returns SOMETHING for nearly any
// string, so "resolved" must mean "a hit above COMPARE_RESOLVE_FLOOR",
// not "any hit at all" — otherwise fabricated citations always resolve.

function stubFetch(crossrefItems, openLibraryDocs) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.crossref.org")) {
      return { ok: true, json: async () => ({ message: { items: crossrefItems } }) };
    }
    if (u.includes("openlibrary.org")) {
      return { ok: true, json: async () => ({ docs: openLibraryDocs }) };
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
  return () => { globalThis.fetch = original; };
}

const crItem = (title, family, year) => ({
  DOI: `10.1000/${title.toLowerCase().replace(/[^a-z]+/g, "-")}`,
  title: [title],
  author: [{ given: "A.", family }],
  issued: { "date-parts": [[year]] },
  "container-title": ["Some Journal"],
  type: "journal-article",
  URL: "https://example.org/work",
});

test("compareSource: a fabricated ref with only loosely related hits does NOT resolve", async () => {
  const restore = stubFetch(
    [
      crItem("Microbial dynamics in cheese ripening", "Garcia", 2019),
      crItem("Lunar surface geology from returned samples", "Chen", 2019),
      crItem("Hypothesis testing in observational studies", "Okafor", 2019),
    ],
    []
  );
  try {
    const r = await compareSource({
      citedRef: "Smith, J. (2019). The Lunar Cheese Hypothesis. Journal of Imaginary Results.",
    });
    assert.equal(r.resolved, false);
    assert.equal(r.matches.length, 0);
    assert.equal(r.nearMisses.length, 3);
    assert.ok(r.nearMisses.every((m) => m.relevance < COMPARE_RESOLVE_FLOOR));
    assert.match(r.resolvedNote, /only loosely related/);
    assert.match(r.resolvedNote, /does NOT mean the source is fake/);
  } finally {
    restore();
  }
});

test("compareSource: a genuine ref resolves, and a coincidental year adds nothing", async () => {
  const restore = stubFetch(
    [
      crItem("Rising seas and coastal flooding", "Pearson", 2020),
      crItem("Unrelated study of soil chemistry", "Wu", 2020), // same year as the ref
    ],
    []
  );
  try {
    const r = await compareSource({
      citedRef: "Pearson, J. (2020). Rising seas and coastal flooding. Nature.",
    });
    assert.equal(r.resolved, true);
    assert.equal(r.resolvedNote, undefined);
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].title, "Rising seas and coastal flooding");
    assert.ok(r.matches[0].relevance >= COMPARE_RESOLVE_FLOOR);
    // the year-only "match" scores zero — years are stripped from scoring
    assert.equal(r.nearMisses.length, 1);
    assert.equal(r.nearMisses[0].relevance, 0);
  } finally {
    restore();
  }
});

test("compareSource: zero hits keeps the not-found caveat", async () => {
  const restore = stubFetch([], []);
  try {
    const r = await compareSource({ citedRef: "Anything at all" });
    assert.equal(r.resolved, false);
    assert.deepEqual(r.matches, []);
    assert.deepEqual(r.nearMisses, []);
    assert.match(r.resolvedNote, /Not found in Crossref or Open Library/);
    assert.match(r.resolvedNote, /does NOT mean the source is fake/);
  } finally {
    restore();
  }
});
