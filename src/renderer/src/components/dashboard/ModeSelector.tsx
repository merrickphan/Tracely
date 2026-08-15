import { MessageSquareText, Search } from 'lucide-react'

export type DashboardMode = 'evidence' | 'critique'

const MODES: Array<{
  id: DashboardMode
  label: string
  description: string
  icon: typeof Search
}> = [
  {
    id: 'evidence',
    label: 'Find Evidence',
    description: 'Search for credible sources',
    icon: Search
  },
  {
    id: 'critique',
    label: 'Critique Argument',
    description: 'Review reasoning and wording',
    icon: MessageSquareText
  }
]

export default function ModeSelector({
  value,
  onChange
}: {
  value: DashboardMode
  onChange: (mode: DashboardMode) => void
}): JSX.Element {
  return (
    <fieldset className="dashboard-mode-selector">
      <legend className="dashboard-visually-hidden">Analysis mode</legend>
      {MODES.map(({ id, label, description, icon: Icon }) => (
        <label key={id} className={`dashboard-mode ${value === id ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name="analysis-mode"
            value={id}
            checked={value === id}
            onChange={() => onChange(id)}
          />
          <span className="dashboard-mode-indicator" aria-hidden="true" />
          <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
          <span>
            <strong>{label}</strong>
            <small>{description}</small>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
