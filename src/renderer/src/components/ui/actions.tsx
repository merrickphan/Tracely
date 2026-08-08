import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

// The registry's `Action` wraps each button in a Radix Tooltip. That is
// dropped here in favour of the native `title` attribute: adding
// @radix-ui/react-tooltip (plus a TooltipProvider at the window root) to
// render five one-word labels in a 380px-wide frameless popup is not worth
// the dependency, and a native tooltip cannot be clipped by the window edge
// the way a portal-less Radix one can. `label` still drives the accessible
// name, so the API is unchanged for callers.

export function Actions({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return <div className={cn('flex items-center gap-0.5', className)} {...props} />
}

export type ActionProps = ComponentProps<'button'> & {
  label: string
  /** Renders the button in its "on" state — used for Like/Dislike. */
  active?: boolean
}

export function Action({
  className,
  label,
  active = false,
  children,
  ...props
}: ActionProps): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted',
        'transition-colors hover:bg-black/5 hover:text-ink',
        'disabled:pointer-events-none disabled:opacity-40',
        active && 'text-accent',
        className
      )}
      {...props}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  )
}
