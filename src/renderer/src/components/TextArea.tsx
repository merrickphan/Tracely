import type { TextareaHTMLAttributes } from 'react'

export default function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea {...props} className={`textarea ${props.className ?? ''}`.trim()} />
}
