import { useEffect, useMemo, useState } from 'react'
import type { ScreenWatchStatus } from '@shared/ipc-contract'
import type { DocumentListItem } from '@shared/types'
import { computeHomeStats } from '@shared/homeStats'
import { greetingFor } from '@shared/greeting'
import type { Tab } from '../App'
import figmaLogo from '../assets/figma-logo.png'
import tracerBadge from '../assets/tracer-badge.png'
import homeArrow from '../assets/home-arrow.svg'
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

/**
 * The four cards under "Resources". Content, not layout, so it sits up here.
 *
 * Each icon is drawn inline rather than imported, and that is a change: the
 * two that were exported assets (`resource-persuasive.svg`,
 * `resource-sources.svg`) carry a peach 32x32 rounded square baked into the
 * file, which is what the frame drew a revision ago. It now draws a 40px
 * circle in one of four tints, so the background belongs to CSS and the glyph
 * belongs here in `currentColor`. The pencil and magnifier geometry is lifted
 * verbatim from those exports; only the `<rect>` behind them is gone.
 */
const RESOURCES: Array<{
  id: string
  title: string
  blurb: string
  tone: 'peach' | 'rose' | 'mint' | 'violet'
  icon: JSX.Element
}> = [
  {
    id: 'persuasive',
    title: 'Persuasive Writing 101',
    blurb: 'Build arguments that hold up.',
    tone: 'peach',
    icon: (
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect
          x="9"
          y="13.5"
          width="14"
          height="4.5"
          rx="1"
          transform="rotate(45 9 13.5)"
          fill="currentColor"
        />
        <path
          d="M8.47668 13.4148L5.41481 16.4767L4.2941 12.2941L8.47668 13.4148Z"
          fill="currentColor"
        />
      </svg>
    )
  },
  {
    id: 'rubric',
    title: 'Standard Grading Rubric',
    blurb: 'See how Tracely scores essays.',
    tone: 'rose',
    icon: (
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect x="8" y="10" width="16" height="3" rx="1.5" fill="currentColor" />
        <rect x="8" y="16" width="10" height="3" rx="1.5" fill="currentColor" />
        <rect x="8" y="22" width="13" height="3" rx="1.5" fill="currentColor" />
      </svg>
    )
  },
  {
    id: 'research',
    title: 'Research Paper Tips',
    blurb: 'Structure, sourcing, citations.',
    tone: 'mint',
    icon: (
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect
          x="9"
          y="7"
          width="14"
          height="18"
          rx="2"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M13 13h6M13 16.5h6M13 20h4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  },
  {
    id: 'sources',
    title: 'Finding Credible Sources',
    blurb: 'Spot reliable evidence fast.',
    tone: 'violet',
    icon: (
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <circle cx="14" cy="13" r="6" stroke="currentColor" strokeWidth="2" />
        <path
          d="M19.8485 18.1515C20.3171 17.6828 21.0769 17.6828 21.5456 18.1515L25.5054 22.1113C25.974 22.5799 25.974 23.3397 25.5054 23.8083C25.0367 24.277 24.2769 24.277 23.8083 23.8083L19.8485 19.8485C19.3799 19.3799 19.3799 18.6201 19.8485 18.1515Z"
          fill="currentColor"
        />
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
  onOpenDocument,
  firstName
}: {
  onNavigate: (tab: Tab) => void
  onNewDocument: () => void
  /**
   * Open one draft in the editor. The same callback the Documents list uses, so
   * a card here and a row there land in exactly the same place.
   *
   * These cards used to call `onNavigate('documents')` — clicking your own
   * essay dropped you on a list you then had to find it in again, one click
   * from where you already were. "View all documents", directly above them, is
   * the control that means "show me the list".
   */
  onOpenDocument: (id: string) => void
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
        {/*
          The white card across the top, on the page's grey.

          The frame builds Home as cards floating on #e5e7eb, and this row —
          brand, greeting, status, Settings — is one of them. It was a flat
          white page here, which is why every border and tint below was being
          drawn against the wrong ground.
        */}
        <section className="home-card">
        <header className="home-top">
          <div className="home-brand">
            <img src={figmaLogo} alt="" />
            <span>Tracely</span>
          </div>
          {/*
            No close button here.

            The design has one and this had one, hiding to the tray. The window
            now draws the real Windows close in the same corner (the title BAR
            is hidden, its buttons are not — see mainWindow.ts), and it does
            exactly the same thing: `close` is intercepted and hides to the
            tray, because window-all-closed keeps the app alive for the global
            hotkey. Two X's a few pixels apart, doing one thing, is the reason
            the app's own window controls were deleted in the first place.
          */}
          <h1 className="home-greeting">
            {greetingFor(now.getHours())}
            {/* The FIRST word only. `firstName` holds whatever was typed at
                sign-up, which is routinely a full name — the greeting rendered
                "Good afternoon, Merrick Han!" where the design greets you by
                first name alone. */}
            {firstName ? `, ${firstName.trim().split(/\s+/)[0]}` : ''}!
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
        </section>

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
                <button key={doc.id} className="home-doc" onClick={() => onOpenDocument(doc.id)}>
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

        <section className="home-section home-section--resources">
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
                <span className={`home-resource-icon tone-${item.tone}`} aria-hidden="true">
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
            <img src={homeArrow} alt="" width={17} height={22} />
          </button>
        </footer>
      </div>
    </div>
  )
}
