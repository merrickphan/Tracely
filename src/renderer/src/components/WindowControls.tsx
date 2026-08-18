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
 * The CLOSE button is here too, and that is the change worth explaining. It
 * used to be Home's alone — an image at 833px in design coordinates, drawn by
 * HomeView and by nothing else — so the corner held three controls on Home and
 * two everywhere else, at two different sizes, and closing the window was
 * impossible from Documents, Analyze or Settings without going Home first.
 *
 * Window chrome belongs to the window, not to one view. All three live here
 * now, the same size and the same kind of button, on every screen. Home's own
 * X is gone rather than hidden: two elements doing one job is how they came to
 * disagree about size in the first place.
 *
 * Drawn as SVG at the weight of the design's thin-line icons rather than pulled
 * from a set — three small glyphs, and an icon library would be more code than
 * the paths are.
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
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
          <path d="M3 7.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <rect x="2.75" y="4.75" width="7.5" height="7.5" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5.4 4.1v-.6a1.2 1.2 0 0 1 1.2-1.2h4.9a1.2 1.2 0 0 1 1.2 1.2v4.9a1.2 1.2 0 0 1-1.2 1.2h-.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <rect x="2.75" y="2.75" width="9.5" height="9.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        )}
      </button>
      {/* Hides rather than quits, which is what Home's X always did — the app
          stays in the tray so the global hotkey and Screen Watch keep working
          with no window open (see main/index.ts's window-all-closed). */}
      <button
        className="winctl-btn winctl-close"
        onClick={() => void tracelyApi.hideWindow('main')}
        title="Close"
        aria-label="Close"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
          <path d="M3.6 3.6l7.8 7.8M11.4 3.6l-7.8 7.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
