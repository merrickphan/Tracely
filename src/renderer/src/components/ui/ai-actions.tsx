import { useState } from 'react'
import { CheckIcon, CopyIcon, RefreshCcwIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'

import { Action, Actions } from '@/components/ui/actions'
import { Conversation, ConversationContent } from '@/components/ui/conversation'
import { Message, MessageContent } from '@/components/ui/message'
import { cn } from '@/lib/utils'

// Three departures from the upstream ai-actions example, all forced by the
// host app rather than taste:
//
//  1. No `next/image`. This is Electron, not Next — there is no image
//     optimizer and no /_next route to serve from. Plain <img> with a
//     bundled asset is the only thing that resolves.
//  2. No remote avatars. tracer.html ships `img-src 'self' data:`, so
//     github.com/openai.png (and any Unsplash placeholder) is blocked by CSP
//     before it is a design question. Both avatars are drawn locally.
//  3. No "Share" action. The upstream row is Retry/Like/Dislike/Copy/Share;
//     Tracely is local-first with no account, no permalink and nothing to
//     share *to*, so a Share button could only ever be decorative. Copy is
//     the honest version of it.

export type AiMessage = {
  id: string
  from: 'user' | 'assistant'
  content: string
}

export type AiActionsProps = {
  messages: AiMessage[]
  /** Mark of the assistant — a bundled asset, drawn inside an ink circle. */
  assistantAvatar: string
  /** Re-ask the question that produced a given reply. Omit to hide Retry. */
  onRetry?: (messageId: string) => void
  /** Rendered below the last message — spinner, error banner, etc. */
  footer?: React.ReactNode
  className?: string
}

// Deprecated, but it is the only clipboard path that works from an
// unfocused document, and Electron still implements it.
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}

function Avatar({ from, assistantAvatar }: { from: 'user' | 'assistant'; assistantAvatar: string }): JSX.Element {
  if (from === 'assistant') {
    return (
      <div className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-ink">
        <img
          src={assistantAvatar}
          alt="Tracer"
          draggable={false}
          className="size-[15px] object-contain brightness-0 invert"
        />
      </div>
    )
  }
  return (
    <div className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-black/[0.07] text-[11px] font-bold text-muted">
      You
    </div>
  )
}

export function AiActions({
  messages,
  assistantAvatar,
  onRetry,
  footer,
  className
}: AiActionsProps): JSX.Element {
  // Ratings and the copy confirmation are deliberately component-local and
  // unpersisted. There is no feedback endpoint on the relay to send a rating
  // to, and writing one into tracer_messages would imply it goes somewhere.
  const [ratings, setRatings] = useState<Record<string, 'up' | 'down'>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  function rate(id: string, value: 'up' | 'down'): void {
    setRatings((prev) => ({ ...prev, [id]: prev[id] === value ? undefined : value }) as Record<string, 'up' | 'down'>)
  }

  async function copy(message: AiMessage): Promise<void> {
    // navigator.clipboard rejects with NotAllowedError ("Document is not
    // focused") whenever the window isn't foreground — which for a small
    // always-on-top popup next to the app you're actually typing in is a
    // normal state, not an edge case. Fall back to the execCommand path
    // rather than leaving an unhandled rejection and a button that looks
    // like it did nothing.
    let ok = true
    try {
      await navigator.clipboard.writeText(message.content)
    } catch {
      ok = legacyCopy(message.content)
    }
    if (!ok) return
    setCopiedId(message.id)
    window.setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), 1400)
  }

  return (
    <Conversation className={cn('w-full', className)}>
      <ConversationContent>
        {messages.map((message) => (
          <Message
            className={message.from === 'assistant' ? 'items-start' : 'items-end'}
            from={message.from}
            key={message.id}
          >
            <Avatar from={message.from} assistantAvatar={assistantAvatar} />
            <MessageContent>{message.content}</MessageContent>
            {message.from === 'assistant' ? (
              <Actions className="-ml-1.5">
                {onRetry ? (
                  <Action label="Retry" onClick={() => onRetry(message.id)}>
                    <RefreshCcwIcon className="size-4" />
                  </Action>
                ) : null}
                <Action
                  label="Like"
                  active={ratings[message.id] === 'up'}
                  onClick={() => rate(message.id, 'up')}
                >
                  <ThumbsUpIcon className="size-4" />
                </Action>
                <Action
                  label="Dislike"
                  active={ratings[message.id] === 'down'}
                  onClick={() => rate(message.id, 'down')}
                >
                  <ThumbsDownIcon className="size-4" />
                </Action>
                <Action
                  label={copiedId === message.id ? 'Copied' : 'Copy'}
                  active={copiedId === message.id}
                  onClick={() => void copy(message)}
                >
                  {copiedId === message.id ? (
                    <CheckIcon className="size-4" />
                  ) : (
                    <CopyIcon className="size-4" />
                  )}
                </Action>
              </Actions>
            ) : null}
          </Message>
        ))}
        {footer}
      </ConversationContent>
    </Conversation>
  )
}
