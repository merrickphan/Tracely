import type { ResizeHandle } from '@shared/ipc-contract'
import { tracelyApi } from '../lib/api'

/**
 * The eight window-resize handles, drawn by us because the OS will not.
 *
 * A frameless window normally still gets Windows' invisible resize border. This
 * window is also `transparent: true`, and a transparent frameless window does
 * not receive the non-client hit-test that border depends on — measured by
 * setting `resizable: true` on a real build and finding that no corner caught.
 * So the grip areas are ordinary DOM, and the movement is applied main-side.
 *
 * Invisible on purpose. The design has no window chrome and adding a visible
 * gripper would be inventing UI the Figma file does not have; these sit over
 * the transparent gutter between the card and the window edge (--window-margin,
 * 14px) where there is nothing to cover up. The cursor is the affordance, which
 * is what every OS window does anyway.
 *
 * `-webkit-app-region: no-drag` is load-bearing. The card is the window's drag
 * handle, and a drag region swallows the pointer events these need — the grips
 * would move the window instead of resizing it, which is exactly the bug they
 * exist to fix.
 */

const HANDLES: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export default function ResizeGrips(): JSX.Element {
  function onPointerDown(handle: ResizeHandle, event: React.PointerEvent<HTMLDivElement>): void {
    // Left button only. A right-drag on a window edge is a context-menu
    // gesture everywhere else and would start a resize that never ends,
    // because no pointerup follows the menu.
    if (event.button !== 0) return
    event.preventDefault()

    // Screen coordinates, not client ones. The document is under a CSS `zoom`
    // that this drag is actively changing, so a client-space origin would be
    // measured in units that move underneath the drag.
    const originX = event.screenX
    const originY = event.screenY

    // Pointer capture, so the drag survives the cursor leaving this 14px strip
    // — which it does immediately, since the window is being pulled away from
    // under it. Without capture the resize stops the moment you move quickly.
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    void tracelyApi.resizeStart(handle)

    // One in-flight IPC call at a time. Pointer events fire faster than a
    // round-trip completes, and queueing them makes the window lag seconds
    // behind the cursor and keep moving after the mouse stops. Dropping the
    // intermediate frames is correct precisely because each message carries the
    // total delta from the drag's origin rather than an increment — the next
    // one to get through is still exactly right.
    let inFlight = false
    const move = (e: PointerEvent): void => {
      if (inFlight) return
      inFlight = true
      void tracelyApi.resizeMove(e.screenX - originX, e.screenY - originY).finally(() => {
        inFlight = false
      })
    }
    const end = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    // pointercancel too: the OS can steal the capture (a display change, a
    // touch gesture), and a listener that only ends on pointerup would leave
    // the window resizing against a pointer nobody is holding.
    target.addEventListener('pointercancel', end)
  }

  return (
    <>
      {HANDLES.map((handle) => (
        <div
          key={handle}
          className={`resize-grip resize-grip-${handle}`}
          data-handle={handle}
          onPointerDown={(event) => onPointerDown(handle, event)}
        />
      ))}
    </>
  )
}
