import { describe, it } from 'node:test'
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { byCredibility, credibilityOf, hostOf } from './sourceCredibility.ts'

const at = (url: string, over: Record<string, unknown> = {}) =>
  credibilityOf({ url, ...over })

describe('credibilityOf — the five the owner was shown as equals', () => {
  /**
   * The exact list from 2026-08-21, for one sentence. Two of these a marker
   * accepts without argument; three cost marks. The card ranked them equally.
   */
  it('separates the ones a marker accepts from the ones that cost marks', () => {
    strictEqual(at('https://time.com/5622911/audrey-hepburn-dutch-resistance/').tier, 'news-of-record')
    strictEqual(at('https://www.britishheritage.com/audrey-hepburn').citable, false)
    strictEqual(at('https://historydraft.com/story/audrey-hepburn/timeline/1').citable, false)
    strictEqual(at('https://www.thevintagenews.com/2021/05/12/audrey-hepburns/').citable, false)
    strictEqual(at('https://theimaginativeconservative.org/2019/06/dutch-girl.html').citable, false)
  })

  it('accepts a restricted registry on the domain alone', () => {
    // .gov, .mil, .int and .edu cannot be bought, so no allowlist is needed.
    for (const url of [
      'https://www.archives.gov/research/holocaust',
      'https://www.stanford.edu/dept/history/page',
      'https://www.gov.uk/government/publications/x',
      'https://www.ox.ac.uk/research/hepburn',
      'https://www.defense.mil/News/x'
    ]) {
      strictEqual(at(url).tier === 'official' || at(url).tier === 'reference', true, url)
    }
  })

  it('accepts an intergovernmental body on an ordinary TLD', () => {
    strictEqual(at('https://www.unicef.org/goodwill-ambassadors/audrey-hepburn').tier, 'official')
    strictEqual(at('https://www.who.int/news/item/x').tier, 'official')
  })

  it('puts peer review first, wherever it is served from', () => {
    const c = credibilityOf({
      url: 'https://some-journal-host.example.org/article',
      doi: '10.1111/x',
      venueType: 'journal'
    })
    strictEqual(c.tier, 'scholarly')
    strictEqual(c.citable, true)
  })

  /**
   * The advice here is specific and worth giving, so it does not share the
   * generic unvetted line.
   */
  it('treats an open encyclopedia as a finding aid, and says what to do instead', () => {
    const c = at('https://en.wikipedia.org/wiki/Audrey_Hepburn')
    strictEqual(c.citable, false)
    strictEqual(c.label, 'Encyclopedia')
    strictEqual(c.why.includes('Follow its references'), true)
  })

  /**
   * A bare `includes` would accept both of these. The second is how an
   * allowlist quietly starts endorsing sites nobody put on it.
   */
  it('matches on a dot boundary, not a substring', () => {
    strictEqual(at('https://news.bbc.co.uk/story').tier, 'news-of-record')
    strictEqual(at('https://nottime.com/article').citable, false)
    strictEqual(at('https://time.com.example.net/x').citable, false)
    strictEqual(at('https://faketheguardian.com/x').citable, false)
  })

  it('says it does not recognise a publisher, rather than condemning it', () => {
    const c = at('https://someblog.wordpress.com/post')
    strictEqual(c.tier, 'unvetted')
    strictEqual(c.why.includes('may still be fine'), true)
  })

  it('survives a missing or broken URL', () => {
    strictEqual(credibilityOf({ url: null }).tier, 'unvetted')
    strictEqual(credibilityOf({ url: 'not a url' }).tier, 'unvetted')
    strictEqual(credibilityOf({}).tier, 'unvetted')
  })

  // A DOI alone is not peer review — a dataset and a preprint both carry one.
  it('does not call something peer-reviewed on a DOI alone', () => {
    strictEqual(credibilityOf({ doi: '10.1111/x', venueType: 'dataset' }).tier !== 'scholarly', true)
    strictEqual(credibilityOf({ venueType: 'journal' }).tier !== 'scholarly', true)
  })
})

describe('hostOf', () => {
  it('lowercases and drops www', () => {
    strictEqual(hostOf('https://WWW.Time.com/x'), 'time.com')
  })

  it('returns null rather than throwing', () => {
    strictEqual(hostOf(''), null)
    strictEqual(hostOf('nonsense'), null)
    strictEqual(hostOf(null), null)
  })
})

describe('byCredibility', () => {
  it('puts the citable ones first', () => {
    const items = [
      { id: 'blog', tier: 'unvetted' as const },
      { id: 'time', tier: 'news-of-record' as const },
      { id: 'doi', tier: 'scholarly' as const },
      { id: 'gov', tier: 'official' as const }
    ]
    deepStrictEqual(
      byCredibility(items, (i) => i.tier).map((i) => i.id),
      ['doi', 'gov', 'time', 'blog']
    )
  })

  /**
   * Stable within a tier: that order is how well each source matches the claim,
   * and there is no reason for a credibility sort to disturb it.
   */
  it('keeps the retrieval order inside a tier', () => {
    const items = [
      { id: 'a', tier: 'unvetted' as const },
      { id: 'b', tier: 'unvetted' as const },
      { id: 'c', tier: 'unvetted' as const }
    ]
    deepStrictEqual(byCredibility(items, (i) => i.tier).map((i) => i.id), ['a', 'b', 'c'])
  })

  it('does not mutate its input', () => {
    const items = [{ id: 'x', tier: 'unvetted' as const }, { id: 'y', tier: 'scholarly' as const }]
    byCredibility(items, (i) => i.tier)
    deepStrictEqual(items.map((i) => i.id), ['x', 'y'])
  })
})
