import { createHash } from 'crypto'

/**
 * What identifies a stored outline: its schema version and the hash of the text
 * it was computed from.
 *
 * Lifted out of `analyzeStructure.ts` when the editor's report stopped being
 * computed by local rules. `documentsRepo` and `gradedOutline` both need these
 * and neither needs the rule engine, so leaving them there kept a dependency on
 * a module that only Screen Watch still runs.
 */

/**
 * Bumped when the SHAPE of a stored outline changes, so `structureRepo` can
 * refuse rows an older version wrote rather than reading a field that is not
 * there.
 *
 * 9: the editor's outline comes from the graded read (services/ai/gradeDraft),
 * so `weaknesses` carries `'model-finding'` kinds with `severity`,
 * `rubricSection` and `label`, and `cohesion` is null. A v8 row renders as a
 * report from a rule engine that no longer exists.
 */
export const STRUCTURE_SCHEMA_VERSION = 9

/**
 * The equivalence class the analysis actually cares about: two texts with the
 * same hash split into the same paragraphs with the same words.
 *
 * Runs of spaces and tabs collapse, and runs of newlines collapse to one, so
 * reformatting leaves a stored analysis valid while an edit to the words marks
 * it stale.
 */
export function sourceHashFor(text: string): string {
  const normalized = text.replace(/[ \t]+/g, ' ').replace(/[\r\n]+/g, '\n').trim()
  return createHash('sha256').update(`structure::v${STRUCTURE_SCHEMA_VERSION}::${normalized}`).digest('hex')
}
