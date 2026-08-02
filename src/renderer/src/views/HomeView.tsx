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
export default function HomeView({ onNavigate }: { onNavigate: (tab: Tab) => void }): JSX.Element {
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
      <span className="home-el home-greeting">Hey, Merrick!</span>

      <h2 className="home-el home-heading">
        {screenWatch?.enabled ? 'Tracely is running and ready.' : 'Tracely is off.'}
      </h2>
      <p className="home-el home-subtext">
        Start typing in an website or document, and Tracely will start analyzing the content.
      </p>

      <img src={homeCog} className="home-el home-cogicon" alt="" />
      <button className="home-el home-link home-link-settings" onClick={() => onNavigate('settings')}>
        Settings
      </button>

      <img src={homePlus} className="home-el home-plusicon" alt="" />
      <button className="home-el home-link home-link-newsession" onClick={() => onNavigate('analyze')}>
        New Session
      </button>

      {/* Static, non-functional — matches the Figma design exactly, both
          buttons are display-only. */}
      <div className="home-el home-flagcard">
        <div className="home-flagcard-checkbox-lid" />
        <div className="home-flagcard-checkbox" />
        <p className="home-flagcard-quote">
          &ldquo;Their quality of life has decreased as approximately 60% of jobs avoid
          traveling or applying to jobs, and one in ten are too afraid to even seek medical
          care.&rdquo;
        </p>
        <button className="home-flagcard-dismiss" type="button">
          Dismiss
        </button>
        <button className="home-flagcard-insights" type="button">
          See insights
        </button>
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
