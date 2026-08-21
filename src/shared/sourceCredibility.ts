/**
 * Would a marker accept this as a source?
 *
 * Retrieval answers "is this page about the claim". That is a different
 * question from "may a student cite it", and until now nothing asked the
 * second. Owner, 2026-08-21, looking at what a web search returned for one
 * sentence: TIME and British Heritage beside Historydraft, The Vintage News and
 * The Imaginative Conservative — a newspaper of record, a timeline site, an
 * enthusiast blog and an opinion journal, offered as five equal options.
 *
 * A student who hands that essay in loses marks for three of them, and nothing
 * on the card told them which three.
 *
 * ── Decided HERE, not by the model ─────────────────────────────────────────
 * The relay prompt already asks for good sources and already says to avoid
 * content farms. It returned those five anyway, labelling an enthusiast history
 * site as `news`. A model asked to grade its own output grades it generously,
 * and this answer has to be one Tracely can defend to a student who disagrees —
 * so it is a local, deterministic function of the publisher. Same stance
 * `search/scoring.ts` takes for evidence strength and `weaknessSeverity.ts`
 * takes for the Strong / Needs Work badge.
 *
 * ── Nothing is hidden ──────────────────────────────────────────────────────
 * Unvetted sources are RANKED LAST and LABELLED, never dropped. Filtering them
 * out silently would leave a writer unable to tell "Tracely found nothing" from
 * "Tracely found things and binned them" — and after a day of cards wrongly
 * reading "No sources found", making that state easier to reach is the last
 * thing this should do. The writer still decides; the card stops presenting the
 * five as equivalent.
 *
 * ── `unvetted` is not an accusation ────────────────────────────────────────
 * It means "Tracely does not recognise this publisher", which is a fact about
 * this list rather than about the site. The lists below are deliberately short:
 * a long allowlist is a long list of things to be wrong about, and every entry
 * here is one a marker accepts without argument.
 *
 * A leaf with no imports, so `npm test` can load it.
 */

export type CredibilityTier = 'scholarly' | 'official' | 'reference' | 'news-of-record' | 'unvetted'

export interface Credibility {
  tier: CredibilityTier
  /** The chip on the row. Short — it sits beside a match percentage. */
  label: string
  /** Can this be cited without the writer needing to think twice? */
  citable: boolean
  /** One line, for the writer who wants to know why. */
  why: string
}

/** Rank order for the picker. Lower sorts first. */
const ORDER: Record<CredibilityTier, number> = {
  scholarly: 0,
  official: 1,
  reference: 2,
  'news-of-record': 3,
  unvetted: 4
}

export function credibilityRank(tier: CredibilityTier): number {
  return ORDER[tier]
}

/**
 * Suffixes that are accountable by REGISTRATION rather than by reputation.
 *
 * `.gov`, `.mil`, `.int` and `.edu` are restricted registries — they cannot be
 * bought — so the domain itself is the credential. `gov.uk` and `ac.uk` are the
 * same idea in country-code form. This is why the official tier needs no
 * allowlist for the vast majority of what lands in it.
 */
const OFFICIAL_SUFFIX = /(^|\.)(gov|mil|int|edu)$|(^|\.)(gov|ac|edu)\.[a-z]{2}$/i

/** Intergovernmental and treaty bodies on ordinary TLDs. Short by design. */
const OFFICIAL_HOSTS = [
  'un.org',
  'unicef.org',
  'unesco.org',
  'unhcr.org',
  'who.int',
  'worldbank.org',
  'imf.org',
  'oecd.org',
  'wto.org',
  'icrc.org',
  'redcross.org',
  'europa.eu'
]

/** Works of record — what a marker treats as reference rather than as a website. */
const REFERENCE_HOSTS = [
  'britannica.com',
  'oxforddnb.com',
  'oed.com',
  'oxfordreference.com',
  'loc.gov',
  'bl.uk',
  'archives.gov',
  'nationalarchives.gov.uk',
  'jstor.org',
  'niod.nl',
  'iwm.org.uk',
  'si.edu',
  'ushmm.org',
  'yadvashem.org'
]

/** Journalism of record: a masthead with editors and a corrections policy. */
const NEWS_OF_RECORD = [
  'nytimes.com',
  'washingtonpost.com',
  'wsj.com',
  'ft.com',
  'economist.com',
  'theguardian.com',
  'bbc.co.uk',
  'bbc.com',
  'reuters.com',
  'apnews.com',
  'npr.org',
  'pbs.org',
  'time.com',
  'theatlantic.com',
  'newyorker.com',
  'nature.com',
  'science.org',
  'scientificamerican.com',
  'smithsonianmag.com',
  'nationalgeographic.com',
  'telegraph.co.uk',
  'thetimes.co.uk',
  'latimes.com',
  'cbc.ca',
  'abc.net.au'
]

/**
 * An encyclopedia anyone may edit is a finding aid, and every style guide says
 * so. It gets its own wording rather than the generic unvetted line, because
 * the advice is specific and actually useful: follow its references, cite those.
 */
const OPEN_ENCYCLOPEDIA = /(^|\.)(wikipedia|wikimedia|fandom|wikiwand)\./i

export interface CredibilityInput {
  url?: string | null
  venue?: string | null
  venueType?: string | null
  doi?: string | null
}

/** The host, lowercased and stripped of `www.`. Null when unparseable. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Suffix match on a DOT boundary.
 *
 * `news.bbc.co.uk` counts and `nottime.com` does not — a bare `includes` would
 * have accepted both, and the second is how an allowlist quietly starts
 * endorsing sites nobody put on it.
 */
function matches(host: string, list: readonly string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`))
}

export function credibilityOf(source: CredibilityInput): Credibility {
  const host = hostOf(source.url)
  const scholarlyVenue =
    source.venueType === 'journal' ||
    source.venueType === 'conference' ||
    source.venueType === 'preprint'

  // Peer review first, and independently of the host: a DOI on a journal
  // article is the credential, wherever it is served from.
  if (source.doi && scholarlyVenue) {
    return {
      tier: 'scholarly',
      label: 'Peer-reviewed',
      citable: true,
      why: 'A journal article with a DOI. The strongest thing you can cite.'
    }
  }

  if (host && (OFFICIAL_SUFFIX.test(host) || matches(host, OFFICIAL_HOSTS))) {
    return {
      tier: 'official',
      label: 'Official',
      citable: true,
      why: 'Published by the government, university or organisation it is about.'
    }
  }

  if (host && matches(host, REFERENCE_HOSTS)) {
    return {
      tier: 'reference',
      label: 'Reference work',
      citable: true,
      why: 'An established work of record — an encyclopedia, archive or museum.'
    }
  }

  if (host && matches(host, NEWS_OF_RECORD)) {
    return {
      tier: 'news-of-record',
      label: 'News of record',
      citable: true,
      why: 'A masthead with editors and a corrections policy.'
    }
  }

  if (host && OPEN_ENCYCLOPEDIA.test(host)) {
    return {
      tier: 'unvetted',
      label: 'Encyclopedia',
      citable: false,
      why: 'Anyone can edit it, so most teachers will not accept it. Follow its references and cite those instead.'
    }
  }

  // Academic-looking but unplaceable: a preprint with no DOI, a book, a journal
  // on a host nothing here recognises.
  if (source.doi || scholarlyVenue) {
    return {
      tier: 'unvetted',
      label: 'Check this one',
      citable: false,
      why: 'Looks academic, but Tracely could not confirm the publisher. Check who published it before citing.'
    }
  }

  return {
    tier: 'unvetted',
    label: 'Check this one',
    citable: false,
    why: 'Tracely does not recognise this publisher. It may still be fine — check who wrote it and whether they cite their own sources.'
  }
}

/**
 * The candidates, most citable first.
 *
 * A STABLE sort, and that matters: within a tier the order retrieval produced
 * is kept, because that order is how well each source matches the claim and
 * there is no reason to disturb it. `Array.prototype.sort` is specified stable,
 * so comparing on the tier alone is enough.
 */
export function byCredibility<T>(items: readonly T[], tierOf: (item: T) => CredibilityTier): T[] {
  return [...items].sort((a, b) => credibilityRank(tierOf(a)) - credibilityRank(tierOf(b)))
}
