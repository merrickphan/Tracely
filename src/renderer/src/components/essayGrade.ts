/**
 * The letter band shown beside the argument score.
 *
 * Shared by the in-app Essay Grade modal (ArgumentScoreModal.tsx) and the
 * Screen Watch overlay's 'grade' panel, which draw the same Figma card
 * (370:191) against the same number. Extracted here for the same reason
 * problemCopy.ts exists: the overlay window loads no stylesheet and cannot
 * import a component module, but it must not drift on what a score MEANS.
 *
 * Bands are set so 82 reads "B+" exactly as the frame does. The second string
 * is what fills the frame's "Above average for this assignment type" slot —
 * that line asserts a comparison against other students' work, and there is no
 * cohort and no assignment type here to compare against, so the slot keeps the
 * design's position, size and weight and says what the band means instead.
 */
export const GRADE_BANDS: Array<[number, string, string]> = [
  [90, 'A', 'Built the way the rubric asks for'],
  [85, 'A-', 'Strong throughout, with small gaps'],
  [80, 'B+', 'Well built — a few gaps to close'],
  [75, 'B', 'Solid, with parts left implied'],
  [70, 'B-', 'The shape is there; the support is thin'],
  [65, 'C+', 'Half the argument is doing the work'],
  [60, 'C', 'Key moves are missing or unstated'],
  [50, 'D', 'Reads as notes rather than an argument'],
  [0, 'F', 'Not yet arguing anything the rubric can find']
]

export function gradeFor(score: number): { letter: string; line: string } {
  const band = GRADE_BANDS.find(([floor]) => score >= floor) ?? GRADE_BANDS[GRADE_BANDS.length - 1]
  return { letter: band[1], line: band[2] }
}
