import type { TextareaHTMLAttributes } from 'react'

export type TextAreaSize = 'sm' | 'md' | 'lg'

export default function TextArea({
  size = 'md',
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: TextAreaSize }): JSX.Element {
  return <textarea {...props} className={`textarea textarea-${size} ${className ?? ''}`.trim()} />
}
