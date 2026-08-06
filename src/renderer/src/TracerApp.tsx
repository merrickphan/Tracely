import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TracerContext } from '@shared/ipc-contract'
import type { TracerConversation, TracerMessage } from '@shared/types'
import figmaLogo from './assets/figma-logo.png'

// This window has no shared stylesheet, same as the overlay — it's a small,
// frameless, always-on-top window with its own visual language, so styles
// live inline here rather than in styles/index.css. Tokens are copied from
// OverlayApp.tsx deliberately: Tracer is launched from the Screen Watch
// widget and should read as the same surface, not a second app.
const FONT_STACK = "'Instrument Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif"
const CARD_BORDER = '1.5px solid #17171b'
const ACCENT = '#f47b20'
const INK = '#17171b'
const MUTED = '#6b6b76'

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

function Avatar({ role }: { role: 'user' | 'tracer' }): JSX.Element {
  if (role === 'tracer') {
    return (
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: INK,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        <img
          src={figmaLogo}
          alt=""
          draggable={false}
          style={{ width: 15, height: 15, objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
        />
      </div>
    )
  }
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.07)',
        color: MUTED,
        fontSize: 11,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      You
    </div>
  )
}

function MessageBubble({ message }: { message: TracerMessage }): JSX.Element {
  const isTracer = message.role === 'tracer'
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <Avatar role={message.role} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: isTracer ? '#fff' : 'rgba(0,0,0,0.035)',
          border: isTracer ? '1px solid #e8e8ec' : '1px solid transparent',
          borderRadius: 12,
          padding: '9px 11px',
          fontSize: 13.5,
          lineHeight: 1.55,
          color: '#1a1a1f',
          // Tracer's replies are plain prose with paragraph breaks — no
          // markdown renderer here, so newlines have to survive as-is.
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere'
        }}
      >
        {message.content}
      </div>
    </div>
  )
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

  const scrollRef = useRef<HTMLDivElement>(null)
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
    if (result.focusedClaimId) {
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

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  async function send(text: string): Promise<void> {
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
  }

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

  const iconBtn: CSSProperties = {
    width: 26,
    height: 26,
    border: 'none',
    background: 'rgba(0,0,0,0.06)',
    borderRadius: '50%',
    color: MUTED,
    fontSize: 13,
    lineHeight: '26px',
    padding: 0,
    cursor: 'pointer',
    flexShrink: 0,
    WebkitAppRegion: 'no-drag'
  } as CSSProperties

  const canSend = Boolean(draft.trim()) && !sending && relayConfigured

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        border: CARD_BORDER,
        borderRadius: 16,
        overflow: 'hidden',
        fontFamily: FONT_STACK
      }}
    >
      <div
        style={
          {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 10px 0 14px',
            height: 46,
            background: '#fafafa',
            borderBottom: '1px solid #eeeef1',
            flexShrink: 0,
            // Frameless window — the header is the drag handle.
            WebkitAppRegion: 'drag'
          } as CSSProperties
        }
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: INK,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <img
            src={figmaLogo}
            alt=""
            draggable={false}
            style={{ width: 14, height: 14, objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.2 }}>Tracer</div>
          <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.2 }}>Your writing teacher</div>
        </div>
        <div style={{ flex: 1 }} />
        <button style={iconBtn} title="Conversation history" aria-label="Conversation history" onClick={() => void openHistory()}>
          ☰
        </button>
        <button style={iconBtn} title="New conversation" aria-label="New conversation" onClick={() => void startNew()}>
          +
        </button>
        <button style={iconBtn} title="Close" aria-label="Close" onClick={() => void window.tracely.tracer.close()}>
          ×
        </button>
      </div>


      {historyOpen ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 14px',
              borderBottom: '1px solid #eeeef1',
              flexShrink: 0
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>Past conversations</div>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setHistoryOpen(false)}
              style={{ border: 'none', background: 'none', fontSize: 12, fontWeight: 600, color: MUTED, cursor: 'pointer', padding: 0 }}
            >
              Done
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10 }}>
            {conversations.length === 0 ? (
              <div style={{ fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 20 }}>Nothing yet.</div>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 10px',
                    borderRadius: 10,
                    border: '1px solid #eeeef1',
                    marginBottom: 6,
                    background: c.id === conversation?.id ? 'rgba(244,123,32,0.07)' : '#fff'
                  }}
                >
                  <button
                    onClick={() => {
                      setHistoryOpen(false)
                      void load(c.id)
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      border: 'none',
                      background: 'none',
                      padding: 0,
                      cursor: 'pointer'
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: '#1a1a1f',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {c.title}
                    </div>
                    <div style={{ fontSize: 10.5, color: MUTED }}>{new Date(c.updatedAt).toLocaleString()}</div>
                  </button>
                  <button
                    onClick={() => void removeConversation(c.id)}
                    title="Delete conversation"
                    aria-label="Delete conversation"
                    style={{ border: 'none', background: 'none', color: MUTED, fontSize: 13, cursor: 'pointer', padding: 4 }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13.5, lineHeight: 1.55, color: '#1a1a1f' }}>
                  I&rsquo;m Tracer. I won&rsquo;t write your essay for you — I&rsquo;ll explain why something
                  reads as weak, and show you how to fix it yourself.
                </div>
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    className="tracer-starter"
                    onClick={() => void send(starter)}
                    disabled={!relayConfigured}
                    style={{
                      textAlign: 'left',
                      border: '1px solid #e8e8ec',
                      borderRadius: 10,
                      background: '#fff',
                      padding: '9px 11px',
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: '#3a3a44',
                      cursor: relayConfigured ? 'pointer' : 'default',
                      fontFamily: 'inherit'
                    }}
                  >
                    {starter}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}

            {sending ? (
              <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                <Avatar role="tracer" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: MUTED }}>
                  <span className="tracer-spinner" />
                  Thinking…
                </div>
              </div>
            ) : null}

            {error ? (
              <div
                style={{
                  fontSize: 12,
                  color: '#d6301a',
                  background: 'rgba(214,48,26,0.08)',
                  border: '1px solid rgba(214,48,26,0.2)',
                  borderRadius: 10,
                  padding: '8px 10px'
                }}
              >
                {error}
              </div>
            ) : null}
          </div>

          <div style={{ borderTop: '1px solid #eeeef1', padding: 10, flexShrink: 0 }}>
            {!relayConfigured ? (
              <div style={{ fontSize: 11.5, color: MUTED, textAlign: 'center', padding: '6px 0' }}>
                Tracer needs a relay. Set RELAY_URL / RELAY_TOKEN and rebuild.
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
                onKeyDown={onComposerKeyDown}
                disabled={!relayConfigured}
                placeholder="Ask Tracer about your writing…"
                rows={2}
                style={{
                  flex: 1,
                  resize: 'none',
                  border: '1px solid #e0e0e6',
                  borderRadius: 12,
                  padding: '9px 11px',
                  fontSize: 13,
                  lineHeight: 1.5,
                  fontFamily: 'inherit',
                  color: '#1a1a1f',
                  outline: 'none',
                  background: relayConfigured ? '#fff' : '#f6f6f8'
                }}
              />
              <button
                onClick={() => void send(draft)}
                disabled={!canSend}
                title="Send (Enter)"
                aria-label="Send"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  border: 'none',
                  background: canSend ? INK : 'rgba(0,0,0,0.12)',
                  color: '#fff',
                  fontSize: 15,
                  cursor: canSend ? 'pointer' : 'default',
                  flexShrink: 0
                }}
              >
                ↑
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 4px; }
        .tracer-starter:hover:not(:disabled) { border-color: ${ACCENT}; color: ${INK}; }
        textarea:focus { border-color: ${ACCENT} !important; }
        @keyframes tracer-spin { to { transform: rotate(360deg); } }
        .tracer-spinner {
          display: inline-block;
          width: 11px;
          height: 11px;
          border: 1.5px solid rgba(0,0,0,0.12);
          border-top-color: ${ACCENT};
          border-radius: 50%;
          animation: tracer-spin 0.7s linear infinite;
        }
      `}</style>
    </div>
  )
}
