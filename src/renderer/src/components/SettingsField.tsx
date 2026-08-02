import type { ReactNode } from 'react'

// The repeated Figma Settings pattern: a small-caps muted label above a
// bordered rounded input/select/textarea/static value. Used by every
// Settings panel (both the real, IPC-backed ones and the static
// placeholder pages).
export default function SettingsField({
  label,
  full,
  children
}: {
  label: string
  full?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <div className={`settings-field ${full ? 'settings-panel-grid-full' : ''}`.trim()}>
      <span className="settings-field-label">{label}</span>
      {children}
    </div>
  )
}
