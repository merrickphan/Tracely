import { useEffect, useRef, useState } from 'react'
import { ChevronDown, CircleHelp, Settings } from 'lucide-react'

export default function ProfileMenu({
  firstName,
  onOpenSettings,
  onOpenHelp
}: {
  firstName: string
  onOpenSettings: () => void
  onOpenHelp: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function choose(action: () => void): void {
    setOpen(false)
    action()
  }

  return (
    <div className="dashboard-profile" ref={menuRef}>
      <button
        type="button"
        className="dashboard-profile-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="dashboard-avatar" aria-hidden="true">
          {firstName.slice(0, 1).toUpperCase()}
        </span>
        <span className="dashboard-profile-name">{firstName}</span>
        <ChevronDown className={open ? 'is-open' : ''} size={16} />
      </button>

      {open ? (
        <div className="dashboard-profile-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => choose(onOpenSettings)}>
            <Settings size={16} />
            Settings
          </button>
          <button type="button" role="menuitem" onClick={() => choose(onOpenHelp)}>
            <CircleHelp size={16} />
            Help & Support
          </button>
        </div>
      ) : null}
    </div>
  )
}
