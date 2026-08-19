import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { StructureAnalyzeResponse, StructureGetResponse } from '@shared/ipc-contract'
import { getClaimsByAnalysis } from '../services/storage/claimsRepo'
import { getStoredOutline, saveOutline } from '../services/storage/structureRepo'
import {
  analyzeStructure,
  sourceHashFor,
  STRUCTURE_SCHEMA_VERSION
} from '../services/structure/analyzeStructure'
import { claimsWithoutEvidence, computeEvidenceCoverage } from '../services/structure/evidenceCoverage'
import { classifyStructure } from '../services/ai/structureClassifier'
import { argumentParagraphs } from '@shared/structureText'
import { documentNames } from '@shared/documentNames'
import { withoutWorksCited } from '@shared/worksCited'
import { learnDocumentNames } from '../spellcheck'
import { offThesisParagraphs } from '../services/structure/thesisSupport'
import { looksLikeTitle } from '../services/structure/roles'

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

export function registerStructureHandlers(): void {
  ipcMain.handle(IPC.STRUCTURE_ANALYZE, async (_event, raw): Promise<StructureAnalyzeResponse> => {
    const input = analyzeSchema.parse(raw)

    // Claims come from the store rather than over the wire so the renderer
    // cannot hand main a claim it never detected, and so the strength scores
    // and breakdowns coverage reads are the persisted ones.
    const claims = input.analysisId ? getClaimsByAnalysis(input.analysisId) : []

    /**
     * What each paragraph is DOING, from the model rather than from regexes.
     *
     * This is the one relay call the structural read makes, and it is the
     * reason the read is worth trusting: `structure/roles.ts` decides thesis
     * vs claim vs counterargument from hand-written patterns, and those labels
     * drive all six score components, every weakness, and everything the
     * report says. A pattern list needs a new pattern for every essay shape it
     * has not seen — adding five thesis shapes moved one real draft from 45 to
     * 83, which is the measurement of how brittle the approach is rather than
     * a fix for it.
     *
     * Cost is one CHEAP_MODEL call per analysis, capped at 8k input chars and
     * 600 output tokens, and cached in SQLite on a hash of the assembled
     * prompt — so re-analysing an unchanged draft is free, which is what keeps
     * an always-available "Re-grade" button honest.
     *
     * Null on any failure, and null is a supported answer: analyzeStructure
     * falls back to the local heuristics and reports `rolesFrom: 'heuristic'`.
     * A structural read that degrades to the old behaviour beats one that
     * fails the whole analysis because a network call did.
     *
     * `argumentParagraphs` is the SAME function analyzeStructure scores, and
     * that is now enforced by both calling it rather than by this comment. It
     * used to say the same thing over `splitParagraphs(input.text)` while
     * analyzeStructure scored `splitParagraphs(withoutWorksCited(input.text))`
     * — same function, different input — so the classifier was paid to label
     * the reference list. Measured across five real documents: 42% of the
     * paragraphs sent were reference lines, 24% of the input tokens.
     */
    const classified = await classifyStructure(
      'classify-structure',
      argumentParagraphs(input.text).map((p) => p.text)
    )


    /**
     * Which paragraphs are not about the thesis, measured with the LOCAL
     * embedder — see structure/thesisSupport.ts. Two rubric lines that had no
     * implementation at all: "Flag if the body paragraphs do not actually
     * support the thesis" and "Flag tangents."
     *
     * Runs after the classifier because it needs the thesis position, and only
     * ever from the model's answer: the local reader's thesis guess is a
     * fallback for SCORING a component, and it is not a firm enough basis for
     * telling a student a paragraph does not belong in their essay.
     *
     * Free — in-process MiniLM, no relay, no network — which is what makes it
     * safe to run on every analysis. Null when it could not be measured, and
     * null is passed on as "say nothing".
     */
    const thesisAt = classified ? classified.roles.indexOf('thesis') : -1
    const spans = argumentParagraphs(input.text)
    const offThesis =
      thesisAt === -1
        ? null
        : await offThesisParagraphs({
            paragraphs: spans.map((p) => ({ index: p.index, text: p.text })),
            thesisIndex: thesisAt,
            titleParagraph: spans.length > 1 && looksLikeTitle(spans[0].text),
            // A conclusion restates rather than develops, so it sits closer to
            // the thesis than a body paragraph does and is never the tangent
            // this is looking for.
            skip: (classified?.roles ?? []).flatMap((r, i) =>
              r === 'conclusion' && spans[i] ? [spans[i].index] : []
            )
          })

    // Teach Chromium's spellchecker this document's proper nouns, so real
    // names stop being underlined as misspellings. Session-scoped: the next
    // document's call replaces this set, and a clean quit removes it — see
    // spellcheck.ts. Free and local; it reads text already in hand.
    // The ARGUMENT, not the bibliography. A reference list is title-case noise
    // — "The Pen Is Mightier Than the Keyboard", "Psychological Science" — and
    // it is also where a broken citation's "Unknown Author" lives. Author
    // surnames are still learned: a cited author appears in the body too, in
    // the in-text citation.
    learnDocumentNames(documentNames(withoutWorksCited(input.text)))

    const outline = analyzeStructure({
      documentId: input.documentId ?? null,
      analysisId: input.analysisId ?? null,
      text: input.text,
      claims,
      claimsWithoutEvidence: claimsWithoutEvidence(claims, input.text),
      coverage: computeEvidenceCoverage(claims, input.text),
      classified,
      ...(offThesis ? { offThesis } : {}),
      analyzedAt: new Date().toISOString()
    })

    saveOutline(outline)

    return { outline }
  })

  ipcMain.handle(IPC.STRUCTURE_GET, (_event, raw): StructureGetResponse => {
    const { documentId, text } = getSchema.parse(raw)
    const outline = getStoredOutline(documentId, STRUCTURE_SCHEMA_VERSION)

    // `stale` is reported rather than the outline being withheld: a previous
    // analysis of an edited draft is still worth showing, as long as the panel
    // says so. Silently returning null would read as "never analyzed".
    return { outline, stale: outline !== null && outline.sourceHash !== sourceHashFor(text) }
  })
}
