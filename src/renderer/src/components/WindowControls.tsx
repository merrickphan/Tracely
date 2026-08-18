import { useEffect, useState } from 'react'
import { tracelyApi } from '../lib/api'

/**
 * Minimize and maximize, top-right — the window chrome this app never had.
 *
 * It had none because the design has none: the frames draw their own close X
 * and nothing else, and for a fixed-size window that was complete. It stopped
 * being complete when the window became resizable — a window you can drag to
 * any size wants a way back to a sensible one, and one with no taskbar
 * minimize (`minimizable` was false) could only be put away by closing it.
 *
 * Placed LEFT of the card's own close button rather than replacing it. The X
 * belongs to the view — Home's sits at 833px in design coordinates and does
 * what the design says it does — and these two are the window's. Sharing the
 * corner keeps them where a hand reaches for them without touching a frame.
 *
 * Drawn as SVG at the same weight as the design's thin-line icons rather than
 * pulled from a set: two 10px glyphs, and importing an icon library for them
 * would be more code than the paths are.
 */

/**
 * Maximize does not fill the screen — see `maximizedScale` in
 * shared/windowSize.ts. The label says "Bigger"/"Restore" rather than
 * "Maximize" for that reason: the button is honest about being a comfortable
 * size rather than a full one, and a tooltip promising maximize over a window
 * that stops at 1.6x would read as the button failing.
 */
export default function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    tracelyApi
      .isWindowMaximized()
      .then((res) => setMaximized(res.maximized))
      .catch(() => {})
  }, [])

  // The window can also be dragged out of the maximized size by a resize grip,
  // and the icon has to follow that. A poll rather than an event because the
  // size can change from three places (grips, the font-size setting, this
  // button) and one listener beats three call sites remembering to report.
  useEffect(() => {
    const id = setInterval(() => {
      tracelyApi
        .isWindowMaximized()
        .then((res) => setMaximized(res.maximized))
        .catch(() => {})
    }, 700)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="winctl">
      <button
        className="winctl-btn"
        onClick={() => void tracelyApi.minimizeWindow()}
        title="Minimize"
        aria-label="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="winctl-btn"
        onClick={() => void tracelyApi.toggleMaximizeWindow().then((res) => setMaximized(res.maximized))}
        title={maximized ? 'Restore' : 'Bigger'}
        aria-label={maximized ? 'Restore window size' : 'Make the window bigger'}
      >
        {maximized ? (
          // Two offset rectangles — the standard "restore" glyph, and the only
          // one users already read as "put it back".
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.65" y="2.65" width="6.7" height="6.7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3 2.2V1.7A1 1 0 0 1 4 0.7h4.3a1 1 0 0 1 1 1V6a1 1 0 0 1-1 1h-.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.65" y="0.65" width="8.7" height="8.7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      </button>
    </div>
  )
}
