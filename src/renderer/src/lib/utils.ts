import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// The standard shadcn helper. Every component under components/ui/ takes a
// `className` prop and merges it through this, so a caller's utility always
// wins over the component's default rather than losing a specificity tie.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
