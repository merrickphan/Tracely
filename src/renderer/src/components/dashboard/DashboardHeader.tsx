import { Plus } from 'lucide-react'
import ProfileMenu from './ProfileMenu'

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function DashboardHeader({
  firstName,
  onStartNewSession,
  onOpenSettings,
  onOpenHelp
}: {
  firstName: string
  onStartNewSession: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
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
        <ProfileMenu firstName={firstName} onOpenSettings={onOpenSettings} onOpenHelp={onOpenHelp} />
      </div>
    </header>
  )
}
