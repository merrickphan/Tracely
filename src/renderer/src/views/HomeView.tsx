import { useEffect, useState } from 'react'
import type { ScreenWatchStatus } from '@shared/ipc-contract'
import type { Tab } from '../App'
import figmaLogo from '../assets/figma-logo.png'
import homeCog from '../assets/home-cog.png'
import homePlus from '../assets/home-plus.png'
import homeClose from '../assets/home-close.png'
import { tracelyApi } from '../lib/api'

// Pixel-exact recreation of Figma's "Frame Main Page" (870x597) — every
// element below is positioned with the design's literal coordinates,
// converted to CSS container-query units (cqw = %/870 of width, cqh =
// %/597 of height) so the whole canvas scales as one fixed-aspect-ratio
// unit and nothing drifts out of proportion. See styles/index.css
// `.home-canvas` and `.home-*` rules for the actual values.
export default function HomeView({
  onNavigate,
  firstName
}: {
  onNavigate: (tab: Tab) => void
  firstName: string | null
}): JSX.Element {
  const [screenWatch, setScreenWatch] = useState<ScreenWatchStatus | null>(null)

  useEffect(() => {
    tracelyApi.getScreenWatchStatus().then(setScreenWatch)
    return tracelyApi.onScreenWatchStatus(setScreenWatch)
  }, [])

  return (
    <div className="home-canvas">
      <img
        src={homeClose}
        className="home-el home-closeicon"
        alt=""
        role="button"
        aria-label="Close"
        onClick={() => tracelyApi.hideWindow('main')}
      />

      <img src={figmaLogo} className="home-el home-logo" alt="" />
      <span className="home-el home-title">Tracely</span>
      {firstName ? <span className="home-el home-greeting">Hey, {firstName}!</span> : null}

      {/*
        Signed-out takes over the heading rather than sitting somewhere quieter.
        Every AI call needs an account now, so this state means nothing works —
        and it used to present as claims simply never appearing, which reads as
        the app being slow rather than as something the user can fix. The whole
        status object was already arriving here; nothing rendered any of it.
      */}
      <h2 className="home-el home-heading">
        {screenWatch?.authRequired
          ? 'Sign in to continue.'
          : screenWatch?.enabled
            ? 'Tracely is running and ready.'
            : 'Tracely is off.'}
      </h2>
      <p className="home-el home-subtext">
        {screenWatch?.authRequired
          ? 'Your session has expired, so Tracely cannot check anything right now. Sign in again and it will pick up where it left off.'
          : 'Start typing in an website or document, and Tracely will start analyzing the content.'}
      </p>

      <img src={homeCog} className="home-el home-cogicon" alt="" />
      <button className="home-el home-link home-link-settings" onClick={() => onNavigate('settings')}>
        Settings
      </button>

      <img src={homePlus} className="home-el home-plusicon" alt="" />
      <button className="home-el home-link home-link-newsession" onClick={() => onNavigate('analyze')}>
        New Session
      </button>

      {/* The way into the saved sources. Until now nothing in the app could
          reach them — "Save to Library" wrote rows no screen displayed. */}
      <svg className="home-el home-libraryicon" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 4h12a1 1 0 011 1v15l-7-3.5L5 20V5a1 1 0 011-1z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      <button className="home-el home-link home-link-library" onClick={() => onNavigate('library')}>
        Library
      </button>

      {/*
        The sample Hover Popover from the frame — 361:329, at 43,380, 372x174.
        It shows a new user what Tracely does before they have anything to look
        at, which is why the design puts it on an otherwise empty home screen.

        NOT a reinstatement of what used to be here. That was a "flagged claim"
        card quoting an invented statistic about 60% of jobs, presented as a
        real finding, above a decorative checkbox and two buttons with no
        onClick. This card is the product's own popover with the design's own
        generic copy — it asserts nothing about any document and invents no
        figure, which is the whole difference.

        The buttons are part of the picture, not controls: this card is an
        illustration of the popover, and clicking its Dismiss made the one
        thing explaining the empty home screen disappear for good, while Find
        a source jumped to a tab the reader had not asked for. They are inert
        by design — `pointer-events: none` plus `aria-hidden` on the row, so
        neither the mouse nor a screen reader offers them as actions.
      */}
      <div className="home-el home-popover">
        <div className="home-popover-head">
          <span className="home-popover-dot" />
          <span className="home-popover-title">Unverified statistic</span>
        </div>
        <p className="home-popover-body">
          This figure doesn&rsquo;t appear in any of your uploaded sources yet. Add a citation or
          double-check the number.
        </p>
        <div className="home-popover-actions" aria-hidden="true">
          <span className="home-popover-btn primary">Find a source</span>
          <span className="home-popover-btn">Dismiss</span>
        </div>
      </div>

      <span className="home-el home-worktext">You choose where Tracely works</span>
      <svg className="home-el home-worktext-arrow" viewBox="0 0 18.3007 23.2268" fill="none">
        <path
          d="M0.820127 22.6547L15.8201 1.15466M17.3201 8.65466L15.8201 1.15466L7.32013 2.65466"
          stroke="#F28D00"
          strokeWidth="2"
        />
      </svg>

      <svg className="home-el home-trail" viewBox="0 0 701.596 92" fill="none" preserveAspectRatio="none">
        <path
          d="M0.339381 4.79838C96.7642 -8.41382 272.572 40.8305 407.781 14.0261C600.31 -24.1416 647.786 94.8362 701.339 89.313"
          stroke="#FF9D00"
          strokeWidth="5"
          strokeDasharray="33 20"
        />
      </svg>

      <div className="home-el home-flyinglogo">
        <img src={figmaLogo} alt="" />
      </div>
    </div>
  )
}
