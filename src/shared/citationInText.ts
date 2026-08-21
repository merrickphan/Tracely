import type { CitationStyle, Source } from './types.ts'
import { realAuthors } from './placeholderAuthor.ts'

/**
 * The short parenthetical marker that goes INTO the sentence — as opposed to
 * `formatCitation`'s full works-cited entry.
 *
 * ── The rule that matters here ─────────────────────────────────────────────
 * An in-text marker exists so a reader can find the entry in the reference
 * list. So it has to lead with whatever that entry leads with. When a work has
 * no named author every formatter in `citations/formatters/*` moves the TITLE
 * into the author slot — that is what APA, MLA and Chicago all prescribe — so
 * the marker must be a short form of the title, not a name.
 *
 * This file did not know that. `familyOf` read `authors[0].family` raw and fell
 * back to the literal string `'Unknown Author'`, so a source with no author
 * produced **"(Unknown Author, 2025)"** in the sentence above a reference entry
 * that correctly began with its title. The two halves of one citation named
 * different things, and the half the reader follows named something that
 * appears nowhere in the list.
 *
 * Owner, 2026-08-19: *"Please never cite 'unknown author' again."* #168 fixed
 * `authorUtils.ts` and every reference formatter and did not touch this file,
 * which is the one that writes into the document — so the string the owner
 * asked to never see again was still the first thing the card showed them.
 *
 * `realAuthors` is used rather than `authors[0]`, for the same reason
 * `authorUtils` uses it: providers send placeholders AS DATA —
 * `[{ family: 'Unknown' }]`, `[{ given: 'Unknown', family: 'Author' }]` — and
 * an empty list is only one of the shapes "no author" arrives in.
 *
 * Known MVP simplification, unchanged: a real MLA in-text citation is
 * "(Family page#)", and none of the connected providers expose a page locator
 * for where a claim sits inside a source, so every style here drops the page
 * number rather than fabricate one.
 */

/**
 * How much of a title stands in for an author.
 *
 * APA 7 says "the first few words of the title", and the point is that it be
 * long enough to identify one entry in a reference list and short enough to sit
 * inside a sentence. Four words does both for the titles retrieval actually
 * returns — the real one that prompted this runs to fourteen:
 * *"Robert Hepburn and Adam Smith to [unknown], Thursday, 6 August 1789…"*
 */
const SHORT_TITLE_WORDS = 4

export function shortTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '')
  if (!clean) return ''
  const words = clean.split(' ')
  if (words.length <= SHORT_TITLE_WORDS) return clean
  // Trailing punctuation again, because the cut can land on a comma — the
  // Hepburn title cuts to "Robert Hepburn and Adam", and one that cuts to
  // "…to [unknown]," would carry the comma into the quotes.
  return words.slice(0, SHORT_TITLE_WORDS).join(' ').replace(/[.,;:]+$/, '')
}

/**
 * What this citation is filed under: a surname, or the title standing in for
 * one. Null only when the source has neither, which is not a citable source.
 */
function leadFor(source: Source): { text: string; isTitle: boolean } | null {
  const family = realAuthors(source.authors)[0]?.family?.trim()
  if (family) return { text: family, isTitle: false }

  const title = shortTitle(source.title ?? '')
  if (title) return { text: title, isTitle: true }

  // A venue is the last thing that identifies the entry — an institutional page
  // with no title still files under its publisher. Below that there is nothing
  // to point a reader at, and inventing a word for it is exactly the failure
  // this file exists to remove.
  const venue = source.venue?.trim()
  return venue ? { text: shortTitle(venue), isTitle: true } : null
}

export function formatInTextCitation(source: Source, style: CitationStyle): string {
  const lead = leadFor(source)
  // Nothing identifies this work. The year alone is a poor marker and an
  // honest one; a placeholder name is neither.
  if (!lead) return source.year ? `(${source.year})` : ''

  // A title in the author slot is quoted, in all three styles. A surname is not.
  const text = lead.isTitle ? `“${lead.text}”` : lead.text
  if (style === 'MLA') return `(${text})`
  // APA and Chicago (author-date form) both read as "(Lead, Year)".
  return source.year ? `(${text}, ${source.year})` : `(${text})`
}
