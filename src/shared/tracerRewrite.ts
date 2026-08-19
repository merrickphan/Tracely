import { isNarrowing } from './narrowing.ts'

/**
 * The rewrite Tracer is allowed to propose, pulled out of its reply.
 *
 * Tracer answers in free prose — that is the whole shape of the endpoint, and
 * `api/tracer.ts` has no JSON schema on it. So a proposed edit arrives as a
 * delimited block at the end of the reply:
 *
 *     <<<REWRITE
 *     FIND: Fossil fuel companies are the root of all environmental degradation.
 *     REPLACE: Fossil fuel companies are a major driver of environmental degradation.
 *     >>>
 *
 * The block is the CONTRACT, not a formatting convenience: the app has to know
 * exactly which characters to replace with exactly which characters before it
 * will touch a student's document. Prose saying "try softening it to a major
 * driver of" is a suggestion; this is an edit.
 *
 * Everything degrades safely. A reply with no block is an ordinary answer. A
 * malformed block stays in the prose where the reader can see it, rather than
 * silently becoming a button.
 */

export interface TracerRewrite {
  /** The exact text to look for in the document. */
  find: string
  /** What to put in its place. */
  replace: string
}

export interface ParsedTracerReply {
  /** The reply with the block removed — what the chat bubble shows. */
  prose: string
  /** Null when there is no block, it is malformed, or it fails the rules. */
  rewrite: TracerRewrite | null
}

const BLOCK = /<<<REWRITE\s*\n([\s\S]*?)\n?>>>/
// Line-scoped on purpose. A lazy [\s\S]*? here will happily cross the newline
// and swallow the next label when its own line is empty, so an empty FIND came
// back holding the REPLACE text — a malformed block that looked well-formed.
const FIND = /^FIND:[ \t]*([^\n]*)/m
const REPLACE = /^REPLACE:[ \t]*([^\n]*)/m

/**
 * Splits a reply into what to show and what to offer.
 *
 * The rules a block must survive to become an Apply button:
 *
 *  - both fields present and non-empty;
 *  - the replacement actually differs from the original;
 *  - and `isNarrowing` — the replacement may drop named things but may never
 *    introduce one. That is the same check critique's `suggestedRevision` goes
 *    through, and it is what keeps this from ghostwriting: a rewrite that
 *    brings in a fact the student never asserted is a different sentence, not a
 *    narrower one.
 *
 * A block that fails any of these is dropped from the offer but LEFT IN THE
 * PROSE. The reader still sees what was suggested; the app just will not type
 * it into their document for them.
 */
export function parseTracerReply(reply: string): ParsedTracerReply {
  const block = BLOCK.exec(reply)
  if (!block) return { prose: reply.trim(), rewrite: null }

  const find = FIND.exec(block[1])?.[1]?.trim() ?? ''
  const replace = REPLACE.exec(block[1])?.[1]?.trim() ?? ''
  const usable = find !== '' && replace !== '' && find !== replace && isNarrowing(replace, find)

  return {
    // The block is only stripped when it became an offer. Leaving a malformed
    // one visible is deliberate: a reply that silently loses its last paragraph
    // reads as the model trailing off.
    prose: usable ? reply.replace(BLOCK, '').trim() : reply.trim(),
    rewrite: usable ? { find, replace } : null
  }
}
