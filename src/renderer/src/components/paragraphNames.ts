/**
 * Moved to `shared/paragraphNames.ts` so the main process names paragraphs the
 * same way the panels do — see `paragraphSubject` there. Re-exported because
 * three renderer surfaces import it from here.
 */
export { paragraphNames, paragraphSubject, lowerSubject, paragraphTag } from '@shared/paragraphNames'
export type { ParagraphName } from '@shared/paragraphNames'
