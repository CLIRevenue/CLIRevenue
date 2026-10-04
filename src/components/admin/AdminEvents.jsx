import { useState, useEffect, useCallback } from 'react'
import { fetchAdminEvents } from '../../lib/adminApi.js'

const KIND_LABEL = {
  impression: 'IMPRESSION',
  click: 'CLICK',
  conversion: 'CONVERSION',
}

export default function AdminEvents() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await fetchAdminEvents()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="adm-loading"><div className="adm-spinner" /> Loading events…</div>
  if (error)   return <div className="adm-error">{error}</div>
  if (!data)   return <div className="adm-empty">No event data.</div>

  const { recentServes = [], recentImpressions = [], recentInteractions = [], serveCount, impressionCount, interactionCount } = data

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Telemetry</div>
          <div className="adm-op-header__title">Events</div>
          <div className="adm-op-header__sub">Network telemetry</div>
        </div>
      </div>

      <div className="adm-telemetry">
        <div className="adm-tele-card adm-tele-card--primary">
          <div className="adm-tele-card__label">Deliveries / 24H</div>
          <div className="adm-tele-card__value">{serveCount ?? 0}</div>
          <div className="adm-tele-card__context">Network activity</div>
        </div>
        <div className="adm-tele-card adm-tele-card--primary">
          <div className="adm-tele-card__label">Impressions / 24H</div>
          <div className="adm-tele-card__value">{impressionCount ?? 0}</div>
          <div className="adm-tele-card__context">Network activity</div>
        </div>
        <div className="adm-tele-card adm-tele-card--primary">
          <div className="adm-tele-card__label">Interactions / 24H</div>
          <div className="adm-tele-card__value">{interactionCount ?? 0}</div>
          <div className="adm-tele-card__context">Network activity</div>
        </div>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Recent serves</div>
          <div className="adm-section__subtitle">Delivery pipeline</div>
        </div>
        <div className="adm-table-wrap">
          <div className="adm-table-header">
            <span className="adm-table-title">Recent serves ({recentServes.length})</span>
          </div>
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Campaign</th>
                  <th>Publisher</th>
                  <th>Placement key</th>
                  <th>Served at</th>
                  <th>Impression</th>
                  <th>Click</th>
                  <th>Conversion</th>
                </tr>
              </thead>
              <tbody>
                {recentServes.map(s => (
                  <tr key={s.id}>
                    <td className="adm-mono adm-dim adm-truncate">{s.request_id}</td>
                    <td className="adm-mono adm-dim adm-truncate">{s.campaign_id}</td>
                    <td className="adm-mono adm-dim adm-truncate">{s.publisher_id}</td>
                    <td className="adm-mono">{s.placement_key}</td>
                    <td className="adm-muted">{fmtDate(s.served_at)}</td>
                    <td><HealthDot ok={!!s.impression_recorded_at} /></td>
                    <td><HealthDot ok={!!s.click_recorded_at} /></td>
                    <td><HealthDot ok={!!s.conversion_recorded_at} /></td>
                  </tr>
                ))}
                {recentServes.length === 0 && <tr><td colSpan={8}><div className="adm-empty">No serve records found.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Recent impressions</div>
          <div className="adm-section__subtitle">Impression stream</div>
        </div>
        <div className="adm-table-wrap">
          <div className="adm-table-header">
            <span className="adm-table-title">Recent impressions ({recentImpressions.length})</span>
          </div>
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Campaign</th>
                  <th>Session</th>
                  <th>Integration</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {recentImpressions.map(i => (
                  <tr key={i.id}>
                    <td className="adm-mono adm-dim adm-truncate">{i.id}</td>
                    <td className="adm-mono adm-dim adm-truncate">{i.campaign_id}</td>
                    <td className="adm-mono adm-dim adm-truncate">{i.session_id}</td>
                    <td className="adm-muted">{i.cli_integration}</td>
                    <td className="adm-muted">{fmtDate(i.timestamp)}</td>
                  </tr>
                ))}
                {recentImpressions.length === 0 && <tr><td colSpan={5}><div className="adm-empty">No impressions found.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Recent interactions</div>
          <div className="adm-section__subtitle">Interaction stream</div>
        </div>
        <div className="adm-table-wrap">
          <div className="adm-table-header">
            <span className="adm-table-title">Recent interactions ({recentInteractions.length})</span>
          </div>
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Campaign</th>
                  <th>Session</th>
                  <th>Kind</th>
                  <th>Integration</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {recentInteractions.map(i => (
                  <tr key={i.id}>
                    <td className="adm-mono adm-dim adm-truncate">{i.id}</td>
                    <td className="adm-mono adm-dim adm-truncate">{i.campaign_id}</td>
                    <td className="adm-mono adm-dim adm-truncate">{i.session_id}</td>
                    <td><span className="adm-event-kind">{i.kind}</span></td>
                    <td className="adm-muted">{i.cli_integration}</td>
                    <td className="adm-muted">{fmtDate(i.timestamp)}</td>
                  </tr>
                ))}
                {recentInteractions.length === 0 && <tr><td colSpan={6}><div className="adm-empty">No interactions found.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function HealthDot({ ok }) {
  return <span className={`adm-health__dot adm-health__dot--${ok ? 'ok' : 'fail'}`} title={ok ? 'recorded' : 'not recorded'} />
}
function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}
