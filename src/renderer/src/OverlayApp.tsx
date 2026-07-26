import { useEffect, useState } from 'react'
import type { ScreenWatchOverlayUpdateEvent } from '@shared/ipc-contract'

export default function OverlayApp(): JSX.Element {
  const [underlines, setUnderlines] = useState<ScreenWatchOverlayUpdateEvent['underlines']>([])

  useEffect(() => {
    return window.tracely.onScreenWatchOverlayUpdate((event) => {
      setUnderlines(event.underlines)
    })
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {underlines.flatMap((u) =>
        u.rects.map((r, i) => (
          <div
            key={`${u.id}-${i}`}
            style={{
              position: 'absolute',
              left: r.x,
              top: r.y + r.height - 3,
              width: r.width,
              height: 3,
              borderBottom: '3px solid #b08600',
              // A CSS wavy underline needs text-decoration on real text; this is a
              // free-floating rect over someone else's app, so approximate the
              // "flagged" look with a solid amber bar instead.
              opacity: 0.85
            }}
          />
        ))
      )}
    </div>
  )
}
