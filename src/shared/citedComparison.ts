import type { ResolvedCitedWork } from './ipc-contract.ts'

/**
 * What the "you already cited this" half of a Compare Sources card says.
 *
 * "Compare sources" showed ONE list — what a topical search of four academic
 * indexes returned — under a heading promising two. Owner, 2026-08-19: *"I want
 * it to pull up the source before and the source it recommends now, because
 * that's what comparing sources means."*
 *
 * The lookup behind it (`search/referenceCheck.ts`) has existed since #155,
 * because the critique needs it. Nothing ever showed it to the writer.
 *
 * ── The one thing this must never say ──────────────────────────────────────
 * `found: false` is NOT "your source is fake". Crossref registers DOIs for the
 * scholarly record and Open Library holds books. A UNICEF page, a newspaper, a
 * government report, a museum catalogue and a national archive are in NEITHER,
 * and a student citing any of them is doing nothing wrong. Measured on
 * eval/fabrication's labelled set, the lookup separated 10 invented author
 * pairs from 16 real journal articles perfectly — and then missed 2 of 8 real
 * BOOKS.
 *
 * So `detail` reports what was searched and what came back, and `note` says why
 * an empty answer settles nothing. Neither draws the conclusion. That is the
 * same rule `describeReferenceChecks` writes under for the model, applied to
 * the one reader who cannot argue back.
 *
 * A leaf: one type-only import, so `npm test` can load it.
 */

export interface CitedComparison {
  /** The reference exactly as the writer typed it. Always shown. */
  reference: string
  /**
   * The work that was found, or the title the writer named when nothing was.
   *
   * Null when the reference names no title at all — "(Walker, 2010)" with no
   * matching record is a surname and a year and nothing else, and inventing a
   * line for it would be writing the writer's citation for them.
   */
  title: string | null
  /** One line under the title: which index answered, and with what year. */
  detail: string
  /** The caveat, when an empty answer needs one. Null when a work was found. */
  note: string | null
  /** Where the matched work can be opened, when it carries a locator. */
  url: string | null
  /** Drives the tick/query mark, so the two surfaces cannot disagree on it. */
  found: boolean
}

const INDEX_NAME: Record<'crossref' | 'openlibrary', string> = {
  crossref: 'Crossref',
  openlibrary: 'Open Library'
}

/**
 * Why "not found" is not a verdict, in the writer's words rather than ours.
 *
 * Deliberately names the categories rather than hedging generically: a writer
 * who cited a UNICEF page needs to know THAT is why the lookup came back empty,
 * or the card has told them something is wrong and left them to guess what.
 *
 * And deliberately SHORT. Measured in the harness, the first version made this
 * block 138px of a 306px overlay card — pushing "Insert citation" further below
 * a fold it was already under. A caveat nobody scrolls to is not a caveat.
 */
export const NOT_INDEXED_NOTE =
  'They hold journal articles and books — not web pages, news or official ' +
  'reports. This is not a judgement on your source.'

/**
 * The year the record holds, when it is not the year that was cited.
 *
 * Worth its own sentence. A one-year gap is routine and expected — a preprint
 * and its journal version, an edition reprinted — which is exactly why
 * `YEAR_TOLERANCE` allows it, and why a card that silently printed the record's
 * year over the writer's would look like it had found a different work.
 */
function yearNote(cited: number | null, matched: number | null): string | null {
  if (cited === null || matched === null || cited === matched) return null
  return `You cited ${cited}; the record is dated ${matched}. A year either way is normal.`
}

export function describeCitedWork(cited: ResolvedCitedWork | null): CitedComparison | null {
  if (!cited) return null

  if (cited.found && cited.title) {
    const index = cited.index ? INDEX_NAME[cited.index] : 'the index'
    const year = cited.matchedYear ?? cited.year
    return {
      reference: cited.raw,
      title: cited.title,
      detail: year ? `Found in ${index} · ${year}` : `Found in ${index}`,
      note: yearNote(cited.year, cited.matchedYear),
      url: cited.url,
      found: true
    }
  }

  return {
    reference: cited.raw,
    // What they said they were citing, when the reference or its list entry
    // carried a title. Never a placeholder — see the note on `title`.
    title: cited.citedTitle,
    detail: 'Not found in Crossref or Open Library',
    note: NOT_INDEXED_NOTE,
    url: null,
    found: false
  }
}

/**
 * The heading over the two halves.
 *
 * Says which is which, because the whole complaint was that a card headed
 * "Compare sources" showed one thing. `null` for the left half is a real state
 * — the sentence cites something in a shape the lookup cannot check — and it
 * gets its own line rather than an empty box.
 */
export const CITED_HEADING = 'THE SOURCE YOU CITED'

/**
 * Said when the sentence cites something, and the shape of it is one the lookup
 * cannot resolve — a quoted title, a bare URL, a footnote marker, an
 * institution with no year.
 *
 * A limit of ours, stated as one. `referenceCheck` searches for an author and a
 * year; every other shape is a correct citation in some style, and reporting
 * "not found" for one would be reporting our own gap as their problem.
 */
export const UNCHECKABLE_SHAPE_NOTE =
  'Tracely looks a citation up by author and year, so it cannot resolve this one. ' +
  'Open it yourself and check it says what you have attributed to it.'
