// Where does the time go in one findEvidence call?
//
// "Analysis takes too long to load articles" is a real complaint and there are
// several plausible culprits, so this measures rather than guesses. Every
// provider call is timed by patching fetch, and the stages either side of them
// are timed directly.
//
// Free to run: Crossref, PubMed and Wikipedia cost nothing, and OpenAlex and
// Semantic Scholar are timed even when they answer 429 — which is itself part
// of what this is looking for.

import { mkdirSync } from 'fs'
import { join } from 'path'
import { warmUp } from '../services/ml'
import { findEvidence } from '../services/search/aggregator'
import { initDb } from '../services/storage/db'
import { setAppPaths } from '../services/storage/paths'

interface Call {
  host: string
  ms: number
  status: number
}

const calls: Call[] = []

// Parameters<typeof fetch> rather than RequestInfo/RequestInit: this file is
// compiled under tsconfig.node.json, which has no DOM lib, so those global
// names do not exist here.
type FetchArgs = Parameters<typeof fetch>

function instrumentFetch(): void {
  const real = globalThis.fetch
  globalThis.fetch = async (input: FetchArgs[0], init?: FetchArgs[1]) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
    let host = 'unknown'
    try {
      host = new URL(url).hostname.replace(/^(api|eutils|en)\./, '')
    } catch {
      /* leave as unknown */
    }
    const started = Date.now()
    try {
      const res = await real(input, init)
      calls.push({ host, ms: Date.now() - started, status: res.status })
      return res
    } catch (error) {
      calls.push({ host, ms: Date.now() - started, status: 0 })
      throw error
    }
  }
}

const CLAIMS: Array<{ text: string; query: string }> = [
  {
    text: 'Teenagers require between eight and ten hours of sleep per night, and roughly 70 percent get less.',
    query: 'teenagers sleep duration statistics'
  },
  {
    text: 'A randomized controlled trial at a Chinese travel agency found that employees working from home were 13% more productive.',
    query: 'randomized controlled trial remote work productivity China travel agency'
  },
  {
    text: 'Johannes Gutenberg introduced movable-type printing to Europe around 1450.',
    query: 'Johannes Gutenberg movable-type printing Europe 1450'
  }
]

export async function main(): Promise<void> {
  const dataDir = join(process.env.EVAL_REPO_ROOT ?? process.cwd(), 'out', 'eval', 'timing-data')
  mkdirSync(dataDir, { recursive: true })
  setAppPaths({ dataDir, appRoot: process.env.EVAL_REPO_ROOT ?? process.cwd(), resourcesDir: null })
  initDb()

  // Mirrors what the app does at boot (see main/index.ts). Without it the
  // first claim measured here absorbs the whole model cold start, which is a
  // cost no user pays any more — and reporting it would overstate what they
  // actually wait for.
  warmUp()
  await new Promise((r) => setTimeout(r, 6000))

  instrumentFetch()

  console.log(`timing ${CLAIMS.length} claims (ML pre-warmed, as the app does at boot)\n`)

  for (const [i, claim] of CLAIMS.entries()) {
    calls.length = 0
    const started = Date.now()
    const { evidence } = await findEvidence(claim.query, claim.text)
    const total = Date.now() - started

    const byHost = new Map<string, { n: number; ms: number; bad: number }>()
    for (const c of calls) {
      const e = byHost.get(c.host) ?? { n: 0, ms: 0, bad: 0 }
      e.n++
      e.ms += c.ms
      if (c.status >= 400 || c.status === 0) e.bad++
      byHost.set(c.host, e)
    }

    const network = calls.reduce((sum, c) => sum + c.ms, 0)
    console.log(`claim ${i + 1}: ${total}ms total, ${evidence.length} sources`)
    console.log(`  ${calls.length} requests, ${network}ms summed network (wall-clock differs: some overlap)`)
    for (const [host, e] of [...byHost].sort((a, b) => b[1].ms - a[1].ms)) {
      const failed = e.bad > 0 ? `  ${e.bad} failed/429` : ''
      console.log(`    ${host.padEnd(22)} ${String(e.n).padStart(3)} req  ${String(e.ms).padStart(6)}ms${failed}`)
    }
    // Everything not spent waiting on the network: embeddings, stance, scoring.
    console.log(`    ${'(local: embed/stance)'.padEnd(22)}      ${String(Math.max(0, total - network)).padStart(6)}ms\n`)
  }
}
