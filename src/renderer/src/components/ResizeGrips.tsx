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
    // behind the cursor and keep moving after the mouse stops.
    //
    // Coalescing, not dropping. The old version discarded every frame that
    // arrived while a call was outstanding and sent nothing afterwards, so the
    // window only ever reached the position of a frame that happened to land in
    // a gap between round-trips. Two symptoms, both reported as "glitchy":
    // during the drag the edge advances in visible steps rather than following
    // the cursor, and at the END the last frame before pointerup is very likely
    // to be one of the discarded ones — so the window settles at a size the
    // user did not release at, and no further event ever corrects it.
    //
    // Keeping the latest delta and sending it when the call returns fixes both,
    // and it is safe for exactly the reason dropping was: each message carries
    // the total delta from the drag's origin, never an increment, so a stale
    // pending value is simply replaced rather than accumulated.
    let inFlight = false
    let pending: { dx: number; dy: number } | null = null

    const flush = (): void => {
      if (inFlight || pending === null) return
      const { dx, dy } = pending
      pending = null
      inFlight = true
      void tracelyApi.resizeMove(dx, dy).finally(() => {
        inFlight = false
        // Trailing edge: whatever arrived while this was out goes now.
        flush()
      })
    }

    const move = (e: PointerEvent): void => {
      pending = { dx: e.screenX - originX, dy: e.screenY - originY }
      flush()
    }
    const end = (e: PointerEvent): void => {
      // The release position, unconditionally — `move` may never have seen this
      // pointer's final coordinates, and even if it did they may still be
      // sitting in `pending` behind an in-flight call.
      pending = { dx: e.screenX - originX, dy: e.screenY - originY }
      flush()
      // Released explicitly. Capture is dropped automatically on pointerup, but
      // not on the pointercancel path, and a grip still holding capture eats
      // every subsequent pointer event in the window.
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
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
