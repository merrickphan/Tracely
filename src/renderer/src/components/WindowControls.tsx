import { useEffect, useState } from 'react'
import { tracelyApi } from '../lib/api'

export default function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    tracelyApi.isWindowMaximized().then((res) => setMaximized(res.maximized))
    return tracelyApi.onWindowMaximizeChanged((res) => setMaximized(res.maximized))
  }, [])

  return (
    <div className="window-controls">
      <button
        className="window-control-btn"
        aria-label="Minimize"
        onClick={() => tracelyApi.minimizeWindow()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button
        className="window-control-btn"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={async () => setMaximized((await tracelyApi.toggleMaximizeWindow()).maximized)}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="2.5" y="1" width="6.5" height="6.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
            <rect x="1" y="2.5" width="6.5" height="6.5" fill="var(--surface-2)" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        )}
      </button>
      <button
        className="window-control-btn window-control-close"
        aria-label="Close"
        onClick={() => tracelyApi.hideWindow('main')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" />
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  )
}
