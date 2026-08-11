import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowUpIcon, MenuIcon, PlusIcon, XIcon } from 'lucide-react'
import type { TracerContext } from '@shared/ipc-contract'
import type { TracerConversation, TracerMessage } from '@shared/types'

import { AiActions, type AiMessage } from '@/components/ui/ai-actions'
import { ConversationEmptyState } from '@/components/ui/conversation'
import { cn } from '@/lib/utils'
import figmaLogo from './assets/figma-logo.png'

// This window is styled with Tailwind, unlike the rest of the renderer,
// because it hosts the shadcn ai-elements primitives under components/ui/.
// styles/tracer.css is imported only by tracer.tsx, so Tailwind's preflight
// reset stays inside this window and cannot reach the main, floating or
// overlay entries. Tokens (ink/accent/muted/line) are declared there and are
// the same values OverlayApp.tsx hard-codes: Tracer is launched from the
// Screen Watch widget and should read as the same surface, not a second app.

const MAX_MESSAGE_CHARS = 2000

// Openers that model what Tracer is for — asking it to explain and push
// back, rather than asking it to write. Deliberately not "fix this for me":
// the whole point of the teacher framing is that it hands back reasoning,
// not finished sentences.
const STARTERS = [
  'Why did you flag these claims in what I wrote?',
  'How do I tell if a source is actually credible?',
  'What makes my argument here weak?',
  'Explain the difference between correlation and causation in my draft.'
]

// ai-elements speaks the AI SDK's 'user' | 'assistant' vocabulary; Tracely's
// stored messages say 'user' | 'tracer'. Map at the boundary rather than
// changing either side.
function toAiMessages(messages: TracerMessage[]): AiMessage[] {
  return messages.map((m) => ({
    id: m.id,
    from: m.role === 'tracer' ? 'assistant' : 'user',
    content: m.content
  }))
}

export default function TracerApp(): JSX.Element {
  const [conversation, setConversation] = useState<TracerConversation | null>(null)
  const [messages, setMessages] = useState<TracerMessage[]>([])
  const [context, setContext] = useState<TracerContext>({ processName: null, documentText: '', claims: [] })
  const [relayConfigured, setRelayConfigured] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [conversations, setConversations] = useState<TracerConversation[]>([])

  const composerRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async (conversationId?: string): Promise<void> => {
    const result = await window.tracely.tracer.getConversation(
      conversationId ? { conversationId } : {}
    )
    setConversation(result.conversation)
    setMessages(result.messages)
    setContext(result.context)
    setRelayConfigured(result.relayConfigured)
    // Opened via "Ask Tracer about this claim" — prefill a question about
    // that specific claim rather than dropping the user on a blank box and
    // making them retype what they just clicked on.
    // A caller-composed question wins over the generic claim starter: the
    // Structure rail already knows what is wrong with the paragraph, and
    // "how do I explain what my evidence shows" is a better opening than
    // "why did you flag this claim".
    if (result.focusedPrompt) {
      setDraft(result.focusedPrompt)
    } else if (result.focusedClaimId) {
      const claim = result.context.claims.find((c) => c.id === result.focusedClaimId)
      if (claim) setDraft(`Why did you flag this claim, and how would I strengthen it?\n\n"${claim.text}"`)
    }
  }, [])

  useEffect(() => {
    void load()
    return window.tracely.onTracerContextChanged(setContext)
  }, [load])

  // The window is hidden rather than destroyed on close (see
  // tracerWindow.ts), so a reopen fires no mount — main pushes this event
  // on every show instead. Without it, the second and every later open
  // would still be showing whatever conversation and document context were
  // there when it was last dismissed.
  useEffect(() => {
    return window.tracely.onTracerOpened(() => {
      void load()
    })
  }, [load])

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim()
      if (!trimmed || !conversation || sending) return
      setError(null)
      setSending(true)
      setDraft('')
      try {
        const result = await window.tracely.tracer.send({ conversationId: conversation.id, message: trimmed })
        setMessages((prev) => [...prev, result.userMessage, result.reply])
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // The question itself was saved server-side even though the reply
        // failed (see tracerHandlers.ts) — reload so what's on screen matches
        // what's actually stored, then show the error against it.
        setError(message.replace(/^Error invoking remote method '[^']+':\s*/, ''))
        if (conversation) await load(conversation.id)
      } finally {
        setSending(false)
        composerRef.current?.focus()
      }
    },
    [conversation, sending, load]
  )

  // Retry replaces the exchange it re-asks, rather than appending a second copy
  // of the question.
  //
  // This used to call send() with the old question, which reads as the gentler
  // option — nothing is deleted, and you can compare the two answers. But every
  // turn re-sends the whole conversation as history, so an appended retry asks
  // the model the same question *with the answer you just rejected sitting in
  // its context*. The most likely result is a variation on the answer you
  // didn't want, which makes the button look broken rather than useless.
  //
  // Main deletes the discarded pair before re-running (popLastExchange), so the
  // stored transcript and what's on screen stay the same thing. Only the newest
  // reply offers Retry — ai-actions.tsx enforces that — because popLastExchange
  // discards from the last question onward.
  const retry = useCallback(
    async (messageId: string): Promise<void> => {
      if (!conversation || sending) return
      // Guard as well as hide. The button is only rendered on the last message,
      // but a stale render could still fire this for an earlier one, and the
      // cost of being wrong here is silently deleting later turns.
      if (messages.length === 0 || messages[messages.length - 1].id !== messageId) return

      setError(null)
      setSending(true)
      // Optimistic, matching what main is about to do. Leaving them up would
      // show the rejected answer beside its replacement, and the transcript
      // would no longer match what is stored.
      setMessages((prev) => prev.slice(0, -2))
      try {
        const result = await window.tracely.tracer.retry({ conversationId: conversation.id })
        setMessages((prev) => [...prev, result.userMessage, result.reply])
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message.replace(/^Error invoking remote method '[^']+':\s*/, ''))
        // The optimistic removal above may not match what actually happened —
        // popLastExchange could have committed before the model call failed.
        // Reload rather than guess.
        await load(conversation.id)
      } finally {
        setSending(false)
        composerRef.current?.focus()
      }
    },
    [conversation, sending, messages, load]
  )

  async function startNew(): Promise<void> {
    const { conversation: fresh } = await window.tracely.tracer.newConversation()
    setConversation(fresh)
    setMessages([])
    setError(null)
    setHistoryOpen(false)
    composerRef.current?.focus()
  }

  async function openHistory(): Promise<void> {
    const { conversations: list } = await window.tracely.tracer.listConversations()
    setConversations(list)
    setHistoryOpen(true)
  }

  async function removeConversation(id: string): Promise<void> {
    await window.tracely.tracer.deleteConversation({ id })
    const { conversations: list } = await window.tracely.tracer.listConversations()
    setConversations(list)
    // Deleting the conversation currently on screen leaves nothing coherent
    // to show — fall back to the most recent remaining one (or a new one).
    if (conversation?.id === id) await load()
  }

  function onComposerKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends, Shift+Enter is a newline — the convention every chat UI
    // uses, and the composer is multi-line precisely because pasting a
    // paragraph of your own writing to ask about is a normal thing to do.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(draft)
    }
  }

  const canSend = Boolean(draft.trim()) && !sending && relayConfigured

  const iconBtn =
    'flex size-6.5 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-muted transition-colors hover:bg-black/10 hover:text-ink'

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border-[1.5px] border-ink bg-white font-sans">
      <div
        className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line bg-[#fafafa] pl-3.5 pr-2.5"
        // Frameless window — the header is the drag handle.
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex size-6 items-center justify-center rounded-full bg-ink">
          <img
            src={figmaLogo}
            alt=""
            draggable={false}
            className="size-3.5 object-contain brightness-0 invert"
          />
        </div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold leading-tight text-ink">Tracer</div>
          <div className="text-[10.5px] leading-tight text-muted">Your writing teacher</div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <button className={iconBtn} title="Conversation history" aria-label="Conversation history" onClick={() => void openHistory()}>
            <MenuIcon className="size-3.5" />
          </button>
          <button className={iconBtn} title="New conversation" aria-label="New conversation" onClick={() => void startNew()}>
            <PlusIcon className="size-3.5" />
          </button>
          <button className={iconBtn} title="Close" aria-label="Close" onClick={() => void window.tracely.tracer.close()}>
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {historyOpen ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center border-b border-line px-3.5 py-2.5">
            <div className="text-[12.5px] font-bold text-ink">Past conversations</div>
            <div className="flex-1" />
            <button
              onClick={() => setHistoryOpen(false)}
              className="text-xs font-semibold text-muted transition-colors hover:text-ink"
            >
              Done
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {conversations.length === 0 ? (
              <div className="mt-5 text-center text-xs text-muted">Nothing yet.</div>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'mb-1.5 flex items-center gap-2 rounded-[10px] border border-line px-2.5 py-2.5',
                    c.id === conversation?.id ? 'bg-accent/[0.07]' : 'bg-white'
                  )}
                >
                  <button
                    onClick={() => {
                      setHistoryOpen(false)
                      void load(c.id)
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-[12.5px] font-semibold text-body">{c.title}</div>
                    <div className="text-[10.5px] text-muted">{new Date(c.updatedAt).toLocaleString()}</div>
                  </button>
                  <button
                    onClick={() => void removeConversation(c.id)}
                    title="Delete conversation"
                    aria-label="Delete conversation"
                    className="p-1 text-muted transition-colors hover:text-danger"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <>
          {messages.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
              <ConversationEmptyState>
                <div className="text-[13.5px] leading-[1.55] text-body">
                  I&rsquo;m Tracer. I won&rsquo;t write your essay for you — I&rsquo;ll explain why something
                  reads as weak, and show you how to fix it yourself.
                </div>
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    onClick={() => void send(starter)}
                    disabled={!relayConfigured}
                    className={cn(
                      'rounded-[10px] border border-line-strong bg-white px-2.5 py-2.5 text-left',
                      'text-[12.5px] font-semibold text-[#3a3a44] transition-colors',
                      'hover:border-accent hover:text-ink disabled:cursor-default disabled:opacity-50 disabled:hover:border-line-strong'
                    )}
                  >
                    {starter}
                  </button>
                ))}
              </ConversationEmptyState>
            </div>
          ) : (
            <AiActions
              messages={toAiMessages(messages)}
              assistantAvatar={figmaLogo}
              onRetry={relayConfigured && !sending ? (id) => void retry(id) : undefined}
              footer={
                <>
                  {sending ? (
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-ink">
                        <img
                          src={figmaLogo}
                          alt=""
                          draggable={false}
                          className="size-[15px] object-contain brightness-0 invert"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
                        <span
                          className="inline-block size-[11px] rounded-full border-[1.5px] border-black/10 border-t-accent"
                          style={{ animation: 'tracer-spin 0.7s linear infinite' }}
                        />
                        Thinking…
                      </div>
                    </div>
                  ) : null}
                  {error ? (
                    <div className="rounded-[10px] border border-danger/20 bg-danger/[0.08] px-2.5 py-2 text-xs text-danger">
                      {error}
                    </div>
                  ) : null}
                </>
              }
            />
          )}

          <div className="shrink-0 border-t border-line p-2.5">
            {!relayConfigured ? (
              <div className="py-1.5 text-center text-[11.5px] text-muted">
                Tracer needs a relay. Set RELAY_URL / RELAY_TOKEN and rebuild.
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
                onKeyDown={onComposerKeyDown}
                disabled={!relayConfigured}
                placeholder="Ask Tracer about your writing…"
                rows={2}
                className={cn(
                  'flex-1 resize-none rounded-xl border border-[#e0e0e6] px-2.5 py-2.5',
                  'text-[13px] leading-normal text-body outline-none',
                  'focus:border-accent disabled:bg-[#f6f6f8]'
                )}
              />
              <button
                onClick={() => void send(draft)}
                disabled={!canSend}
                title="Send (Enter)"
                aria-label="Send"
                className={cn(
                  'flex size-[38px] shrink-0 items-center justify-center rounded-full text-white transition-colors',
                  canSend ? 'bg-ink' : 'cursor-default bg-black/[0.12]'
                )}
              >
                <ArrowUpIcon className="size-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
