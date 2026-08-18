import { useEffect, useRef, useState } from 'react'
import type { TracerMessage } from '@shared/types'
import { tracelyApi, TracelyApiError } from '../lib/api'
import tracerBadge from '../assets/tracer-badge.png'

/**
 * The Tracer chat panel, opened from Home's launcher.
 *
 * Tracer used to be its own focusable `BrowserWindow`, opened from the Screen
 * Watch widget, and was removed when that widget was rebuilt on the Figma
 * frames. This is the same conversation in the shape the owner asked for: a
 * panel anchored over Home, above the launcher that opens it.
 *
 * What is real here: the relay call, the SQLite conversation, and the
 * document context. What is not: nothing. The panel sends `tracer:send` and
 * renders what comes back.
 */

/** Local ids for the two messages that exist only on screen. */
const PENDING_ID = '__pending__'
const GREETING_ID = '__greeting__'

export default function TracerChat({ onClose }: { onClose: () => void }): JSX.Element {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<TracerMessage[]>([])
  const [draftTitle, setDraftTitle] = useState<string | null>(null)
  const [relayConfigured, setRelayConfigured] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    tracelyApi
      .getTracerConversation()
      .then((res) => {
        if (cancelled) return
        setConversationId(res.conversation.id)
        setMessages(res.messages)
        setRelayConfigured(res.relayConfigured)
        // The context string starts `The student's most recent draft, titled
        // "…"` — the title is pulled back out of it rather than carried in a
        // field of its own, because `TracerContext` is a shared type and
        // shared types here are additive: adding a field to serve one label is
        // the kind of change that file exists to discourage.
        const match = /titled "([^"]+)"/.exec(res.context.documentText)
        setDraftTitle(match?.[1] ?? null)
      })
      .catch((e) => setError(e instanceof TracelyApiError ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Pinned to the newest message, including while one is being typed.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  const greeting: TracerMessage | null =
    messages.length > 0
      ? null
      : {
          id: GREETING_ID,
          conversationId: conversationId ?? '',
          role: 'tracer',
          content: draftTitle
            ? `Hey! I can see your ${draftTitle} draft. Ask me about a claim that reads too strongly, a paragraph that is not landing, or what the grade is reacting to.`
            : 'Hey! Start a document and I can read it with you — or ask me anything about building an argument, sourcing it, or what the grade is reacting to.',
          createdAt: new Date().toISOString()
        }

  async function send(): Promise<void> {
    const text = input.trim()
    if (!text || !conversationId || sending) return

    // The typed message goes up immediately under a placeholder id, then the
    // stored pair from the database replaces it. Showing what was typed and
    // then swapping in the row that was actually saved is what keeps the ids
    // real — the panel never invents one that SQLite does not have.
    const pending: TracerMessage = {
      id: PENDING_ID,
      conversationId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString()
    }
    setMessages((prev) => [...prev, pending])
    setInput('')
    setError(null)
    setSending(true)

    try {
      const res = await tracelyApi.sendToTracer(conversationId, text)
      setMessages((prev) => [...prev.filter((m) => m.id !== PENDING_ID), res.userMessage, res.reply])
    } catch (e) {
      // The question stays on screen. It is the user's writing, and the main
      // process has already saved it — dropping the bubble would mean retyping
      // something the database is holding.
      setError(e instanceof TracelyApiError ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const shown = greeting ? [greeting] : messages

  return (
    <div className="tracer-panel" role="dialog" aria-label="Chat with Tracer">
      <header className="tracer-head">
        <img className="tracer-head-badge" src={tracerBadge} alt="" />
        <div className="tracer-head-text">
          <b>Tracer</b>
          <span>
            <i className="tracer-dot" aria-hidden="true" />
            Online — here to help
          </span>
        </div>
        <button className="tracer-close" onClick={onClose} aria-label="Close chat">
          <svg viewBox="0 0 21 21" fill="none" aria-hidden="true">
            <path d="M4 4l13 13M17 4L4 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="tracer-log" ref={scrollRef}>
        {shown.map((m) => (
          <p key={m.id} className={`tracer-msg ${m.role === 'user' ? 'from-user' : 'from-tracer'}`}>
            {m.content}
          </p>
        ))}
        {sending ? (
          <p className="tracer-msg from-tracer tracer-typing" aria-label="Tracer is typing">
            <i />
            <i />
            <i />
          </p>
        ) : null}
        {error ? <p className="tracer-error">{error}</p> : null}
        {!relayConfigured ? (
          <p className="tracer-error">
            This build has no relay configured, so Tracer cannot answer. Everything else in
            Tracely works without one.
          </p>
        ) : null}
      </div>

      <form
        className="tracer-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Tracer anything…"
          disabled={!relayConfigured || conversationId === null}
        />
        <button
          type="submit"
          className="tracer-send"
          aria-label="Send"
          disabled={!input.trim() || sending || !relayConfigured}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 19V5M12 5l-6 6M12 5l6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
    </div>
  )
}
