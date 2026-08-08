import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

// `from` is the ai-elements convention (it mirrors the AI SDK's message
// role), so it is kept even though Tracely's own TracerMessage type calls
// the two sides 'user' and 'tracer'. TracerApp maps between them at the call
// site rather than forking the primitive.
export type MessageFrom = 'user' | 'assistant'

export type MessageProps = ComponentProps<'div'> & {
  from: MessageFrom
}

export function Message({ className, from, ...props }: MessageProps): JSX.Element {
  return (
    <div
      // `group` + the data attribute let MessageContent below style itself
      // off the sender without either component needing a shared context.
      className={cn('group flex w-full flex-col gap-2', className)}
      data-from={from}
      {...props}
    />
  )
}

export function MessageContent({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'max-w-full rounded-xl px-3 py-2.5 text-[13.5px] leading-[1.55] text-body',
        // Tracer's replies are plain prose with paragraph breaks — there is
        // no markdown renderer in this window, so newlines have to survive
        // as-is. `overflow-wrap: anywhere` keeps a pasted URL from forcing
        // the whole panel wider than the window.
        '[overflow-wrap:anywhere] whitespace-pre-wrap',
        'group-data-[from=assistant]:border group-data-[from=assistant]:border-line-strong',
        'group-data-[from=assistant]:bg-white',
        'group-data-[from=user]:bg-black/[0.035]',
        className
      )}
      {...props}
    />
  )
}

export function MessageAvatar({
  className,
  src,
  name,
  ...props
}: ComponentProps<'img'> & { name?: string }): JSX.Element {
  return (
    <img
      src={src}
      alt={name ?? ''}
      draggable={false}
      className={cn('size-6.5 rounded-full object-cover', className)}
      {...props}
    />
  )
}
