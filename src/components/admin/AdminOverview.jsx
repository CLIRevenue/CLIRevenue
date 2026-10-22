import { useState, useEffect, useCallback } from 'react'
import { fetchAdminOverview } from '../../lib/adminApi.js'

function StatCard({ label, value, sub, onClick, className }) {
  return (
    <div className={`adm-stat${className ? ' ' + className : ''}`} onClick={onClick}>
      <div className="adm-stat__label">{label}</div>
      <div className="adm-stat__value">{value ?? '—'}</div>
      {sub && <div className="adm-stat__sub">{sub}</div>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="adm-section">
      <div className="adm-section__title">{title}</div>
      {children}
    </div>
  )
}

function LifetimeViewsOverlay({ isOpen, onClose, pageViews, totalLifetimeViews, onCloseOverlay }) {
  if (!isOpen) return null

  return (
    <div className="adm-overlay" onClick={onCloseOverlay}>
      <div className="adm-overlay__panel" onClick={(e) => e.stopPropagation()}>
        <div className="adm-overlay__header">
          <h3 className="adm-overlay__title">Lifetime Views by Page</h3>
          <button className="adm-overlay__close" onClick={onCloseOverlay} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="adm-overlay__content">
          <div className="adm-overlay__summary">
            <div className="adm-overlay__summary-item">
              <span className="adm-overlay__summary-label">Total Lifetime Views</span>
              <span className="adm-overlay__summary-value">{totalLifetimeViews.toLocaleString()}</span>
            </div>
          </div>
          <div className="adm-overlay__table-wrap">
            <table className="adm-table adm-overlay__table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th className="adm-mono">Lifetime Views</th>
                  <th>First Seen</th>
                  <th>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {(pageViews || []).map((pv, idx) => (
                  <tr key={idx}>
                    <td className="adm-mono adm-truncate">{pv.path}</td>
                    <td className="adm-mono">{pv.view_count.toLocaleString()}</td>
                    <td className="adm-muted">{pv.first_seen_at ? new Date(pv.first_seen_at).toLocaleDateString() : '—'}</td>
                    <td className="adm-muted">{pv.last_seen_at ? new Date(pv.last_seen_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
                {(!pageViews || pageViews.length === 0) && (
                  <tr>
                    <td colSpan="4"><div className="adm-empty">No page views recorded yet.</div></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminOverview() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [overlayOpen, setOverlayOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminOverview()
      setData(result)
    } catch (e) {
      setError(e.status === 403 ? 'Access denied. Admin role required.' : e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div>
        <div className="adm-page-title">Operations</div>
        <h2 className="adm-page-heading">Overview</h2>
        <div className="adm-loading"><div className="adm-spinner" /> Loading…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div>
        <div className="adm-page-title">Operations</div>
        <h2 className="adm-page-heading">Overview</h2>
        <div className="adm-error">{error}</div>
      </div>
    )
  }
  if (!data) {
    return (
      <div>
        <div className="adm-page-title">Operations</div>
        <h2 className="adm-page-heading">Overview</h2>
        <div className="adm-empty"><div className="adm-empty__label">No data</div>Server returned no overview.</div>
      </div>
    )
  }

  const { campaigns, advertisers, developers, placements, events, system, pageViews, totalLifetimeViews } = data
  const systemOk = system && Object.entries(system).filter(([k]) => k !== 'checkedAt').every(([, s]) => s.ok)

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Operations</div>
          <div className="adm-op-header__title">Overview</div>
          <div className="adm-op-header__sub">Network command center / current operational state</div>
        </div>
        <div className="adm-op-header__right">
          <div className="adm-status-pill">
            <span className="adm-status-pill__dot" />
            {systemOk ? 'System Operational' : 'Degraded'}
          </div>
        </div>
      </div>

      <div className="adm-telemetry">
        <div className="adm-tele-card adm-tele-card--primary">
          <div className="adm-tele-card__label">Deliveries / 24H</div>
          <div className="adm-tele-card__value">{events?.serveCount ?? '—'}</div>
          <div className="adm-tele-card__context">Network activity</div>
        </div>
        <div className="adm-tele-card adm-tele-card--primary">
          <div className="adm-tele-card__label">Impressions / 24H</div>
          <div className="adm-tele-card__value">{events?.impressionCount ?? '—'}</div>
          <div className="adm-tele-card__context">Network activity</div>
        </div>
        <div className="adm-tele-card adm-tele-card--primary">
          <div className="adm-tele-card__label">Interactions / 24H</div>
          <div className="adm-tele-card__value">{events?.interactionCount ?? '—'}</div>
          <div className="adm-tele-card__context">Network activity</div>
        </div>
      </div>

      <div className="adm-telemetry__secondary">
        <div className="adm-tele-card">
          <div className="adm-tele-card__label">Active campaigns</div>
          <div className="adm-tele-card__value">{campaigns?.activeCount ?? '—'}</div>
          <div className="adm-tele-card__context">{campaigns?.totalCount ?? 0} total</div>
        </div>
        <div className="adm-tele-card">
          <div className="adm-tele-card__label">Advertisers</div>
          <div className="adm-tele-card__value">{advertisers?.totalCount ?? '—'}</div>
        </div>
        <div className="adm-tele-card">
          <div className="adm-tele-card__label">Developers</div>
          <div className="adm-tele-card__value">{developers?.totalCount ?? '—'}</div>
        </div>
        <div className="adm-tele-card">
          <div className="adm-tele-card__label">Live viewers</div>
          <div className="adm-tele-card__value">{data?.liveViewers ?? '—'}</div>
          <div className="adm-tele-card__context">current visitors</div>
        </div>
        <div className="adm-tele-card">
          <div className="adm-tele-card__label">Placements</div>
          <div className="adm-tele-card__value">{placements?.totalCount ?? '—'}</div>
          <div className="adm-tele-card__context">{placements?.enabledCount ?? 0} enabled</div>
        </div>
        <StatCard
          label="Lifetime views"
          value={data?.totalLifetimeViews?.toLocaleString() ?? '—'}
          sub="Landing page: clirevenue.in"
          onClick={() => setOverlayOpen(true)}
          className="adm-stat--clickable"
        />
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Recent campaigns</div>
          <div className="adm-section__subtitle">Campaign activity</div>
        </div>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Budget</th>
                <th>Impr.</th>
                <th>Clicks</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(campaigns?.recent ?? []).map(c => (
                <tr key={c.id}>
                  <td className="adm-mono adm-truncate">{c.name}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="adm-mono">${((c.budget_cents ?? 0) / 100).toFixed(2)}</td>
                  <td className="adm-mono adm-muted">{(c.impressions_count ?? 0).toLocaleString()}</td>
                  <td className="adm-mono adm-muted">{(c.clicks_count ?? 0).toLocaleString()}</td>
                  <td className="adm-muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
              {(!campaigns?.recent || campaigns.recent.length === 0) && (
                <tr><td colSpan={6}><div className="adm-empty">No campaigns yet.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">System status</div>
          <div className="adm-section__subtitle">Infrastructure health</div>
        </div>
        <div className="adm-system-strip">
          {system && Object.entries(system).filter(([k]) => k !== 'checkedAt').map(([key, s]) => (
            <div className="adm-system-chip" key={key}>
              <div className="adm-system-chip__label">{key}</div>
              <div className="adm-health">
                <span className={`adm-health__dot adm-health__dot--${s.ok ? 'ok' : 'fail'}`} />
                <span className="adm-system-chip__value">{s.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <LifetimeViewsOverlay
        isOpen={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        pageViews={pageViews}
        totalLifetimeViews={data.totalLifetimeViews ?? 0}
        onCloseOverlay={() => setOverlayOpen(false)}
      />
    </div>
  )
}

function StatusBadge({ status }) {
  const cls = `adm-badge adm-badge--${status ?? 'draft'}`
  return <span className={cls}>{status ?? 'unknown'}</span>
}

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}
