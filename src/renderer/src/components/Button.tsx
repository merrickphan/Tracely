import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'
}

export default function Button({ variant = 'secondary', className, ...rest }: ButtonProps): JSX.Element {
  return <button className={`btn btn-${variant} ${className ?? ''}`.trim()} {...rest} />
}
