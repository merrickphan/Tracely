import type { CitationStyle, Source } from '@shared/types'

// A short parenthetical in-text marker to insert directly into a claim's
// text, as opposed to formatCitation's full works-cited/reference-list
// entry. No formatter in citations/ produces one of these today.
//
// Known MVP simplification (same spirit as authorUtils' et-al-after-3
// rule): a real MLA in-text citation is "(Family page#)", but none of the
// connected search providers (OpenAlex/Crossref/Semantic Scholar/PubMed)
// expose a page-locator for where a specific claim sits within a source —
// only the source's own overall page range at best. So every style here
// drops the page number rather than fabricate one.
function familyOf(source: Source): string {
  const first = source.authors[0]
  return first?.family ?? 'Unknown Author'
}

export function formatInTextCitation(source: Source, style: CitationStyle): string {
  const family = familyOf(source)
  if (style === 'MLA') return `(${family})`
  // APA and Chicago (author-date form) both read as "(Family, Year)".
  return source.year ? `(${family}, ${source.year})` : `(${family})`
}
