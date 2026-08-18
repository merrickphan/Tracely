import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hostnameOf, iconUrlFor, isResolverHost } from './sourceIcon.ts'

describe('isResolverHost', () => {
  it('knows the persistent-identifier resolvers', () => {
    strictEqual(isResolverHost('doi.org'), true)
    strictEqual(isResolverHost('dx.doi.org'), true)
    strictEqual(isResolverHost('www.doi.org'), true)
    strictEqual(isResolverHost('hdl.handle.net'), true)
  })

  it('leaves real publishers alone', () => {
    for (const host of ['journals.sagepub.com', 'linkinghub.elsevier.com', 'pnas.org', 'en.wikipedia.org']) {
      strictEqual(isResolverHost(host), false, host)
    }
  })

  it('is false for nothing', () => {
    strictEqual(isResolverHost(null), false)
  })
})

describe('iconUrlFor', () => {
  /**
   * The bug: Crossref returns a doi.org URL for essentially every record, so
   * every row in a results list asked about the same host and got the DOI
   * Foundation's mark. Nine identical icons is a column that identifies nothing.
   */
  it('prefers a publisher link over a DOI', () => {
    strictEqual(
      iconUrlFor({ url: 'https://doi.org/10.1234/x', pdfUrl: 'https://link.springer.com/a.pdf' }),
      'https://link.springer.com/a.pdf'
    )
  })

  it('keeps the url when it is already a publisher', () => {
    strictEqual(
      iconUrlFor({ url: 'https://journals.sagepub.com/doi/10.1177/x', pdfUrl: 'https://doi.org/10.1177/x' }),
      'https://journals.sagepub.com/doi/10.1177/x'
    )
  })

  it('falls back to the DOI when that is all there is — main resolves it', () => {
    strictEqual(iconUrlFor({ url: 'https://doi.org/10.1234/x', pdfUrl: null }), 'https://doi.org/10.1234/x')
  })

  it('returns null for a source with no links at all', () => {
    strictEqual(iconUrlFor({ url: null, pdfUrl: null }), null)
    strictEqual(iconUrlFor({}), null)
  })

  it('is not confused by an unparseable url', () => {
    strictEqual(hostnameOf('not a url'), null)
    strictEqual(iconUrlFor({ url: 'not a url', pdfUrl: 'https://nature.com/x' }), 'https://nature.com/x')
  })
})
