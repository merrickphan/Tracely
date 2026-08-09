import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type {
  TracerCloseResponse,
  TracerDeleteConversationResponse,
  TracerGetConversationResponse,
  TracerListConversationsResponse,
  TracerNewConversationResponse,
  TracerOpenResponse,
  TracerRetryResponse,
  TracerSendResponse
} from '@shared/ipc-contract'
import { isRelayConfigured } from '../services/ai/client'
import { MAX_TRACER_MESSAGE_CHARS } from '../services/ai/costGuard'
import { askTracer } from '../services/ai/tracer'
import { getTracerContext } from '../services/screenWatch/screenWatchService'
import {
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  getOrCreateLatestConversation,
  listConversations,
  listMessages,
  popLastExchange
} from '../services/storage/tracerRepo'
import { hideTracerWindow, showTracerWindow, takeFocusedClaimId } from '../windows/tracerWindow'

const openSchema = z.object({ claimId: z.string().optional() })
const sendSchema = z.object({
  conversationId: z.string(),
  message: z.string().min(1).max(MAX_TRACER_MESSAGE_CHARS)
})
const getConversationSchema = z.object({ conversationId: z.string().optional() })
const retrySchema = z.object({ conversationId: z.string() })
const deleteSchema = z.object({ id: z.string() })

/**
 * One turn: store the question, ask Tracer, store the reply. Shared by send
 * and retry so the two can't drift on the ordering rule below.
 */
async function runTurn(conversationId: string, message: string): Promise<TracerSendResponse> {
  // History is read BEFORE the new message is stored — otherwise the
  // question being asked would also appear in the history sent alongside
  // it, and the model would see it twice.
  const history = listMessages(conversationId)
  const userMessage = addMessage(conversationId, 'user', message)

  // The user's message stays saved even when the reply fails — it's their
  // writing, and dropping it would mean retyping the question. The renderer
  // surfaces the error against the already-shown message.
  const { reply } = await askTracer(message, history, getTracerContext())
  return { userMessage, reply: addMessage(conversationId, 'tracer', reply) }
}

export function registerTracerHandlers(): void {
  ipcMain.handle(IPC.TRACER_OPEN, (_event, raw): TracerOpenResponse => {
    const { claimId } = openSchema.parse(raw)
    showTracerWindow(claimId)
    return { ok: true }
  })

  ipcMain.handle(IPC.TRACER_CLOSE, (): TracerCloseResponse => {
    hideTracerWindow()
    return { ok: true }
  })

  ipcMain.handle(IPC.TRACER_GET_CONVERSATION, (_event, raw): TracerGetConversationResponse => {
    const { conversationId } = getConversationSchema.parse(raw)
    // An explicitly-requested conversation that no longer exists (deleted in
    // another window, or wiped by Clear History while Tracer was open) falls
    // back to the latest rather than erroring the whole window out.
    const conversation =
      (conversationId ? getConversation(conversationId) : null) ?? getOrCreateLatestConversation()

    return {
      conversation,
      messages: listMessages(conversation.id),
      context: getTracerContext(),
      relayConfigured: isRelayConfigured(),
      focusedClaimId: takeFocusedClaimId()
    }
  })

  ipcMain.handle(IPC.TRACER_LIST_CONVERSATIONS, (): TracerListConversationsResponse => {
    return { conversations: listConversations() }
  })

  ipcMain.handle(IPC.TRACER_NEW_CONVERSATION, (): TracerNewConversationResponse => {
    return { conversation: createConversation() }
  })

  ipcMain.handle(IPC.TRACER_DELETE_CONVERSATION, (_event, raw): TracerDeleteConversationResponse => {
    const { id } = deleteSchema.parse(raw)
    deleteConversation(id)
    return { ok: true }
  })

  ipcMain.handle(IPC.TRACER_SEND, async (_event, raw): Promise<TracerSendResponse> => {
    const { conversationId, message } = sendSchema.parse(raw)
    if (!getConversation(conversationId)) {
      throw new Error('That conversation no longer exists.')
    }
    return runTurn(conversationId, message)
  })

  ipcMain.handle(IPC.TRACER_RETRY, async (_event, raw): Promise<TracerRetryResponse> => {
    const { conversationId } = retrySchema.parse(raw)
    if (!getConversation(conversationId)) {
      throw new Error('That conversation no longer exists.')
    }

    const message = popLastExchange(conversationId)
    if (!message) throw new Error('There is nothing to retry yet.')

    // Nothing is cached for Tracer (a chat turn depends on the whole
    // conversation, so a cache would return wrong answers rather than merely
    // useless ones) — which is what makes Retry meaningful here: the same
    // question genuinely re-runs against the model.
    return runTurn(conversationId, message)
  })
}
