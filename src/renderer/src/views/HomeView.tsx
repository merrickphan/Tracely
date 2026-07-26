import { useEffect, useState } from 'react'
import type { LibraryItem, AppSettings } from '@shared/types'
import type { ScreenWatchStatus } from '@shared/ipc-contract'
import type { Tab } from '../App'
import { tracelyApi } from '../lib/api'

export default function HomeView({ onNavigate }: { onNavigate: (tab: Tab) => void }): JSX.Element {
  const [screenWatch, setScreenWatch] = useState<ScreenWatchStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [libraryItems, setLibraryItems] = useState<LibraryItem[] | null>(null)

  useEffect(() => {
    tracelyApi.getScreenWatchStatus().then(setScreenWatch)
    tracelyApi.getSettings().then(setSettings)
    tracelyApi.listLibrary().then((res) => setLibraryItems(res.items))
    return tracelyApi.onScreenWatchStatus(setScreenWatch)
  }, [])

  const allowedAppCount = settings?.screenWatchAllowedApps
    ? settings.screenWatchAllowedApps.split(',').map((s) => s.trim()).filter(Boolean).length
    : 0
  const recentItems = libraryItems?.slice(0, 3) ?? []

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

      <div className="home-stats-row">
        <button className="home-stat-card" onClick={() => onNavigate('settings')}>
          <span className="home-stat-label">Screen Watch</span>
          <span className={`home-stat-value ${screenWatch?.enabled ? 'home-stat-value-on' : ''}`}>
            {screenWatch?.enabled ? 'On' : 'Off'}
          </span>
          <span className="home-stat-sub">
            {allowedAppCount} app{allowedAppCount === 1 ? '' : 's'} allowed
          </span>
        </button>

        <button className="home-stat-card" onClick={() => onNavigate('library')}>
          <span className="home-stat-label">Library</span>
          <span className="home-stat-value">{libraryItems ? libraryItems.length : '—'}</span>
          <span className="home-stat-sub">saved source{libraryItems?.length === 1 ? '' : 's'}</span>
        </button>

        <button className="home-stat-card" onClick={() => onNavigate('settings')}>
          <span className="home-stat-label">Citation style</span>
          <span className="home-stat-value">{settings?.defaultCitationStyle ?? '—'}</span>
          <span className="home-stat-sub">default format</span>
        </button>
      </div>

      <div className="home-recent">
        <div className="home-recent-header">
          <h3>Recent in Library</h3>
          {recentItems.length > 0 ? (
            <button className="home-action-link home-action-link-muted" onClick={() => onNavigate('library')}>
              View all <span className="home-action-icon">↗</span>
            </button>
          ) : null}
        </div>
        {recentItems.length > 0 ? (
          <div className="home-recent-list">
            {recentItems.map((item) => (
              <button key={item.id} className="home-recent-item" onClick={() => onNavigate('library')}>
                <span className="home-recent-title">{item.source.title}</span>
                <span className="home-recent-meta">
                  {[item.source.venue, item.source.year].filter(Boolean).join(' · ') || 'Saved source'}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">
            Nothing saved yet — evidence you save from Analyze will show up here.
          </p>
        )}
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
