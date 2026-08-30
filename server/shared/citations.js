/**
 * Pure citation formatters + shape-only citation checks. No AI, no network,
 * no node imports — this file is served to the browser at /shared/citations.js
 * and imported by the server, so it must stay dependency-free ESM.
 *
 * Source shape:
 * { title, authors: ["Family, Given" or "Given Family"], year, venue,
 *   venueType: journal|book|chapter|web|report|news|encyclopedia,
 *   doi, url, publisher, pages }
 */

// ── author name handling ───────────────────────────────────────────────

function parseAuthor(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const comma = s.indexOf(",");
  if (comma !== -1) {
    const family = s.slice(0, comma).trim();
    const given = s.slice(comma + 1).trim();
    if (!family) return null;
    return { family, given };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { family: parts[0], given: "" };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

function initials(given) {
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + ".")
    .join(" ");
}

// An "author" that is a placeholder rather than a person. Providers send
// placeholders AS DATA — "Unknown Author", "Unknown" — and an empty list is
// only one of the shapes "no author" arrives in. Both name parts must be
// placeholder-or-absent for the record to be dropped: a real given name means
// something was actually parsed, and dropping it would lose an attribution.
// "Anonymous" is deliberately NOT here — it is a real, correct attribution for
// genuinely anonymous works. (Ported from the production placeholderAuthor.ts.)
const PLACEHOLDER_NAME =
  /^(?:unknown(?:\s+author)?|no\s+author|author(?:\s*name)?|authorname|firstname|lastname|full\s*name|your\s*name|insert(?:\s+author)?|tbd|todo|x{3,}|n\/?a|none|null|undefined|placeholder|et\s+al\.?)$/i;

function isPlaceholderPart(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" || PLACEHOLDER_NAME.test(trimmed);
}

function isPlaceholderAuthor(a) {
  return isPlaceholderPart(a.family) && isPlaceholderPart(a.given);
}

const apaName = (a) => (a.given ? `${a.family}, ${initials(a.given)}` : a.family);
const invertedName = (a) => (a.given ? `${a.family}, ${a.given}` : a.family);
const naturalName = (a) => (a.given ? `${a.given} ${a.family}` : a.family);

// Entry author lists per current style-guide editions:
// APA 7 lists every author up to 20 (never "et al." in an entry; 21+ → first
// 19, ellipsis, final author). MLA 9 names both of two authors and truncates
// three-or-more to first + "et al.". Chicago follows CMOS 18 bibliography
// form: all authors up to six; seven-or-more → first three + "et al.".
function apaAuthorList(authors) {
  const n = authors.length;
  if (n === 1) return apaName(authors[0]);
  if (n >= 21) {
    // APA 7: first 19 authors, an ellipsis, then the final author — no "&".
    const head = authors.slice(0, 19).map(apaName).join(", ");
    return `${head}, . . . ${apaName(authors[n - 1])}`;
  }
  const head = authors.slice(0, -1).map(apaName).join(", ");
  return `${head}, & ${apaName(authors[n - 1])}`;
}

function mlaAuthorList(authors) {
  const n = authors.length;
  if (n === 1) return invertedName(authors[0]);
  if (n === 2) return `${invertedName(authors[0])}, and ${naturalName(authors[1])}`;
  return `${invertedName(authors[0])}, et al.`; // MLA 9: three or more → first + et al.
}

function chicagoAuthorList(authors) {
  const n = authors.length;
  if (n === 1) return invertedName(authors[0]);
  if (n >= 7) {
    // CMOS 18 bibliography: seven or more → first three + et al.
    return `${invertedName(authors[0])}, ${naturalName(authors[1])}, ${naturalName(authors[2])}, et al.`;
  }
  const head = [invertedName(authors[0]), ...authors.slice(1, -1).map(naturalName)].join(", ");
  return `${head}, and ${naturalName(authors[n - 1])}`;
}

// In-text leads (family names only).
function apaInTextLead(authors) {
  if (authors.length >= 3) return `${authors[0].family} et al.`;
  if (authors.length === 2) return `${authors[0].family} & ${authors[1].family}`;
  return authors[0].family;
}

function mlaInTextLead(authors) {
  if (authors.length >= 3) return `${authors[0].family} et al.`;
  if (authors.length === 2) return `${authors[0].family} and ${authors[1].family}`;
  return authors[0].family;
}

function chicagoInTextLead(authors) {
  const n = authors.length;
  if (n >= 4) return `${authors[0].family} et al.`;
  if (n === 3) return `${authors[0].family}, ${authors[1].family}, and ${authors[2].family}`;
  if (n === 2) return `${authors[0].family} and ${authors[1].family}`;
  return authors[0].family;
}

// ── punctuation helpers ────────────────────────────────────────────────

/** Append a period unless the string already ends in terminal punctuation —
 *  a title's own "?" or "!" replaces the period rather than doubling it. */
function endDot(s) {
  return /[.?!]$/.test(s) ? s : `${s}.`;
}

/** Quoted title for MLA/Chicago; terminal punctuation lives inside the quotes. */
function quoteTitle(title) {
  return `"${endDot(title)}"`;
}

/** Short quoted title for in-text markers when the title leads the entry. */
function quotedShort(title) {
  const words = String(title).trim().split(/\s+/);
  let short = words.slice(0, 4).join(" ");
  short = short.replace(/[.,:;]+$/, "");
  return `"${short}"`;
}

// ── locator: decided by SOURCE TYPE, not "DOI if there is one" ─────────

function doiUrl(doi) {
  const d = String(doi).trim().replace(/^doi:\s*/i, "");
  return /^https?:\/\//i.test(d) ? d : `https://doi.org/${d}`;
}

function locatorFor(src) {
  switch (src.venueType) {
    case "journal":                              // journal article → doi
    case "chapter":                              // nothing catalogues chapter six of an edited collection
      // DOI first, URL as the fallback: an article without a DOI is one a
      // reader may well need a link to, and a missing locator is the harder
      // problem — an unfamiliar title with no link cannot be checked at all.
      return src.doi ? doiUrl(src.doi) : (src.url ?? null);
    case "web":
    case "news":
    case "report":
    case "encyclopedia":                         // publisher page or nothing — never a database's DOI
      return src.url ?? null;
    case "book":                                 // whole book → neither
      return null;
    default:
      // Unclassified: prefer the page a reader can open over an identifier
      // they would have to resolve first — but an identifier beats nothing.
      return src.url ?? (src.doi ? doiUrl(src.doi) : null);
  }
}

// ── formatCitation ─────────────────────────────────────────────────────

/**
 * @param {object} source  see shape above
 * @param {"apa"|"mla"|"chicago"} style
 * @returns {{ entry: string, inText: string }}
 * Plain text only — italics are not renderable here, so no markup is emitted.
 * An empty author list moves the TITLE into the author slot (never a
 * placeholder like "Unknown Author"), and the in-text marker leads with
 * whatever the entry leads with.
 */
export function formatCitation(source, style = "apa") {
  const src = source ?? {};
  // Placeholder "authors" are filtered out, not formatted: "Unknown Author"
  // in a reference list reads to a marker exactly like an invented source, so
  // a source whose only author is a placeholder formats title-first instead.
  const authors = (Array.isArray(src.authors) ? src.authors : [])
    .map(parseAuthor)
    .filter(Boolean)
    .filter((a) => !isPlaceholderAuthor(a));
  const title = String(src.title ?? "").trim();
  const year = src.year ?? null;
  const venueName = String(src.venue ?? src.publisher ?? "").trim();
  const pages = src.pages != null && src.pages !== "" ? String(src.pages).trim() : "";
  const locator = locatorFor(src);
  const titleLeads = authors.length === 0;

  // The in-text lead when the title stands in for an author: a short quoted
  // title, then the venue (an institutional page with no title still files
  // under its publisher), then nothing — the year alone is a poor marker and
  // an honest one; a placeholder name is neither.
  const titleLead = () => {
    if (title) return quotedShort(title);
    if (venueName) return quotedShort(venueName);
    return null;
  };

  if (style === "mla") {
    const head = titleLeads
      ? quoteTitle(title)
      : `${endDot(mlaAuthorList(authors))} ${quoteTitle(title)}`;
    const tail = [
      venueName || null,
      year != null ? String(year) : null,
      pages ? `pp. ${pages}` : null,
      locator,
    ].filter(Boolean);
    const entry = tail.length ? `${head} ${tail.join(", ")}.` : head;
    const lead = titleLeads ? titleLead() : mlaInTextLead(authors);
    const inText = lead ? `(${lead})` : (year != null ? `(${year})` : "");
    return { entry, inText };
  }

  if (style === "chicago") {
    const head = titleLeads
      ? quoteTitle(title)
      : `${endDot(chicagoAuthorList(authors))} ${quoteTitle(title)}`;
    let mid = "";
    if (venueName) {
      mid = venueName + (year != null ? ` (${year})` : "") + (pages ? `: ${pages}` : "");
      mid = endDot(mid);
    } else if (year != null) {
      mid = `(${year}).`;
    }
    const entry = [head, mid || null, locator ? endDot(locator) : null].filter(Boolean).join(" ");
    const lead = titleLeads ? titleLead() : chicagoInTextLead(authors);
    const inText = lead ? `(${lead} ${year ?? "n.d."})` : `(${year ?? "n.d."})`;
    return { entry, inText };
  }

  // APA (default)
  const yearSeg = `(${year ?? "n.d."}).`;
  const parts = [];
  if (titleLeads) {
    parts.push(endDot(title), yearSeg);
  } else {
    parts.push(endDot(apaAuthorList(authors)), yearSeg, endDot(title));
  }
  if (venueName) parts.push(endDot(pages ? `${venueName}, ${pages}` : venueName));
  if (locator) parts.push(locator); // APA: no trailing period after a DOI/URL
  const lead = titleLeads ? titleLead() : apaInTextLead(authors);
  const inText = lead ? `(${lead}, ${year ?? "n.d."})` : `(${year ?? "n.d."})`;
  return { entry: parts.join(" "), inText };
}

// ── detectCitationDefects: shape-only, free, instant ───────────────────

// Citation-shaped years. A parenthetical only counts when it is either
// bare-year-led ("(2020)", "(2020, p. 3)") or carries an author-shaped token —
// a capitalized word, "et al.", or "n.d." — somewhere before the year
// ("(Smith, 2020)", "(see Smith 2020)", "(e.g., Jones & Lee, 2019)"). That
// lookahead is what keeps plain prose parentheticals — "(by 2050)",
// "(since 1880)", "(in 2020)" — from reading as citations. Square-bracket
// years stay shape-only: reference-list lines are author-led anyway.
const YEAR_SRC = "(?:1[5-9]|2[01])\\d{2}";
const AUTHOR_SHAPE = "(?:[A-Z][A-Za-z.&'’-]|et al\\.|n\\.d\\.)";
const PAREN_YEAR_BARE = new RegExp(`\\(\\s*(${YEAR_SRC})[a-z]?(?:\\s*[,;:]\\s*[^()]{0,40})?\\)`);
const PAREN_YEAR_AUTHOR = new RegExp(
  `\\((?=[^()]{0,60}?${AUTHOR_SHAPE})[^()]{0,60}?[,;\\s](${YEAR_SRC})[a-z]?(?:[^()]{0,40})?\\)`
);
const SQUARE_YEAR = new RegExp(`\\[[^()\\[\\]]*?\\b(${YEAR_SRC})[a-z]?\\b[^()\\[\\]]*\\]`, "g");
const CITATION_YEAR_RES = [
  SQUARE_YEAR,
  new RegExp(PAREN_YEAR_BARE.source, "g"),
  new RegExp(PAREN_YEAR_AUTHOR.source, "g"),
];

// Placeholder-author vocabulary, matched INSIDE citation-shaped parentheticals
// (ones carrying a year or n.d.). Ported from the production citationShape.ts.
// "Anonymous" is deliberately absent: it is a real and correct attribution for
// genuinely anonymous works, and flagging it is the kind of confident
// wrongness that teaches a writer to ignore the whole category.
const PLACEHOLDER_AUTHOR_TOKEN =
  /\b(?:unknown(?: author)?|no author|author ?name|authorname|firstname|lastname|full ?name|your ?name|insert(?: author)?|tbd|todo|xxx+|n\/a|placeholder)\b/i;

// A note to self where a reference should be: "[citation needed]", "(source)",
// "(cite)", "(add citation)". Also from citationShape.ts.
const PLACEHOLDER_CITATION_RE =
  /\[\s*(?:citation needed|cite|ref|source|citation)\s*\]|\(\s*(?:citation needed|citation|insert citation|add citation|cite|cite this|ref|reference|source|sources)\s*\)/i;

// A URL standing in for a reference IN TEXT: "(https://example.com/story)".
const PAREN_BARE_URL = /\(\s*(?:https?:\/\/|www\.)[^\s)]{4,}\s*\)/i;

// Does a parenthetical carry the marks of a reference at all? (year or n.d.)
const REFERENCE_SHAPED = /\b(?:1[5-9]|2[01])\d{2}[a-z]?\b|\bn\.?\s?d\.?\b/i;

/**
 * Defects decidable from the SHAPE of the text alone.
 * @returns {string[]} subset of: placeholder-author, citation-needed,
 *   future-year, bare-url, duplicate-reference
 */
export function detectCitationDefects(text) {
  const t = String(text ?? "");
  const out = new Set();

  // "Unknown Author" must never appear — anywhere, including reference lines.
  if (/\bUnknown Author\b/i.test(t)) out.add("placeholder-author");
  // Placeholder tokens inside citation-shaped parentheticals: "(TBD, 2020)",
  // "(no author, n.d.)". Scoped to reference-shaped parens so ordinary prose
  // ("the placeholder text (see above)") cannot fire it.
  for (const m of t.matchAll(/\(([^()]{0,90})\)/g)) {
    const inner = m[1];
    if (REFERENCE_SHAPED.test(inner) && PLACEHOLDER_AUTHOR_TOKEN.test(inner)) {
      out.add("placeholder-author");
      break;
    }
  }

  if (PLACEHOLDER_CITATION_RE.test(t)) out.add("citation-needed");

  const currentYear = new Date().getFullYear();
  const hasFutureYear = CITATION_YEAR_RES.some((re) =>
    [...t.matchAll(re)].some((m) => Number(m[1]) > currentYear)
  );
  if (hasFutureYear) out.add("future-year");

  const lines = t.split(/\n/);

  // A URL standing in for a reference in-text: "(https://example.com/story)".
  if (PAREN_BARE_URL.test(t)) out.add("bare-url");

  // A naked URL doing citation duty: nothing but the URL (and scraps) on its line.
  for (const line of lines) {
    const urls = line.match(/https?:\/\/\S+/g);
    if (!urls) continue;
    let rest = line;
    for (const u of urls) rest = rest.replace(u, " ");
    const letters = (rest.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 4) { out.add("bare-url"); break; }
  }

  // The same reference string pasted twice.
  const seen = new Set();
  for (const line of lines) {
    const norm = line.trim().replace(/\s+/g, " ");
    if (norm.length < 15) continue;
    const looksRef = /\b(?:1[5-9]|2[01])\d{2}\b|https?:\/\/|\b10\.\d{4,9}\//.test(norm);
    if (!looksRef) continue;
    if (seen.has(norm)) out.add("duplicate-reference");
    seen.add(norm);
  }

  return [...out];
}

// ── detectProseAttribution: citations do not need parentheses ──────────

const PRONOUNS = new Set([
  "he", "she", "they", "him", "her", "them", "it", "i", "me", "we", "us", "you",
  "one", "this", "that", "these", "those", "himself", "herself", "themselves",
]);
// Sentence-initial capitalised words that name nobody in particular.
const GENERIC_LEADS = new Set([
  "studies", "research", "data", "results", "evidence", "some", "many", "most",
  "others", "people", "everyone", "someone", "anyone", "nobody", "critics",
  // Plural generic-person subjects name nobody either — "Scientists claim
  // that…" is exactly the vague attribution the product exists to flag.
  "researchers", "scientists", "experts", "doctors", "analysts", "economists",
  "historians", "officials", "authorities", "sources", "reports",
]);

const ENTITY = "((?:[Tt]he\\s+)?[A-Z][A-Za-z.&'’-]*(?:\\s+(?:[A-Z][A-Za-z.&'’-]*|of|for|the|and|from|at|&))*)";
const REPORT_VERBS =
  "(?:reports?|reported|argues?|argued|finds?|found|show(?:s|ed)?|notes?|noted|writes?|wrote|says?|said|claims?|claimed|concludes?|concluded|demonstrates?|demonstrated|states?|stated|estimates?|estimated|observes?|observed)";

// "… as reported BY the WHO", "… first published IN the Lancet". A participle
// pointing at a source is the writer citing in prose. (Ported from the
// production inlineCitation.ts `attributed` patterns.)
const ATTRIBUTING_PARTICIPLE =
  "(?:reported|published|documented|recorded|noted|stated|described|compiled|collected|released|issued|cited)";

// The nouns that make a possessive a citation: "UNICEF's figures put it higher".
const SOURCE_NOUN =
  "(?:reports?|stud(?:y|ies)|surveys?|analys[ie]s|data|dataset|figures|statistics|research|articles?|papers?|website|webpage|page|records|findings|account|estimates?|census|archives?|database|guidelines?|profile|biography|obituary|documentary|entry)";

const ATTRIBUTION_PATTERNS = [
  new RegExp(`\\b[Aa]ccording\\s+to\\s+${ENTITY}`),
  new RegExp(`\\b[Aa]s\\s+${ENTITY}\\s+${REPORT_VERBS}\\b`),
  new RegExp(`\\b[Pp]er\\s+${ENTITY}`),
  new RegExp(`(?:^|[.;:]\\s+|\\b)${ENTITY}\\s+${REPORT_VERBS}\\s+that\\b`),
  new RegExp(`\\b${ATTRIBUTING_PARTICIPLE}\\s+(?:by|in)\\s+${ENTITY}`),
  new RegExp(`\\b${ENTITY}['’]s\\s+(?:own\\s+)?${SOURCE_NOUN}\\b`),
];

const TRAILING_CONNECTOR = /\s+(?:of|for|the|and|from|at|&)$/;

function stripLeadingThe(s) {
  return s.replace(/^[Tt]he\s+/, "");
}

/**
 * Detects prose attribution — "According to Pearson from UNICEF", "As the Red
 * Cross reported", "Pearson argues that…", "per the CDC". These ARE citations.
 * @returns {{ speaker: string, org: string|null } | null} null for bare
 *   pronouns ("According to him") and generic subjects ("Studies show that…").
 */
export function detectProseAttribution(sentence) {
  const s = String(sentence ?? "").trim();
  if (!s) return null;

  for (const pattern of ATTRIBUTION_PATTERNS) {
    const m = s.match(pattern);
    if (!m) continue;
    let entity = m[1].trim().replace(/\.+$/, ""); // sentence-final period is not part of the name
    while (TRAILING_CONNECTOR.test(entity)) entity = entity.replace(TRAILING_CONNECTOR, "");
    if (!entity) continue;

    const bare = stripLeadingThe(entity);
    const words = bare.split(/\s+/);
    if (words.length === 1 && PRONOUNS.has(words[0].toLowerCase())) continue;
    if (words.length === 1 && GENERIC_LEADS.has(words[0].toLowerCase())) continue;

    const split = bare.match(/^(.+?)\s+(?:from|at)\s+(.+)$/);
    if (split) {
      return { speaker: split[1].trim(), org: stripLeadingThe(split[2].trim()) };
    }
    return { speaker: bare, org: null };
  }
  return null;
}

// ── hasOwnCitation ─────────────────────────────────────────────────────

const PAREN_ND = /\([^()]{0,60}\bn\.d\.[^()]{0,40}\)/;
const BRACKET_MARKER = /\[\d{1,3}(?:\s*[,–-]\s*\d{1,3})*\]/;
const DOI_OR_URL = /https?:\/\/\S{4,}|\b10\.\d{4,9}\/[^\s"<>]+|\bdoi:\s*10\./i;

// ── shapes ported from the production inlineCitation.ts ────────────────
// Each requires something that does not occur by accident in ordinary prose.

// MLA 9 author-page: (Shoup 45) · (Shoup 45-47) · (Mueller and Oppenheimer 1163).
// MLA has no year in the text at all — it lives only in the Works Cited — so
// none of the year-anchored shapes can ever match an MLA essay, and MLA is the
// default in US high-school English. A capitalised word beside a bare number
// IS the citation, so this is the one pattern that needs a stoplist to hold
// back structural pointers: (Table 3), (Chapter 11), (Proposition 13).
const NOT_AN_AUTHOR =
  "Table|Fig|Figure|Chart|Graph|Chapter|Ch|Section|Sec|Part|Page|Pages|Volume|Vol|Appendix|Equation|Eq|Step|Item|Note|Line|Row|Column|Level|Grade|Round|Phase|Class|Type|Version|Model|Form|Room|Box|Panel|Article|Clause|Rule|Title|Proposition|Prop|Measure|Bill|Amendment|Act";
const MLA_SURNAME = "(?:(?:van|von|de|del|della|da|di|du|dos|das|la|le|el|al|bin|ibn|ter|ten|den)\\s+)?[A-Z][A-Za-z'’-]+";
const AUTHOR_PAGE = new RegExp(
  `\\((?!(?:${NOT_AN_AUTHOR})\\b)${MLA_SURNAME}(?:\\s+(?:et al\\.?|and\\s+${MLA_SURNAME}|&\\s*${MLA_SURNAME}))?\\s+(?:pp?\\.\\s*)?\\d{1,4}(?:\\s*[–—-]\\s*\\d{1,4})?\\s*\\)`
);

// A quoted title in brackets, with no year — the MLA short form for a source
// with no dated author: ("Background to the Convention"). The 6-character
// floor inside the quotes keeps ordinary quoted speech out: (he said "no")
// does not match because the quote must open the parenthetical.
const TITLED_PAREN = /\(\s*["“][^"”)]{6,}["”][^)]*\)/;

// Chicago notes shorthand for "the source I just cited". Unambiguous — these
// strings do not occur in ordinary prose.
const IBID = /\((?:ibid|id|op\.\s*cit|loc\.\s*cit)\b\.?[^)]{0,24}\)/i;

// Superscript reference marks, as Word produces for footnotes.
const SUPERSCRIPT_MARK = /[¹²³⁰-⁹]/;

// Rendered text usually loses the scheme: what is on screen is
// www.oecd.org/education/report.pdf.
const WWW_URL = /\bwww\.\S+\.\S+/i;

/**
 * True when the sentence carries its own citation: a parenthetical citation
 * ((Author, 2020), (Author 2020), (Shoup 45), ("Titled Page"), (ibid.),
 * [1]-style, a footnote mark), a DOI/URL, or prose attribution.
 */
export function hasOwnCitation(sentence) {
  const s = String(sentence ?? "");
  if (!s.trim()) return false;
  if (PAREN_YEAR_BARE.test(s) || PAREN_YEAR_AUTHOR.test(s) || PAREN_ND.test(s)) return true;
  if (BRACKET_MARKER.test(s)) return true;
  if (DOI_OR_URL.test(s) || WWW_URL.test(s)) return true;
  if (AUTHOR_PAGE.test(s) || TITLED_PAREN.test(s) || IBID.test(s)) return true;
  if (SUPERSCRIPT_MARK.test(s)) return true;
  return detectProseAttribution(s) != null;
}

// The scaffold stub exported this name; keep it as an alias so nothing breaks.
export { detectCitationDefects as detectDefects };
