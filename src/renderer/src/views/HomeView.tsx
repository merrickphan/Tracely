import type { Tab } from '../App'

export default function HomeView({ onNavigate }: { onNavigate: (tab: Tab) => void }): JSX.Element {
  return (
    <div className="home-view">
      <div className="home-hero">
        <div className="home-copy">
          <h2>Tracely is up and running.</h2>
          <p className="muted">
            Paste text into Analyze to check it, or turn on Screen Watch to catch claims as you
            write in Word, your browser, or wherever you allow it.
          </p>
        </div>

        <div className="home-preview">
          <div className="home-preview-card">
            <p className="home-preview-meta">Draft</p>
            <p className="home-preview-text">
              Studies show that <span className="home-preview-underline">regular napping</span>{' '}
              improves memory retention in adults.
            </p>
            <div className="home-preview-badge">1</div>
          </div>
        </div>
      </div>

      <div className="home-actions-row">
        <div className="home-actions-left">
          <button className="home-action-link" onClick={() => onNavigate('analyze')}>
            <span className="home-action-icon">+</span> New Analysis
          </button>
          <button className="home-action-link" onClick={() => onNavigate('settings')}>
            <span className="home-action-icon">⚙</span> Settings
          </button>
        </div>
        <button className="home-action-link home-action-link-muted" onClick={() => onNavigate('settings')}>
          You choose where Screen Watch works <span className="home-action-icon">↗</span>
        </button>
      </div>
    </div>
  )
}
