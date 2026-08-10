import { CircleHelp, Clock3, Eye, Home, Settings, type LucideIcon } from 'lucide-react'
import figmaLogo from '../../assets/figma-logo.png'

export type DashboardPage = 'home' | 'sessions' | 'new-session' | 'screen-watch' | 'settings' | 'help' | 'session'
export type SidebarPage = Exclude<DashboardPage, 'session' | 'new-session'>

interface NavItem {
  id: SidebarPage
  label: string
  icon: LucideIcon
}

const PRIMARY_NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'sessions', label: 'Sessions', icon: Clock3 },
  { id: 'screen-watch', label: 'Screen Watch', icon: Eye },
  { id: 'settings', label: 'Settings', icon: Settings }
]

const HELP_ITEM: NavItem = { id: 'help', label: 'Help & Support', icon: CircleHelp }

export default function Sidebar({
  activePage,
  onNavigate
}: {
  activePage: SidebarPage
  onNavigate: (page: SidebarPage) => void
}): JSX.Element {
  function item({ id, label, icon: Icon }: NavItem): JSX.Element {
    const active = activePage === id
    return (
      <button
        key={id}
        type="button"
        className={`dashboard-nav-item ${active ? 'is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        onClick={() => onNavigate(id)}
      >
        <Icon size={19} strokeWidth={1.8} />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <aside className="dashboard-sidebar">
      <div className="dashboard-sidebar-brand">
        <img src={figmaLogo} className="dashboard-sidebar-logo" alt="" />
        <span className="dashboard-wordmark">Tracely</span>
      </div>

      <nav className="dashboard-nav" aria-label="Primary navigation">
        {PRIMARY_NAV.map(item)}
      </nav>

      <nav className="dashboard-nav dashboard-nav-bottom" aria-label="Support navigation">
        {item(HELP_ITEM)}
      </nav>
    </aside>
  )
}
