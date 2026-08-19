/**
 * The one line of a paragraph the Essay Grade report shows on its card.
 *
 * This lived in `main/services/screenWatch/watchOutline.ts`, where it was
 * Screen Watch's alone: `DocumentOutline` carries no prose, so main truncates
 * each paragraph before sending the overlay a payload. The editor renders the
 * same report now and has the whole document to hand, which is exactly why it
 * needs this — feeding it untruncated paragraphs put a full essay inside the
 * first card and pushed every card below it off the report.
 *
 * A leaf with no imports, so `npm test` can load it.
 */

/** 90 code points — about a line and a half of the card's 12.5px text. */
export const PREVIEW_CHARS = 90

/**
 * First line of each paragraph, index-aligned to 1-based `ParagraphOutline.index`.
 *
 * Truncation is by code point, not by UTF-16 unit, so a slice can never land
 * inside a surrogate pair and emit a lone half — which renders as a replacement
 * glyph and looks like a corrupted read of the user's document.
 */
export function paragraphPreviews(texts: string[], maxChars = PREVIEW_CHARS): string[] {
  return texts.map((text) => {
    const collapsed = text.replace(/\s+/g, ' ').trim()
    const points = Array.from(collapsed)
    return points.length <= maxChars ? collapsed : `${points.slice(0, maxChars).join('')}…`
  })
}
