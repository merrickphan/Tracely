import { ShieldCheck, X } from 'lucide-react'
import { tracelyApi } from '../../lib/api'

export default function DesktopTitleBar(): JSX.Element {
  return (
    <header className="dashboard-titlebar">
      <div className="dashboard-titlebar-brand" aria-label="Tracely">
        <span className="dashboard-titlebar-mark" aria-hidden="true">
          <ShieldCheck size={14} strokeWidth={2.2} />
        </span>
        <span>Tracely</span>
      </div>
      <button
        type="button"
        className="dashboard-window-action"
        aria-label="Close Tracely"
        title="Close"
        onClick={() => void tracelyApi.hideWindow('main')}
      >
        <X size={16} />
      </button>
    </header>
  )
}
