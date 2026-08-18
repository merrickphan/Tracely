import { useEffect, useMemo, useState } from 'react'
import type { ScreenWatchStatus } from '@shared/ipc-contract'
import type { DocumentListItem } from '@shared/types'
import { computeHomeStats } from '@shared/homeStats'
import { greetingFor } from '@shared/greeting'
import type { Tab } from '../App'
import figmaLogo from '../assets/figma-logo.png'
import tracerBadge from '../assets/tracer-badge.png'
import { gradeFor } from '../components/essayGrade'
import { tracelyApi } from '../lib/api'

/**
 * Home — rebuilt from the owner's mockup, 2026-08-18.
 *
 * What it replaces: a pixel-exact transcription of Figma's "Frame Main Page",
 * whose sixteen elements sat at literal design coordinates inside a fixed
 * 870x606 canvas. That is why Home was the one view in the app that could not
 * reflow, and why it had to keep its size and centre when the window became
 * freely resizable. This layout is ordinary flow and grid, so that exception is
 * gone with it — Home fills the window like everything else now.
 *
 * The old screen was also mostly illustration: a decorative popover, a dotted
 * flight path, a flying logo. This one is almost entirely real state — three
 * computed statistics, the actual recent documents, and the live Screen Watch
 * status — which is the substance of the change rather than the arrangement.
 */

/** The four cards under "Resources". Content, not layout, so it sits up here. */
const RESOURCES: Array<{ id: string; title: string; blurb: string; icon: JSX.Element }> = [
  {
    id: 'persuasive',
    title: 'Persuasive Writing 101',
    blurb: 'Build arguments that hold up.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 20l3-1 11-11a2 2 0 00-3-3L4 16l-1 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    id: 'rubric',
    title: 'Standard Grading Rubric',
    blurb: 'See how Tracely scores essays.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 7h14M5 12h14M5 17h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  },
  {
    id: 'research',
    title: 'Research Paper Tips',
    blurb: 'Structure, sourcing, citations.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 3h9l4 4v14H6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    id: 'sources',
    title: 'Finding Credible Sources',
    blurb: 'Spot reliable evidence fast.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7" />
        <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  }
]

/**
 * "Opened today" / "Opened yesterday" / "Opened May 12".
 *
 * Relative for the two days anyone can hold in their head and absolute after
 * that — "Opened 47 days ago" is arithmetic the reader has to undo, and a bare
 * date for something touched an hour ago reads as stale.
 */
function openedLabel(iso: string, now: Date): string {
  const at = new Date(iso)
  if (!Number.isFinite(at.getTime())) return 'Opened recently'
  const day = (d: Date): number =>
    Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000)
  const delta = day(now) - day(at)
  if (delta <= 0) return 'Opened today'
  if (delta === 1) return 'Opened yesterday'
  return `Opened ${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

export default function HomeView({
  onNavigate,
  onNewDocument,
  firstName
}: {
  onNavigate: (tab: Tab) => void
  onNewDocument: () => void
  firstName: string | null
}): JSX.Element {
  const [screenWatch, setScreenWatch] = useState<ScreenWatchStatus | null>(null)
  const [documents, setDocuments] = useState<DocumentListItem[]>([])

  useEffect(() => {
    tracelyApi.getScreenWatchStatus().then(setScreenWatch)
    return tracelyApi.onScreenWatchStatus(setScreenWatch)
  }, [])

  useEffect(() => {
    tracelyApi
      .listDocuments()
      .then((res) => setDocuments(res.documents))
      .catch(() => setDocuments([]))
  }, [])

  // One instant for the whole render, so the greeting, the streak and every
  // "Opened today" agree with each other. Reading the clock separately in each
  // place is how a card says "yesterday" next to a streak that counted it.
  const now = useMemo(() => new Date(), [])
  const stats = useMemo(() => computeHomeStats(documents, now), [documents, now])
  const recent = documents.slice(0, 3)

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-top">
          <div className="home-brand">
            <img src={figmaLogo} alt="" />
            <span>Tracely</span>
          </div>
          {/* The design's close X is gone: the window has a real title bar with
              its own close now, and two of them on one screen is what the
              window-controls work removed in the first place. */}
          <h1 className="home-greeting">
            {greetingFor(now.getHours())}
            {firstName ? `, ${firstName}` : ''}!
          </h1>
        </header>

        <div className="home-statusrow">
          <p className={`home-status${screenWatch?.enabled ? ' on' : ''}`}>
            <span className="home-status-dot" aria-hidden="true" />
            {screenWatch?.authRequired
              ? 'Sign in to continue.'
              : screenWatch?.enabled
                ? 'Tracely is running and ready.'
                : 'Tracely is off.'}
          </p>
          <button className="home-settings" onClick={() => onNavigate('settings')}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M12 4v2M12 18v2M4 12h2M18 12h2M6.5 6.5l1.4 1.4M16.1 16.1l1.4 1.4M17.5 6.5l-1.4 1.4M7.9 16.1l-1.4 1.4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Settings
          </button>
        </div>

        {/*
          Three real numbers, computed from the document list this page already
          loads — see shared/homeStats.ts. An em dash rather than a 0 when there
          is nothing to average: 0 renders as "F", which is a grade nobody
          earned, and a brand-new account should not open on one.
        */}
        <section className="home-stats" aria-label="Your writing at a glance">
          <div className="home-stat">
            <b>{stats.gradedThisMonth}</b>
            <span>Documents graded this month</span>
          </div>
          <div className="home-stat">
            <b>{stats.averageScore === null ? '—' : gradeFor(stats.averageScore).letter}</b>
            <span>Average grade</span>
          </div>
          <div className="home-stat">
            <b>
              {stats.streakDays} {stats.streakDays === 1 ? 'day' : 'days'}
            </b>
            <span>Current grading streak</span>
          </div>
        </section>

        <section className="home-actions">
          <button className="home-action primary" onClick={onNewDocument}>
            <span className="home-action-icon" aria-hidden="true">
              +
            </span>
            <span className="home-action-text">
              <b>New document</b>
              <span>Paste or upload writing for Tracely to grade.</span>
            </span>
          </button>
          {/*
            Disabled, not omitted, and not wired to something else.

            The design has this card and there is no paste-a-link path in the
            app: nothing fetches a URL, and the four search providers index
            papers rather than arbitrary pages. A button that silently did
            something adjacent — opened a new document, say — would be worse
            than one that says it is not ready, which is the same rule the
            citation flow follows when it will not offer "Find a source" over a
            claim it cannot search for.
          */}
          <button className="home-action" disabled title="Not available yet">
            <span className="home-action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M10 14a4 4 0 005.7 0l3-3a4 4 0 10-5.7-5.7L11.5 7M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 105.7 5.7L12.5 17"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="home-action-text">
              <b>Paste a link</b>
              <span>Point Tracely at a page and it will analyze the content.</span>
            </span>
          </button>
        </section>

        <section className="home-section">
          <div className="home-section-head">
            <h2>Recent documents</h2>
            <button className="home-link" onClick={() => onNavigate('documents')}>
              View all documents →
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="home-empty">
              Nothing here yet. Start a document and Tracely will grade it as you write.
            </p>
          ) : (
            <div className="home-docs">
              {recent.map((doc) => (
                <button key={doc.id} className="home-doc" onClick={() => onNavigate('documents')}>
                  <span className="home-doc-thumb" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    {doc.score !== null ? (
                      <span className={`home-doc-grade tone-${doc.score >= 80 ? 'good' : doc.score >= 65 ? 'mid' : 'low'}`}>
                        {gradeFor(doc.score).letter}
                      </span>
                    ) : null}
                  </span>
                  <span className="home-doc-title">{doc.title}</span>
                  <span className="home-doc-meta">{openedLabel(doc.updatedAt, now)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="home-section">
          <div className="home-section-head">
            <h2>Resources</h2>
          </div>
          <p className="home-section-sub">Guides to help you write and grade with confidence.</p>
          <div className="home-resources">
            {RESOURCES.map((item) => (
              // Same call as "Paste a link": the four guides are named in the
              // design and none of them is written. A "Read →" that goes
              // nowhere is a worse first impression than one that is plainly
              // not ready yet.
              <div key={item.id} className="home-resource">
                <span className="home-resource-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <b>{item.title}</b>
                <span className="home-resource-blurb">{item.blurb}</span>
                <span className="home-resource-read" aria-hidden="true">
                  Read →
                </span>
              </div>
            ))}
          </div>
        </section>

        <footer className="home-foot">
          {/*
            Tracer was REMOVED from this app — window, relay client, IPC
            handlers, repo and every entry point (see CLAUDE.md). What survives
            is the two SQLite tables, the `Tracer*` types and the `TRACER_*`
            channel constants, kept because `src/shared/*` is additive, plus a
            relay endpoint that is still deployed.

            So this is the mascot and the affordance from the design, with
            nothing behind it yet, and it says so rather than pretending. The
            alternative was to leave it off the page entirely, which would have
            silently dropped something the design asks for.
          */}
          <div className="home-tracer">
            {/*
              The owner's own artwork, used as supplied rather than redrawn.
              A hand-authored SVG approximation shipped here for one build and
              was rejected on sight — "use this exact image" — which is the
              right call: the character is brand art, and an approximation of
              brand art is just a worse version of it.

              The orange disc is part of the image, so the container adds no
              halo of its own; doing that gave it two rings.
            */}
            <img className="home-tracer-badge" src={tracerBadge} alt="" />
            <button className="home-tracer-btn" disabled title="Tracer is not available in this build">
              Chat with Tracer
            </button>
          </div>
          <button className="home-worklink" onClick={() => onNavigate('settings')}>
            You choose where Tracely works
            <svg viewBox="0 0 18 23" fill="none" aria-hidden="true">
              <path d="M0.82 22.65L15.82 1.15M17.32 8.65L15.82 1.15L7.32 2.65" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </footer>
      </div>
    </div>
  )
}
