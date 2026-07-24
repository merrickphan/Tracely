export default function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <div className="spinner-row">
      <span className="spinner" />
      {label ? <span>{label}</span> : null}
    </div>
  )
}
