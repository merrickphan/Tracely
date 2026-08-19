import { describe, it } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import { isPlausibleSourceUrl, livenessFromStatus, shouldOffer } from './urlLiveness.ts'

describe('livenessFromStatus', () => {
  it('treats only a positive absence as gone', () => {
    strictEqual(livenessFromStatus(404), 'gone')
    strictEqual(livenessFromStatus(410), 'gone')
  })

  // The measured case. unicef.org answered 200, then 403 to the next three
  // requests, then 200 again after a pause. Treating 403 as dead would have
  // discarded three real sources from the organisation the essay is about.
  it('keeps a page that exists but will not serve US', () => {
    for (const status of [401, 403, 429]) {
      strictEqual(livenessFromStatus(status), 'live', String(status))
    }
  })

  it('keeps a page whose server is having a bad minute', () => {
    strictEqual(livenessFromStatus(500), 'live')
    strictEqual(livenessFromStatus(503), 'live')
  })

  it('keeps the ordinary answers', () => {
    strictEqual(livenessFromStatus(200), 'live')
    strictEqual(livenessFromStatus(301), 'live')
  })
})

describe('shouldOffer', () => {
  it('offers a live page and nothing else', () => {
    strictEqual(shouldOffer('live'), true)
    strictEqual(shouldOffer('gone'), false)
    // No evidence the host exists at all — the other shape an invented URL takes.
    strictEqual(shouldOffer('unreachable'), false)
  })
})

describe('isPlausibleSourceUrl', () => {
  it('accepts a real page', () => {
    strictEqual(isPlausibleSourceUrl('https://www.unicef.org/goodwill-ambassadors/audrey-hepburn'), true)
    strictEqual(isPlausibleSourceUrl('http://www.history.com/this-day-in-history/x'), true)
  })

  it('rejects what is not a URL at all', () => {
    strictEqual(isPlausibleSourceUrl('audrey hepburn unicef'), false)
    strictEqual(isPlausibleSourceUrl(''), false)
    strictEqual(isPlausibleSourceUrl('unicef.org'), false)
  })

  it('rejects placeholders and non-web schemes', () => {
    strictEqual(isPlausibleSourceUrl('https://example.com/page'), false)
    strictEqual(isPlausibleSourceUrl('ftp://files.org/x.pdf'), false)
    strictEqual(isPlausibleSourceUrl('file:///C:/x.html'), false)
  })

  // A results page is not a source. This is what comes back when a model hands
  // over the search it ran rather than what it found.
  it('rejects a search engine', () => {
    strictEqual(isPlausibleSourceUrl('https://www.google.com/search?q=audrey+hepburn'), false)
    strictEqual(isPlausibleSourceUrl('https://duckduckgo.com/?q=x'), false)
  })

  // The rejects are anchored, so a real host is not caught by merely containing
  // one of their words. Both of these are the kind of site a student legitimately
  // cites, and an over-eager pattern would silently drop them.
  it('does not reject a real host merely for containing a rejected word', () => {
    strictEqual(isPlausibleSourceUrl('https://www.testvalley.co.uk/archive'), true)
    strictEqual(isPlausibleSourceUrl('https://www.bingley-archives.org/collections'), true)
    strictEqual(isPlausibleSourceUrl('https://www.exampleshire-museum.org/hepburn'), true)
  })
})
