import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { StructureAnalyzeResponse, StructureGetResponse } from '@shared/ipc-contract'
import { getClaimsByAnalysis } from '../services/storage/claimsRepo'
import { getStoredOutline, saveOutline } from '../services/storage/structureRepo'
import {
  sourceHashFor,
  STRUCTURE_SCHEMA_VERSION
} from '../services/structure/outlineIdentity'
import { computeEvidenceCoverage } from '../services/structure/evidenceCoverage'
import { gradeDraft } from '../services/ai/gradeDraft'
import { buildGradedOutline } from '../services/structure/gradedOutline'
import { argumentParagraphs } from '@shared/structureText'
import { documentNames } from '@shared/documentNames'
import { withoutWorksCited } from '@shared/worksCited'
import { learnDocumentNames } from '../spellcheck'

// Matches documentsHandlers' MAX_BODY_CHARS. The analysis is linear in the
// document, but the database is fully re-serialized on every write, so a
// runaway paste should be rejected at the same boundary the document itself is.
const MAX_TEXT_CHARS = 400_000

const analyzeSchema = z.object({
  documentId: z.string().min(1).nullish(),
  text: z.string().max(MAX_TEXT_CHARS),
  analysisId: z.string().min(1).nullish()
})

const getSchema = z.object({
  documentId: z.string().min(1),
  text: z.string().max(MAX_TEXT_CHARS)
})

/**
 * The editor's report: ONE relay call, reading the whole draft against the
 * owner's rubric. There is no local path any more.
 *
 * ── What was here, and why it is gone ──────────────────────────────────────
 * A rule engine: ten prose detectors, a lexical cohesion pass, an
 * embedding-based tangent check, a hand-written role classifier and a weakness
 * generator, feeding a six-component formula. Owner, 2026-08-19, across a day
 * of false positives: *"if I just gave an essay to ChatGPT and had it graded
 * with a detailed prompt, it would give a pretty good response on what to
 * change"* and then *"lets reset the whole reasoning system into a simple
 * chatgpt answers it and it kicks back to tracely. Extremely simple and
 * efficient."*
 *
 * The rules covered the easy half of the rubric and produced most of the noise.
 * The half a rule genuinely cannot reach — does this evidence support this
 * claim, is this counterargument the strongest available — was already in a
 * prompt. Keeping both meant a report whose contents depended on whether a
 * network call happened to succeed.
 *
 * ── What is still local, and why ───────────────────────────────────────────
 * - **The arithmetic.** The model returns six component sub-scores; the client
 *   sums them (`scoreFromComponents`). An unchanged draft scores an unchanged
 *   number and every point traces to a quoted sentence.
 * - **Quote verification.** `verifyGrade` discards any finding whose quote is
 *   not in the draft. That is what replaces "every word a student reads comes
 *   from a local template", and it is what produces the underline offsets.
 * - **Citation shape** (`shared/citationShape.ts`) and the prose/grammar rules,
 *   which are free, instant, and about the surface of a reference rather than
 *   about the argument.
 *
 * ── Failing loudly ─────────────────────────────────────────────────────────
 * When the graded read cannot be obtained this throws. It used to fall through
 * to the rule engine, which meant a relay outage silently swapped the report
 * for a worse one with no way to tell from the screen. An error the writer can
 * retry is the honest version of "no grade right now".
 */
export function registerStructureHandlers(): void {
  ipcMain.handle(IPC.STRUCTURE_ANALYZE, async (_event, raw): Promise<StructureAnalyzeResponse> => {
    const input = analyzeSchema.parse(raw)

    // Claims come from the store rather than over the wire, so the renderer
    // cannot hand main a claim it never detected and the strength scores
    // coverage reads are the persisted ones.
    const claims = input.analysisId ? getClaimsByAnalysis(input.analysisId) : []

    // The ARGUMENT, not the bibliography — `argumentParagraphs` trims the
    // works-cited section. Measured before this existed: 42% of the paragraphs
    // sent to the model were reference lines, and 24% of the input tokens.
    const paragraphs = argumentParagraphs(input.text)

    // BEFORE the relay call, not after. It was after, and a failed grade throws
    // — so on any network blip the writer got no report AND every proper noun
    // in their draft underlined as a misspelling. This is free, local, and has
    // nothing to do with whether the grade succeeded.
    learnDocumentNames(documentNames(withoutWorksCited(input.text)))

    const grade = await gradeDraft(
      paragraphs.map((p) => p.text),
      input.text
    )
    if (!grade) {
      throw new Error('Could not grade this draft. Check your connection and try again.')
    }

    const outline = buildGradedOutline({
      documentId: input.documentId ?? null,
      analysisId: input.analysisId ?? null,
      text: input.text,
      claims,
      coverage: computeEvidenceCoverage(claims, input.text),
      grade
    })

    saveOutline(outline)
    return { outline }
  })

  ipcMain.handle(IPC.STRUCTURE_GET, (_event, raw): StructureGetResponse => {
    const { documentId, text } = getSchema.parse(raw)

    /**
     * Teach the spellchecker on OPEN, not only on analyse.
     *
     * This ran in the analyse handler alone, so every proper noun in a draft
     * stayed underlined until the writer pressed AI Insights — and a document
     * they only ever read was underlined forever. Owner, 2026-08-19: *"it is
     * currently underlining 'Audrey', 'Nazi', 'Dutch', 'Hepburn' … as unknown
     * words, which is just not true."* Measured on that draft,
     * `documentNames` finds all of them; nothing was ever asking it.
     *
     * This handler is the earliest place main is handed the document's plain
     * TEXT — the save path carries `bodyHtml`, and main has no HTML parser.
     * Free, local, and idempotent: re-learning an unchanged set diffs to
     * nothing (see spellcheck.ts).
     */
    learnDocumentNames(documentNames(withoutWorksCited(text)))

    const outline = getStoredOutline(documentId, STRUCTURE_SCHEMA_VERSION)

    // `stale` is reported rather than the outline being withheld: a previous
    // analysis of an edited draft is still worth showing, as long as the panel
    // says so. Silently returning null would read as "never analyzed".
    return { outline, stale: outline !== null && outline.sourceHash !== sourceHashFor(text) }
  })
}
