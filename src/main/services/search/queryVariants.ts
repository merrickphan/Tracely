// More than one way of asking, because one phrasing reaches one set of papers.
//
// The failure this exists for is in eval/baseline.md: the Bloom/Ctrip study is
// the single paper the remote-work claim is *about*, and no provider retrieved
// it. Reranking cannot fix that — a paper that never enters the candidate set
// cannot be promoted into it.
//
// Both variants are free and already in hand. Neither needs a model, a relay
// call, or an invented synonym, which matters: the whole point of this layer is
// that it costs nothing per use.

/** Crossref accepts long queries, but a whole paragraph is mostly stopwords by
 *  the end and the useful signal is at the front of a claim. */
const MAX_CLAIM_QUERY_CHARS = 300

/**
 * Ways to ask about one claim, most reliable first.
 *
 * 1. The detected keyword query — what detection produced, and measurably the
 *    stronger of the two on its own (20 hand-labelled relevant papers against
 *    the claim sentence's 12).
 * 2. The claim sentence verbatim — different phrasing, different results.
 *    Providers run their own relevance engines over natural language, and a
 *    sentence gives them word order and context that a keyword bag does not.
 *
 * Measured over the 13 labelled claims against Crossref: the union surfaces 68
 * papers the keyword query never saw, and after dense ranking cuts to eight it
 * takes relevant results from 20 to 21 with **no claim losing one**. Small, but
 * strictly non-negative, and the paper it gains is exactly the Bloom study that
 * motivated this.
 *
 * That figure is a floor. eval/baseline.md labelled the union of four
 * providers, so a paper these variants can now reach but nothing reached before
 * was never labelled and cannot be credited here.
 *
 * A third variant — synonym-expanded, per the plan — is deliberately absent. It
 * needs generation, which means a relay call per claim, and the two free ones
 * have not been shown to be insufficient. Rewriting the query as natural
 * phrasing did measurably better than either ("Reproduction of 'Does Working
 * from Home Work?'" at rank 1), so there is something there — but it is a paid
 * feature and should be justified against a measurement, not assumed.
 */
export function queryVariants(claimText: string, searchQuery: string): string[] {
  const variants: string[] = []
  const seen = new Set<string>()

  const add = (value: string): void => {
    const trimmed = value.trim()
    if (trimmed.length < 3) return
    // Case- and whitespace-insensitive, so a claim that happens to equal its own
    // detected query is not queried twice for nothing.
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) return
    seen.add(key)
    variants.push(trimmed)
  }

  add(searchQuery)
  add(claimText.slice(0, MAX_CLAIM_QUERY_CHARS))

  return variants
}
