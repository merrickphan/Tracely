import { forwardRef, type TextareaHTMLAttributes } from 'react'

export type TextAreaSize = 'sm' | 'md' | 'lg'

const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: TextAreaSize }
>(function TextArea({ size = 'md', className, ...props }, ref): JSX.Element {
  return <textarea ref={ref} {...props} className={`textarea textarea-${size} ${className ?? ''}`.trim()} />
})

export default TextArea
