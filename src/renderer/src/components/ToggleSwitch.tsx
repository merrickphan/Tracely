interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export default function ToggleSwitch({ checked, onChange, label, disabled }: ToggleSwitchProps): JSX.Element {
  return (
    <label className={`toggle-switch ${disabled ? 'toggle-switch-disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="toggle-switch-input"
      />
      <span className="toggle-switch-track">
        <span className="toggle-switch-thumb" />
      </span>
      {label ? <span className="toggle-switch-label">{label}</span> : null}
    </label>
  )
}
