// Small stroke-style line icons matching the Figma design's thin-line icon
// set. Hand-rolled inline SVG (same convention as WindowControls.tsx) rather
// than an icon library dependency, since none exists in this project.
interface IconProps {
  size?: number
  className?: string
}

function base(size: number): { width: number; height: number; viewBox: string } {
  return { width: size, height: size, viewBox: '0 0 24 24' }
}

export function UserIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" strokeLinecap="round" />
    </svg>
  )
}

export function AccountIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M3.5 9.5h17" strokeLinecap="round" />
    </svg>
  )
}

export function BellIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M6 10.5a6 6 0 0112 0c0 4 1.4 5.4 1.4 5.4H4.6S6 14.5 6 10.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 19a2 2 0 004 0" strokeLinecap="round" />
    </svg>
  )
}

export function ShieldIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M12 3.5l7 2.6v5.4c0 4.6-3 8-7 9.4-4-1.4-7-4.8-7-9.4V6.1l7-2.6z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SunIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function LinkIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M9.5 14.5l5-5M8 10l-2 2a3.5 3.5 0 004.9 4.9l2-2M16 14l2-2a3.5 3.5 0 00-4.9-4.9l-2 2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CardIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" />
      <path d="M3 9.5h18" />
      <path d="M6 15h4" strokeLinecap="round" />
    </svg>
  )
}

export function SignOutIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 20H5.5A1.5 1.5 0 014 18.5v-13A1.5 1.5 0 015.5 4H9" strokeLinecap="round" />
      <path d="M13 16l4-4-4-4M17 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function BackIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CloseIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

export function CogIcon({ size = 20, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M17.7 17.7l-1.4-1.4M7.7 7.7L6.3 6.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function PlusIcon({ size = 20, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
    </svg>
  )
}

export function BrowserTabIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
    </svg>
  )
}

export function DocumentIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M7 3.5h7l4 4V20a1 1 0 01-1 1H7a1 1 0 01-1-1V4.5a1 1 0 011-1z" strokeLinejoin="round" />
      <path d="M14 3.5V8h4" strokeLinejoin="round" />
    </svg>
  )
}

export function ClipboardIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function SlidersIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 7h14M5 12h14M5 17h14" strokeLinecap="round" />
      <circle cx="9" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10" cy="17" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function EyeIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  )
}

export function LockIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 018 0v3" />
    </svg>
  )
}

export function CheckCircleIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className} fill="none" stroke="#fff" strokeWidth="2">
      <path d="M6 12.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
