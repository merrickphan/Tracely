import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { ArrowDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// shadcn's ai-elements `Conversation` builds on the `use-stick-to-bottom`
// package. That dependency is skipped here: it pulls in its own React
// context and ResizeObserver machinery for a behaviour this window needs
// exactly one instance of, and Tracer already had working autoscroll. The
// public API (`Conversation` / `ConversationContent` /
// `ConversationScrollButton`) is kept identical so registry components that
// expect it drop in unchanged.

type ConversationProps = ComponentProps<'div'> & { children: ReactNode }

/**
 * Scroll container that keeps itself pinned to the newest message while the
 * user is already at the bottom, and — crucially — stops doing that the
 * moment they scroll up to re-read something. Yanking someone back down mid
 * re-read is the single worst failure mode of a chat transcript.
 */
export function Conversation({ className, children, ...props }: ConversationProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth'): void => {
    const el = viewportRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const onScroll = useCallback((): void => {
    const el = viewportRef.current
    if (!el) return
    // 24px of slack so a resting scroll position that is a pixel or two off
    // the true bottom still counts as pinned.
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }, [])

  // Content grows both from new messages and from a streaming reply
  // reflowing an existing one, so observe the subtree rather than reacting
  // to a React-level "messages changed" signal the primitive can't see.
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (pinned) scrollToBottom('auto')
    })
    Array.from(el.children).forEach((child) => observer.observe(child))
    return () => observer.disconnect()
  }, [pinned, scrollToBottom])

  useEffect(() => {
    scrollToBottom('auto')
  }, [scrollToBottom])

  return (
    <div className={cn('relative flex-1 min-h-0', className)} {...props}>
      <div
        ref={viewportRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain"
        role="log"
      >
        {children}
      </div>
      {!pinned ? <ConversationScrollButton onClick={() => scrollToBottom()} /> : null}
    </div>
  )
}

export function ConversationContent({
  className,
  ...props
}: ComponentProps<'div'>): JSX.Element {
  return <div className={cn('flex flex-col gap-4 p-3.5', className)} {...props} />
}

export function ConversationScrollButton({
  className,
  ...props
}: ComponentProps<'button'>): JSX.Element {
  return (
    <button
      type="button"
      aria-label="Scroll to latest message"
      className={cn(
        'absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line-strong',
        'bg-white p-1.5 text-muted shadow-md transition-colors hover:text-ink',
        className
      )}
      {...props}
    >
      <ArrowDownIcon className="size-3.5" />
    </button>
  )
}

/** Centered placeholder for a conversation with no messages yet. */
export function ConversationEmptyState({
  className,
  ...props
}: ComponentProps<'div'>): JSX.Element {
  return <div className={cn('flex flex-col gap-2.5', className)} {...props} />
}
