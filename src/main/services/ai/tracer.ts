import type { TracerContext } from '@shared/ipc-contract'
import type { TracerMessage } from '@shared/types'
import { callRelay } from './client'
import {
  MAX_TRACER_CLAIMS_IN_CONTEXT,
  MAX_TRACER_DOCUMENT_CHARS,
  MAX_TRACER_HISTORY_MESSAGES,
  MAX_TRACER_MESSAGE_CHARS,
  MAX_TRACER_OUTLINE_ROLES,
  MAX_TRACER_OUTLINE_WEAKNESSES
} from './costGuard'

// Tracer is the only AI feature here that is a real conversation, which
// changes two things versus claimDetection/critique:
//
//  1. Nothing is cached. Every other relay call is keyed by a hash of its
//     input and served from cacheRepo on a repeat (see critique.ts) — that
//     works because those calls are pure functions of their input. A chat
//     turn depends on the whole conversation so far, and asking the same
//     follow-up twice in different conversations should give different
//     answers, so a cache here would be actively wrong, not just useless.
//  2. The prompt itself lives on the relay (lib/prompts.ts there), same as
//     the other two — the desktop app only ever sends raw content.

export interface TracerReply {
  reply: string
}

/**
 * The document/claims Tracer is answering against, flattened to the compact
 * text form the relay's prompt expects. Truncated hard: the document is
 * re-sent on every single turn, so an uncapped one would dominate the token
 * cost of a long conversation.
 */
function buildContextSummary(context: TracerContext): string {
  const parts: string[] = []

  const document = context.documentText.trim()
  if (document) {
    const truncated =
      document.length > MAX_TRACER_DOCUMENT_CHARS
        ? `${document.slice(0, MAX_TRACER_DOCUMENT_CHARS)}\n[…truncated]`
        : document
    parts.push(`What the student is writing${context.processName ? ` (in ${context.processName})` : ''}:\n${truncated}`)
  }

  if (context.claims.length > 0) {
    const claims = context.claims
      .slice(0, MAX_TRACER_CLAIMS_IN_CONTEXT)
      .map((c, i) => {
        const score = c.evidenceScore === null ? 'evidence not searched yet' : `evidence strength ${c.evidenceScore}/100`
        return `${i + 1}. [${c.claimType}, ${score}] "${c.text}"`
      })
      .join('\n')
    parts.push(`Claims Tracely has flagged in it:\n${claims}`)
  }

  // The structural read, when the draft came from Tracely's own editor. Sent
  // as the role sequence plus the findings rather than as prose about them:
  // it is a handful of tokens, and it is what turns "how do I explain my
  // evidence" from a generic writing-class answer into one about the
  // paragraph the student is looking at.
  //
  // The provisional caveat travels with it deliberately. Tracer must not
  // assert that a draft has no counterargument when the classifier never read
  // half of it — the same rule findWeaknesses enforces by withholding
  // whole-draft findings while any paragraph is unlabelled.
  const outline = context.outline
  if (outline) {
    // Truncated rather than sampled: the first N paragraphs are the ones a
    // student is most likely to be asking about, and saying how many were
    // dropped keeps Tracer from reasoning about a draft it was only shown part
    // of as though it had seen all of it.
    const shownRoles = outline.roles.slice(0, MAX_TRACER_OUTLINE_ROLES)
    const rolesOverflow = outline.roles.length - shownRoles.length
    const roles =
      shownRoles.map((role, i) => `${i + 1}. ${role}`).join(', ') +
      (rolesOverflow > 0 ? ` (+${rolesOverflow} further paragraph${rolesOverflow === 1 ? '' : 's'} not listed)` : '')
    const lines = [
      `Tracely's structural read of "${outline.title}" — structure score ${outline.score}/100${
        outline.complete ? '' : ' (PROVISIONAL: some paragraphs could not be labelled, so do not tell the student anything is missing from the draft as a whole)'
      }.`,
      `What each paragraph is doing: ${roles}.`
    ]
    if (outline.weaknesses.length > 0) {
      lines.push(`Weaknesses found:\n${outline.weaknesses.map((w) => `- ${w}`).join('\n')}`)
    }
    parts.push(lines.join('\n'))
  }

  return parts.join('\n\n')
}

/**
 * Sends one conversational turn. `history` is the conversation so far
 * (oldest first, already persisted); `message` is what the user just typed.
 * Only the last MAX_TRACER_HISTORY_MESSAGES turns are sent — see the note
 * on that constant for why the cap is on turns rather than characters.
 */
export async function askTracer(
  message: string,
  history: TracerMessage[],
  context: TracerContext
): Promise<TracerReply> {
  const trimmedHistory = history.slice(-MAX_TRACER_HISTORY_MESSAGES).map((m) => ({
    // The relay maps 'tracer' onto OpenAI's 'assistant' role — the app's own
    // vocabulary doesn't leak into the API call.
    role: m.role,
    content: m.content.slice(0, MAX_TRACER_MESSAGE_CHARS)
  }))

  return await callRelay<TracerReply>('tracer', {
    message: message.slice(0, MAX_TRACER_MESSAGE_CHARS),
    history: trimmedHistory,
    context: buildContextSummary(context)
  })
}
