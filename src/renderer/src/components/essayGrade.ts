/**
 * The letter band shown beside the argument score.
 *
 * Both of these now live in `shared/gradeLevel.ts`, which already owned the
 * grade-level shift the band lookup goes through — and which `npm test` can
 * load, where this file cannot (it resolves the `@shared` alias). Re-exported
 * rather than moved-and-rewritten, because the overlay, the report, Home and
 * the Documents list all import from here.
 */
export { GRADE_BANDS, gradeFor } from '@shared/gradeLevel'
