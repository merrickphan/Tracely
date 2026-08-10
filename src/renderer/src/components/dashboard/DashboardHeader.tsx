import { Plus } from 'lucide-react'
import ProfileMenu from './ProfileMenu'

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function DashboardHeader({
  firstName,
  avatarUrl,
  onStartNewSession,
  onOpenSettings,
  onOpenHelp,
  onSignOut,
  onCloseWindow
}: {
  firstName: string
  avatarUrl?: string | null
  onStartNewSession: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  onSignOut: () => void
  onCloseWindow: () => void
}): JSX.Element {
  const greeting = greetingForHour(new Date().getHours())

  return (
    <header className="dashboard-header">
      <div>
        <h1>
          {greeting}, {firstName}
        </h1>
        <p>What would you like to verify today?</p>
      </div>
      <div className="dashboard-header-actions">
        <button type="button" className="dashboard-new-session" onClick={onStartNewSession}>
          <Plus size={17} strokeWidth={2.2} />
          Start New Session
        </button>
        <ProfileMenu
          firstName={firstName}
          avatarUrl={avatarUrl}
          onOpenSettings={onOpenSettings}
          onOpenHelp={onOpenHelp}
          onSignOut={onSignOut}
          onCloseWindow={onCloseWindow}
        />
      </div>
    </header>
  )
}
