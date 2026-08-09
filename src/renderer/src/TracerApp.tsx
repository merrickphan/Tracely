import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
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

// Hand-rolled inline SVG rather than an icon dependency, same convention as
// components/icons.tsx — kept local here because this window deliberately
// shares no module with the main-window renderer (see the note above).
function CopyIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5.5 15H5a1.5 1.5 0 01-1.5-1.5v-9A1.5 1.5 0 015 3h9A1.5 1.5 0 0115.5 4.5V5" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12.5l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RetryIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 12a8 8 0 11-2.4-5.7" strokeLinecap="round" />
      <path d="M20 4v4.5h-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// The action row under a Tracer reply. `label` is both the tooltip and the
// accessible name — these are icon-only buttons, so without it they announce
// as nothing at all.
function Actions({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ display: 'flex', gap: 2, marginTop: 4, marginLeft: 35 }}>{children}</div>
}

function Action({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <button
      className="tracer-action"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        border: 'none',
        borderRadius: 7,
        background: 'transparent',
        color: MUTED,
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1
      }}
    >
      {children}
    </button>
  )
}

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

function MessageBubble({ message, actions }: { message: TracerMessage; actions?: ReactNode }): JSX.Element {
  const isTracer = message.role === 'tracer'
  return (
    <div>
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
      {actions}
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
  // Which reply is currently showing the "copied" checkmark. Id rather than a
  // boolean so copying a second reply doesn't leave two ticks on screen.
  const [copiedId, setCopiedId] = useState<string | null>(null)

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

  async function copyReply(message: TracerMessage): Promise<void> {
    await navigator.clipboard.writeText(message.content)
    setCopiedId(message.id)
  }

  // Reset the checkmark on a timer rather than leaving it stuck as the
  // button's permanent state — it's feedback, not a mode.
  useEffect(() => {
    if (!copiedId) return
    const timer = window.setTimeout(() => setCopiedId(null), 1600)
    return () => window.clearTimeout(timer)
  }, [copiedId])

  async function retry(): Promise<void> {
    if (!conversation || sending) return
    setError(null)
    setSending(true)
    // Main deletes the discarded question/answer pair and re-asks, so drop
    // both here too — otherwise the old reply stays on screen next to its
    // replacement and the transcript no longer matches what's stored.
    setMessages((prev) => prev.slice(0, -2))
    try {
      const result = await window.tracely.tracer.retry({ conversationId: conversation.id })
      setMessages((prev) => [...prev, result.userMessage, result.reply])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message.replace(/^Error invoking remote method '[^']+':\s*/, ''))
      await load(conversation.id)
    } finally {
      setSending(false)
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
              messages.map((m, i) => {
                // Retry is offered only on the newest reply. `popLastExchange`
                // discards from the last question onward, so retrying an
                // earlier turn would silently delete everything after it.
                const isLatestReply = m.role === 'tracer' && i === messages.length - 1
                return (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    actions={
                      m.role === 'tracer' ? (
                        <Actions>
                          <Action label={copiedId === m.id ? 'Copied' : 'Copy'} onClick={() => void copyReply(m)}>
                            {copiedId === m.id ? <CheckIcon /> : <CopyIcon />}
                          </Action>
                          {isLatestReply ? (
                            <Action label="Retry" onClick={() => void retry()} disabled={sending || !relayConfigured}>
                              <RetryIcon />
                            </Action>
                          ) : null}
                        </Actions>
                      ) : null
                    }
                  />
                )
              })
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
            {/* One bordered surface containing both the textarea and the send
                row, rather than a box beside a button — the whole thing lights
                up on focus, so it reads as a single input the way the rest of
                the chat reads as single bubbles. */}
            <div className={`tracer-composer${relayConfigured ? '' : ' is-disabled'}`}>
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
                onKeyDown={onComposerKeyDown}
                disabled={!relayConfigured}
                placeholder="Ask Tracer about your writing…"
                rows={2}
                style={{
                  width: '100%',
                  resize: 'none',
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  fontFamily: 'inherit',
                  color: '#1a1a1f',
                  outline: 'none'
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                {/* Only worth showing as the cap gets close — a counter that's
                    always on turns a writing box into a form field. */}
                <div style={{ fontSize: 10.5, color: MUTED, minWidth: 0 }}>
                  {draft.length > MAX_MESSAGE_CHARS - 200
                    ? `${MAX_MESSAGE_CHARS - draft.length} characters left`
                    : 'Enter to send · Shift+Enter for a new line'}
                </div>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => void send(draft)}
                  disabled={!canSend}
                  title="Send (Enter)"
                  aria-label="Send"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    border: 'none',
                    background: canSend ? INK : 'rgba(0,0,0,0.12)',
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    cursor: canSend ? 'pointer' : 'default',
                    flexShrink: 0
                  }}
                >
                  ↑
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 4px; }
        .tracer-starter:hover:not(:disabled) { border-color: ${ACCENT}; color: ${INK}; }
        .tracer-action:hover:not(:disabled) { background: rgba(0,0,0,0.06); color: ${INK}; }
        .tracer-composer {
          border: 1px solid #e0e0e6;
          border-radius: 14px;
          background: #fff;
          padding: 10px 11px;
          transition: border-color 0.12s ease;
        }
        /* The textarea has no border of its own now, so focus has to be
           reflected by the wrapper or there'd be no focus indicator at all. */
        .tracer-composer:focus-within { border-color: ${ACCENT}; }
        .tracer-composer.is-disabled { background: #f6f6f8; }
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
