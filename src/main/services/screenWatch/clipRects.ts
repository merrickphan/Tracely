// Clipping underline rectangles to the region they are allowed to be drawn in.
//
// Nothing clipped them before. UIA hands back a rect for a claim, and it was
// projected and drawn as-is — so an underline could be painted on top of the
// watched app's own toolbar or ribbon (text scrolled under a sticky header
// still reports a valid positive rect), or extend past the window edge where
// the OS cut it in half.
//
// Worse, only the *drawing* was clipped by the OS. The hover hit-test region
// was not, so a rect hanging off the window edge was invisible and still opened
// a popover when the cursor crossed where it would have been. Clipping happens
// before the projection, on the single source both are derived from, so they
// cannot disagree.
//
// Import-free so `node --test` runs it with no build step.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** True for a rect usable as a clip region — finite, and with positive extent. */
export function isUsableClip(r: Rect | null | undefined): r is Rect {
  if (!r) return false
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  )
}

/** Overlap of two rects, or null if they do not overlap. */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

// A line half-scrolled under a ribbon still reports its full height from most
// providers. Intersecting that produces a squashed box — and since the mark
// draws its rule at `bottom: 0`, the rule would jump into the middle of the
// glyphs rather than sitting under them. Below this share of the original
// height the rect is dropped instead, which keeps the documented invariant
// that underlines only ever appear over currently-visible text.
const MIN_VISIBLE_HEIGHT_RATIO = 0.6

/** Sub-pixel slivers are not worth drawing, and match the script's own filter. */
const MIN_DRAWN_EXTENT = 1

export function clipUnderline(rect: Rect, clip: Rect): Rect | null {
  const hit = intersectRect(rect, clip)
  if (!hit) return null
  if (rect.height > 0 && hit.height < rect.height * MIN_VISIBLE_HEIGHT_RATIO) return null
  if (hit.width < MIN_DRAWN_EXTENT || hit.height < MIN_DRAWN_EXTENT) return null
  return hit
}

/**
 * Narrowest usable clip region from the candidates, or null to draw unclipped.
 *
 * Returning null when nothing usable is available is deliberate. A clip that
 * silently erased every underline would be indistinguishable from "UIA found
 * nothing", which CLAUDE.md documents as a normal state for an app with no
 * TextPattern support — so it would never be diagnosed. Degrading to the
 * previous unclipped behaviour is the safe failure.
 */
export function resolveClip(candidates: (Rect | null | undefined)[]): Rect | null {
  let clip: Rect | null = null
  for (const candidate of candidates) {
    if (!isUsableClip(candidate)) continue
    clip = clip ? intersectRect(clip, candidate) : candidate
    if (!clip) return null
  }
  return clip
}
