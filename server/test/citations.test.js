import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatCitation,
  detectCitationDefects,
  detectDefects,
  detectProseAttribution,
  hasOwnCitation,
} from "../shared/citations.js";

const journal = {
  title: "Rising seas",
  authors: ["Pearson, Jane"],
  year: 2020,
  venue: "Nature",
  venueType: "journal",
  doi: "10.1000/xyz",
};

// ── entry shapes per style ─────────────────────────────────────────────

test("APA entry: Author, A. (Year). Title. Venue. locator", () => {
  const { entry, inText } = formatCitation(journal, "apa");
  assert.equal(entry, "Pearson, J. (2020). Rising seas. Nature. https://doi.org/10.1000/xyz");
  assert.equal(inText, "(Pearson, 2020)");
});

test("MLA entry: Author. \"Title.\" Venue, Year, locator.", () => {
  const src = { ...journal, venueType: "web", doi: undefined, url: "https://noaa.gov/rising", venue: "NOAA Climate" };
  const { entry, inText } = formatCitation(src, "mla");
  assert.equal(entry, 'Pearson, Jane. "Rising seas." NOAA Climate, 2020, https://noaa.gov/rising.');
  assert.equal(inText, "(Pearson)");
});

test("Chicago entry: Author. \"Title.\" Venue (Year). locator.", () => {
  const { entry, inText } = formatCitation(journal, "chicago");
  assert.equal(entry, 'Pearson, Jane. "Rising seas." Nature (2020). https://doi.org/10.1000/xyz.');
  assert.equal(inText, "(Pearson 2020)");
});

// ── author-list truncation per current style editions ──────────────────
// APA 7: all authors listed up to 20; 21+ → first 19, ellipsis, final author.
// MLA 9: two authors both named; three or more → first + et al.
// Chicago (CMOS 18 bibliography): all authors up to six; 7+ → first three + et al.

const fourAuthors = ["Pearson, Jane", "Smith, Adam", "Jones, Bo", "Lee, Cam"];
const threeAuthors = fourAuthors.slice(0, 3);

test("APA: three authors are all listed", () => {
  const { entry } = formatCitation({ ...journal, authors: threeAuthors }, "apa");
  assert.ok(entry.startsWith("Pearson, J., Smith, A., & Jones, B. (2020)."), entry);
});

test("APA: four authors are all listed — APA 7 never uses et al. in an entry", () => {
  const { entry, inText } = formatCitation({ ...journal, authors: fourAuthors }, "apa");
  assert.ok(entry.startsWith("Pearson, J., Smith, A., Jones, B., & Lee, C. (2020)."), entry);
  assert.equal(inText, "(Pearson et al., 2020)");
});

test("APA: 21+ authors truncate to first 19, ellipsis, final author — no ampersand", () => {
  const many = Array.from({ length: 21 }, (_, i) => `Family${String(i + 1).padStart(2, "0")}, Ann`);
  const { entry } = formatCitation({ ...journal, authors: many }, "apa");
  const expectedHead = many.slice(0, 19).map((a) => `${a.split(",")[0]}, A.`).join(", ");
  assert.ok(entry.startsWith(`${expectedHead}, . . . Family21, A. (2020).`), entry);
  assert.ok(!entry.includes("Family20"), entry); // the 20th is elided
  assert.ok(!entry.includes("&"), entry);
  assert.ok(!entry.includes("et al"), entry);
});

test("MLA: two authors are both listed", () => {
  const { entry } = formatCitation({ ...journal, authors: fourAuthors.slice(0, 2) }, "mla");
  assert.ok(entry.startsWith('Pearson, Jane, and Adam Smith. "Rising seas."'), entry);
});

test("MLA: three or more authors truncate to first + et al.", () => {
  for (const authors of [threeAuthors, fourAuthors]) {
    const { entry } = formatCitation({ ...journal, authors }, "mla");
    assert.ok(entry.startsWith('Pearson, Jane, et al. "Rising seas."'), entry);
  }
});

test("Chicago: four authors are all listed in the bibliography entry", () => {
  const { entry } = formatCitation({ ...journal, authors: fourAuthors }, "chicago");
  assert.ok(entry.startsWith('Pearson, Jane, Adam Smith, Bo Jones, and Cam Lee. "Rising seas."'), entry);
});

test("Chicago: seven or more authors truncate to first three + et al.", () => {
  const seven = [...fourAuthors, "Diaz, Eva", "Frost, Gil", "Hale, Ida"];
  const { entry } = formatCitation({ ...journal, authors: seven }, "chicago");
  assert.ok(entry.startsWith('Pearson, Jane, Adam Smith, Bo Jones, et al. "Rising seas."'), entry);
});

test("in-text pairs for two authors", () => {
  const two = { ...journal, authors: ["Pearson, Jane", "Smith, Adam"] };
  assert.equal(formatCitation(two, "apa").inText, "(Pearson & Smith, 2020)");
  assert.equal(formatCitation(two, "mla").inText, "(Pearson and Smith)");
  assert.equal(formatCitation(two, "chicago").inText, "(Pearson and Smith 2020)");
});

test("'Given Family' author strings parse too", () => {
  const { entry } = formatCitation({ ...journal, authors: ["Jane Pearson"] }, "apa");
  assert.ok(entry.startsWith("Pearson, J. (2020)."), entry);
});

// ── title-as-author: never a placeholder, in-text follows the lead ─────

test("APA with no authors leads with the title, in-text matches", () => {
  const src = { title: "Rising Seas", year: 2020, venue: "Nature", venueType: "journal" };
  const { entry, inText } = formatCitation(src, "apa");
  assert.equal(entry, "Rising Seas. (2020). Nature.");
  assert.equal(inText, '("Rising Seas", 2020)');
  assert.ok(!entry.includes("Unknown Author"));
});

test("MLA with no authors leads with the quoted title", () => {
  const src = { title: "Rising Seas", year: 2020, venue: "Nature", venueType: "journal" };
  const { entry, inText } = formatCitation(src, "mla");
  assert.equal(entry, '"Rising Seas." Nature, 2020.');
  assert.equal(inText, '("Rising Seas")');
});

test("Chicago with no authors leads with the quoted title", () => {
  const src = { title: "Rising Seas", year: 2020, venue: "Nature", venueType: "journal" };
  const { entry, inText } = formatCitation(src, "chicago");
  assert.equal(entry, '"Rising Seas." Nature (2020).');
  assert.equal(inText, '("Rising Seas" 2020)');
});

test("placeholder authors are filtered, not formatted — the title leads instead", () => {
  // Providers send placeholders AS DATA: ["Unknown Author"], ["Unknown"].
  for (const authors of [["Unknown Author"], ["Unknown"], ["N/A"], ["TBD"]]) {
    const src = { title: "Rising Seas", authors, year: 2020, venue: "Nature", venueType: "journal" };
    const { entry, inText } = formatCitation(src, "apa");
    assert.equal(entry, "Rising Seas. (2020). Nature.");
    assert.equal(inText, '("Rising Seas", 2020)');
  }
  // A real given name means something was actually parsed — kept.
  const kept = formatCitation(
    { title: "Rising Seas", authors: ["Griffiths, David"], year: 2020, venue: "Nature", venueType: "journal" },
    "apa"
  );
  assert.ok(kept.entry.startsWith("Griffiths, D. (2020)."), kept.entry);
});

test("Anonymous is formatted as a real author, never filtered", () => {
  const { entry } = formatCitation(
    { title: "The Pamphlet", authors: ["Anonymous"], year: 1789, venueType: "book", publisher: "Praxis" },
    "apa"
  );
  assert.ok(entry.startsWith("Anonymous. (1789)."), entry);
});

test("no authors and no title: the venue stands in for the in-text lead", () => {
  const src = { title: "", authors: [], year: 2021, venue: "World Health Organization", venueType: "report", url: "https://who.int/r" };
  assert.equal(formatCitation(src, "apa").inText, '("World Health Organization", 2021)');
  // Nothing identifies the work at all → the year alone, honest and poor.
  const bare = { title: "", authors: [], year: 2021, venueType: "web" };
  assert.equal(formatCitation(bare, "apa").inText, "(2021)");
  assert.equal(formatCitation(bare, "mla").inText, "(2021)");
});

test("long title shortens in the in-text marker", () => {
  const src = { title: "The Long Slow Rise of the World's Oceans", year: 2021, venueType: "web", url: "https://x.org/a" };
  const { inText } = formatCitation(src, "apa");
  assert.equal(inText, '("The Long Slow Rise", 2021)');
});

// ── locator by source type ─────────────────────────────────────────────

test("journal article takes its DOI as https://doi.org/…", () => {
  const { entry } = formatCitation(journal, "apa");
  assert.ok(entry.includes("https://doi.org/10.1000/xyz"));
});

test("a journal article WITHOUT a DOI falls back to its URL (ported rule)", () => {
  // An article Tracely could not get a DOI for is one a reader may well need a
  // link to — a missing locator means an unfamiliar title cannot be checked.
  const src = { ...journal, doi: undefined, url: "https://journal.example/rising-seas" };
  const { entry } = formatCitation(src, "apa");
  assert.ok(entry.includes("https://journal.example/rising-seas"), entry);
});

test("an unclassified source prefers its URL over its DOI (ported rule)", () => {
  const src = { ...journal, venueType: undefined, url: "https://pages.example/x" };
  const { entry } = formatCitation(src, "apa");
  assert.ok(entry.includes("https://pages.example/x"), entry);
  assert.ok(!entry.includes("doi.org"), entry);
});

test("book chapter takes the DOI", () => {
  const src = { ...journal, venueType: "chapter", venue: "Ocean Futures", pages: "45-67" };
  const { entry } = formatCitation(src, "apa");
  assert.ok(entry.includes("https://doi.org/10.1000/xyz"), entry);
});

test("whole book takes neither DOI nor URL", () => {
  const src = { ...journal, venueType: "book", url: "https://publisher.example/book", publisher: "Praxis" };
  for (const style of ["apa", "mla", "chicago"]) {
    const { entry } = formatCitation(src, style);
    assert.ok(!entry.includes("http"), `${style}: ${entry}`);
    assert.ok(!entry.includes("doi"), `${style}: ${entry}`);
  }
});

test("web and news take the URL, not the DOI", () => {
  for (const venueType of ["web", "news"]) {
    const src = { ...journal, venueType, url: "https://example.org/story" };
    const { entry } = formatCitation(src, "mla");
    assert.ok(entry.includes("https://example.org/story"), entry);
    assert.ok(!entry.includes("doi.org"), entry);
  }
});

test("report takes the URL", () => {
  const src = { title: "State of the Climate", authors: [], year: 2019, venue: "NOAA", venueType: "report", url: "https://noaa.gov/soc" };
  const { entry } = formatCitation(src, "chicago");
  assert.ok(entry.includes("https://noaa.gov/soc"), entry);
});

// ── terminal punctuation: ? and ! replace the period ───────────────────

test("a title's own ? replaces the period in all styles", () => {
  const src = { ...journal, title: "Are the Seas Rising?" };
  const apa = formatCitation(src, "apa").entry;
  assert.ok(apa.includes("Are the Seas Rising? Nature."), apa);
  assert.ok(!apa.includes("?."), apa);
  const mla = formatCitation({ ...src, venueType: "web", url: "https://x.org" }, "mla").entry;
  assert.ok(mla.includes('"Are the Seas Rising?"'), mla);
  assert.ok(!mla.includes('?."'), mla);
  const chi = formatCitation(src, "chicago").entry;
  assert.ok(chi.includes('"Are the Seas Rising?"'), chi);
  assert.ok(!chi.includes('?."'), chi);
});

test("a title's own ! replaces the period", () => {
  const src = { ...journal, title: "The Oceans Won!" };
  const apa = formatCitation(src, "apa").entry;
  assert.ok(apa.includes("The Oceans Won! Nature."), apa);
  assert.ok(!apa.includes("!."), apa);
});

// ── detectCitationDefects ──────────────────────────────────────────────

test("placeholder-author: Unknown Author and placeholder tokens in citation-shaped parens", () => {
  assert.ok(detectCitationDefects("Unknown Author. (2020). Rising seas. Nature.").includes("placeholder-author"));
  assert.ok(detectCitationDefects("Seas rose eight inches (unknown author, 2019).").includes("placeholder-author"));
  assert.ok(detectCitationDefects("Seas rose (TBD, 2020).").includes("placeholder-author"));
  assert.ok(detectCitationDefects("Seas rose (no author, n.d.).").includes("placeholder-author"));
});

test("Anonymous is NOT a placeholder — it is a real attribution (ported rule)", () => {
  // Eval-tuned in the production citationShape.ts: medieval texts, some
  // government documents and survey responses are correctly attributed to
  // Anonymous, and flagging it teaches writers to ignore the whole category.
  assert.ok(!detectCitationDefects("The pamphlet circulated widely (Anonymous, 1789).").includes("placeholder-author"));
  assert.ok(!detectCitationDefects("Anonymous. (2020). Rising seas. Nature.").includes("placeholder-author"));
});

test("placeholder-author does not fire on prose 'anonymous' or prose placeholder words", () => {
  assert.ok(!detectCitationDefects("The survey was anonymous by design.").includes("placeholder-author"));
  assert.ok(!detectCitationDefects("The placeholder text (see above) explains this.").includes("placeholder-author"));
});

test("citation-needed: literal [citation needed] and note-to-self parentheticals", () => {
  assert.ok(detectCitationDefects("Seas are rising fast [citation needed].").includes("citation-needed"));
  assert.ok(detectCitationDefects("Seas are rising fast (source).").includes("citation-needed"));
  assert.ok(detectCitationDefects("Seas are rising fast (add citation).").includes("citation-needed"));
  assert.ok(detectCitationDefects("Seas are rising fast [cite].").includes("citation-needed"));
  assert.ok(!detectCitationDefects("Seas are rising fast (Pearson, 2020).").includes("citation-needed"));
});

test("future-year: a cited year later than the current year", () => {
  const future = new Date().getFullYear() + 2;
  assert.ok(detectCitationDefects(`Seas rose (Smith, ${future}).`).includes("future-year"));
  assert.ok(!detectCitationDefects("Seas rose (Smith, 2020).").includes("future-year"));
});

test("future-year ignores plain prose years outside brackets", () => {
  const future = new Date().getFullYear() + 10;
  assert.ok(!detectCitationDefects(`Models project a rise by ${future}.`).includes("future-year"));
});

test("future-year fires on citation-shaped parentheticals only, not prose ones", () => {
  const future = new Date().getFullYear() + 10;
  assert.ok(!detectCitationDefects(`Sea levels could rise two feet (by ${future}).`).includes("future-year"));
  assert.ok(detectCitationDefects(`Seas will rise (Smith, ${future}).`).includes("future-year"));
  assert.ok(detectCitationDefects(`Pearson projects a rise (${future}).`).includes("future-year"));
});

test("bare-url: a naked URL doing citation duty", () => {
  assert.ok(detectCitationDefects("Seas are rising.\nhttps://example.com/report\n").includes("bare-url"));
  assert.ok(!detectCitationDefects("Pearson, J. (2020). Rising seas. Nature. https://example.com/report").includes("bare-url"));
});

test("bare-url: a URL alone inside parentheses is a defect too (ported rule)", () => {
  assert.ok(detectCitationDefects("Seas are rising (https://example.com/report).").includes("bare-url"));
  assert.ok(detectCitationDefects("Seas are rising (www.example.com/report).").includes("bare-url"));
});

test("duplicate-reference: the same reference pasted twice", () => {
  const ref = "Pearson, J. (2020). Rising seas. Nature.";
  assert.ok(detectCitationDefects(`${ref}\n${ref}`).includes("duplicate-reference"));
  assert.ok(!detectCitationDefects(`${ref}\nSmith, A. (2019). Falling coasts. Science.`).includes("duplicate-reference"));
});

test("clean text yields no defects", () => {
  assert.deepEqual(detectCitationDefects("Pearson, J. (2020). Rising seas. Nature."), []);
});

test("detectDefects is an alias of detectCitationDefects (stub compat)", () => {
  assert.equal(detectDefects, detectCitationDefects);
});

// ── detectProseAttribution ─────────────────────────────────────────────

test("According to X from Y", () => {
  assert.deepEqual(
    detectProseAttribution("According to Pearson from UNICEF, child mortality fell."),
    { speaker: "Pearson", org: "UNICEF" }
  );
});

test("As the Red Cross reported", () => {
  assert.deepEqual(
    detectProseAttribution("As the Red Cross reported, aid was delayed for weeks."),
    { speaker: "Red Cross", org: null }
  );
});

test("X argues that…", () => {
  assert.deepEqual(
    detectProseAttribution("Pearson argues that the data is incomplete."),
    { speaker: "Pearson", org: null }
  );
});

test("multi-word org as subject", () => {
  assert.deepEqual(
    detectProseAttribution("The World Health Organization found that cases doubled."),
    { speaker: "World Health Organization", org: null }
  );
});

test("per X", () => {
  assert.deepEqual(
    detectProseAttribution("Cases fell sharply, per the CDC."),
    { speaker: "CDC", org: null }
  );
});

test("speaker at org splits", () => {
  assert.deepEqual(
    detectProseAttribution("Dr. Chen at the WHO showed that masks help."),
    { speaker: "Dr. Chen", org: "WHO" }
  );
});

test("bare pronouns return null", () => {
  assert.equal(detectProseAttribution("According to him, the plan failed."), null);
  assert.equal(detectProseAttribution("She reported that the pipeline burst."), null);
});

test("generic subjects and plain prose return null", () => {
  assert.equal(detectProseAttribution("Studies show that sleep matters."), null);
  assert.equal(detectProseAttribution("According to a recent study, sleep matters."), null);
  assert.equal(detectProseAttribution("The seas are rising quickly."), null);
});

test("plural generic-person subjects are NOT attribution", () => {
  assert.equal(detectProseAttribution("Scientists claim that vaccines cause autism."), null);
  assert.equal(detectProseAttribution("Researchers found that coffee cures cancer."), null);
  assert.equal(detectProseAttribution("Experts say that the market will crash."), null);
  assert.equal(detectProseAttribution("Historians argue that the war was avoidable."), null);
});

test("a named proper-noun subject still IS attribution", () => {
  assert.deepEqual(
    detectProseAttribution("Dr. Pearson claims that vaccines are safe."),
    { speaker: "Dr. Pearson", org: null }
  );
});

// ── hasOwnCitation ─────────────────────────────────────────────────────

test("parenthetical citations count", () => {
  assert.ok(hasOwnCitation("Seas rose eight inches (Pearson, 2020)."));
  assert.ok(hasOwnCitation("Seas rose eight inches (Pearson 2020)."));
  assert.ok(hasOwnCitation("Seas rose eight inches (NOAA, n.d.)."));
});

test("[1]-style markers count", () => {
  assert.ok(hasOwnCitation("Seas rose eight inches [1]."));
  assert.ok(hasOwnCitation("Seas rose eight inches [2, 3]."));
});

test("DOIs and URLs count", () => {
  assert.ok(hasOwnCitation("Seas rose, see https://doi.org/10.1000/xyz for data."));
  assert.ok(hasOwnCitation("Seas rose (doi: 10.1000/xyz)."));
});

test("prose attribution counts — citations do not need parentheses", () => {
  assert.ok(hasOwnCitation("According to Pearson from UNICEF, child mortality fell."));
  assert.ok(hasOwnCitation("As the Red Cross reported, aid was delayed."));
});

test("an uncited sentence has no citation", () => {
  assert.ok(!hasOwnCitation("Sea levels rose eight inches since 1900."));
  assert.ok(!hasOwnCitation("The seas are rising quickly."));
});

test("prose parentheticals with a year are NOT citations", () => {
  assert.ok(!hasOwnCitation("Sea levels could rise two feet (by 2050)."));
  assert.ok(!hasOwnCitation("Global temperatures have risen 1.2 degrees (since 1880)."));
  assert.ok(!hasOwnCitation("Emissions peaked (in 2020) before falling."));
});

test("author-shaped and bare-year parentheticals ARE citations", () => {
  assert.ok(hasOwnCitation("Seas rose (see Smith, 2020)."));
  assert.ok(hasOwnCitation("Seas rose (e.g., Jones & Lee, 2019)."));
  assert.ok(hasOwnCitation("Seas rose (cf. Pearson 2020)."));
  assert.ok(hasOwnCitation("Pearson found seas rose eight inches (2020)."));
  assert.ok(hasOwnCitation("Seas rose eight inches (Pearson et al., 2020)."));
});

test("vague plural attribution does not count as a citation", () => {
  assert.ok(!hasOwnCitation("Scientists claim that vaccines cause autism."));
  assert.ok(!hasOwnCitation("Researchers found that coffee cures cancer."));
});

// ── shapes ported from the production inlineCitation.ts ────────────────

test("MLA author-page citations count: (Shoup 45), ranges, pairs", () => {
  assert.ok(hasOwnCitation("Parking minimums act as a hidden tax on housing (Shoup 45)."));
  assert.ok(hasOwnCitation("The argument runs across three chapters (Shoup 45-47)."));
  assert.ok(hasOwnCitation("The finding is robust (Mueller and Oppenheimer 1163)."));
  assert.ok(hasOwnCitation("The chapter opens with the same objection (Shoup p. 45)."));
});

test("structural pointers are NOT author-page citations", () => {
  assert.ok(!hasOwnCitation("The results are summarised (Table 3)."));
  assert.ok(!hasOwnCitation("The rule appears later (Chapter 11)."));
  assert.ok(!hasOwnCitation("Voters approved it (Proposition 13)."));
  assert.ok(!hasOwnCitation("The requirement is statutory (Title 42)."));
});

test("a quoted title in brackets counts — the MLA short form for undated sources", () => {
  assert.ok(hasOwnCitation('The convention predates the treaty ("Background to the Convention").'));
  assert.ok(!hasOwnCitation('He refused (he said "no").')); // quote must open the parenthetical
});

test("ibid/op. cit. shorthand counts", () => {
  assert.ok(hasOwnCitation("The same source makes the point again (ibid.)."));
  assert.ok(hasOwnCitation("The claim recurs (Ibid., 47)."));
  assert.ok(hasOwnCitation("The point is repeated (op. cit.)."));
});

test("superscript footnote marks count", () => {
  assert.ok(hasOwnCitation("The tour was exhausting but formative.¹"));
});

test("scheme-less www URLs count — rendered text loses the scheme", () => {
  assert.ok(hasOwnCitation("The full series is at www.oecd.org/education/report.pdf."));
});

test("attributing participle and possessive source nouns are prose attribution", () => {
  assert.deepEqual(
    detectProseAttribution("The figure was first published in the Lancet."),
    { speaker: "Lancet", org: null }
  );
  assert.deepEqual(
    detectProseAttribution("The delays were documented by Reuters."),
    { speaker: "Reuters", org: null }
  );
  assert.deepEqual(
    detectProseAttribution("UNICEF's own records put the number higher."),
    { speaker: "UNICEF", org: null }
  );
  assert.deepEqual(
    detectProseAttribution("Pearson's study found the opposite."),
    { speaker: "Pearson", org: null }
  );
  assert.ok(hasOwnCitation("The figure was first published in the Lancet."));
  assert.ok(hasOwnCitation("UNICEF's own records put the number higher."));
});

test("a bare possessive over a non-source noun is not attribution", () => {
  assert.equal(detectProseAttribution("Pearson's argument is persuasive."), null);
  assert.ok(!hasOwnCitation("Pearson's argument is persuasive."));
});
