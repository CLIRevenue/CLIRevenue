import { useCallback, useEffect, useState } from 'react'
import { fetchAdminOperations } from '../../lib/adminApi.js'
import {
  CapabilityLedger, EmptyState, ErrorState, GovBadge, LoadingState, PageHeader,
  Section, Unavailable, errorText, fmtDateFull, shortId,
} from './AdminGovernanceUi.jsx'
import './AdminGovernance.css'

const SCOPE_LABEL = {
  total: 'all-time count',
  window: 'last 24h window',
  unavailable: 'no data source',
}

/**
 * A card is either a real aggregate with a named source, or it is rendered
 * as explicitly unavailable. There is no third option, and in particular no
 * card is filled with a plausible-looking default.
 */
function MetricCard({ card }) {
  if (!card.available) {
    return (
      <div className="adm-ops-card adm-ops-card--unavailable">
        <div className="adm-ops-card__label">{card.label}</div>
        <div className="adm-ops-card__value adm-ops-card__value--none">Not instrumented</div>
        <div className="adm-ops-card__detail">{card.detail}</div>
        <div className="adm-ops-card__source">no backend source</div>
      </div>
    )
  }
  return (
    <div className="adm-ops-card">
      <div className="adm-ops-card__label">{card.label}</div>
      <div className="adm-ops-card__value">
        {card.value}
        {card.unit ? <span className="adm-ops-card__unit">{card.unit}</span> : null}
      </div>
      <div className="adm-ops-card__detail">{card.detail}</div>
      <div className="adm-ops-card__source">
        <span className="adm-dim">{SCOPE_LABEL[card.scope] || card.scope}</span>
        {card.source ? <span className="adm-mono adm-truncate"> · {card.source}</span> : null}
      </div>
    </div>
  )
}

export default function AdminOperations() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await fetchAdminOperations())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingState breadcrumb="Operations" title="Platform Operations" />
  if (error) return <ErrorState breadcrumb="Operations" title="Platform Operations" error={error} />
  if (!data) {
    return (
      <EmptyState
        breadcrumb="Operations"
        title="Platform Operations"
        label="No data"
        body="The server returned no operations payload."
      />
    )
  }

  const cards = Array.isArray(data.cards) ? data.cards : []
  const live = cards.filter((c) => c.available)
  const dead = cards.filter((c) => !c.available)
  const capabilities = data.capabilities || {}
  const primary = live.slice(0, 4)
  const secondary = live.slice(4)

  return (
    <>
      <PageHeader
        breadcrumb="Operations / Production"
        title="Platform Operations"
        sub="Internal governance telemetry. Every figure below is a live aggregate with a named source; anything without a source is shown as unmeasured."
        status={`generated ${fmtDateFull(data.generatedAt)}`}
      />

      <Section title="Live aggregates" subtitle={capabilities.note}>
        <div className="adm-ops-grid">
          {primary.map((c) => <MetricCard key={c.key} card={c} />)}
        </div>
        {secondary.length > 0 && (
          <div className="adm-ops-grid adm-ops-grid--secondary">
            {secondary.map((c) => <MetricCard key={c.key} card={c} />)}
          </div>
        )}
      </Section>

      <Section title="Operations protocol" subtitle="Actions an operator could take from this screen.">
        <Unavailable label="No operations action endpoints" reason={capabilities.actions?.reason}>
          Ping a point of presence, freeze a token, restart an edge worker, or drain a queue — none of these have
          a server-side implementation. The console issues no synthetic success response for them.
        </Unavailable>
        {capabilities.batchOperations && (
          <Unavailable label="No batch operations" reason={capabilities.batchOperations.reason}>
            There is no bulk endpoint. Every write this deployment exposes is a single-row operation.
          </Unavailable>
        )}
      </Section>

      {dead.length > 0 && (
        <Section
          title="Not instrumented"
          subtitle="Card slots the design drew for this screen, kept visible so the gap is explicit rather than silently filled."
        >
          <div className="adm-ops-grid adm-ops-grid--secondary">
            {dead.map((c) => <MetricCard key={c.key} card={c} />)}
          </div>
        </Section>
      )}

      <Section
        title="Recent delivery events"
        subtitle="Window: last 24 hours, from the serve log."
      >
        {data.recentEvents && data.recentEvents.length > 0 ? (
          <div className="adm-gov-stream">
            {data.recentEvents.map((e) => (
              <div className="adm-event-row" key={e.id || `${e.servedAt}-${e.requestId}`}>
                <div className="adm-event-kind">
                  <GovBadge tone="enabled">{e.kind || 'serve'}</GovBadge>
                </div>
                <div className="adm-event-body">
                  <div className="adm-event-meta">
                    <span className="adm-mono">{fmtDateFull(e.servedAt || e.timestamp)}</span>
                    {e.requestId ? <span className="adm-mono">· req {shortId(e.requestId)}</span> : null}
                  </div>
                  <div className="adm-event-meta adm-mono adm-truncate">
                    campaign={shortId(e.campaignId)}  publisher={shortId(e.publisherId)}  placement={shortId(e.placementKey || e.placementId)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="adm-empty">
            <div className="adm-empty__label">No delivery events in 24 hours</div>
            Nothing was served, impressed, or clicked in the window this endpoint reads.
          </div>
        )}
      </Section>

      <CapabilityLedger
        capabilities={capabilities}
        omit={['note', 'actions', 'batchOperations']}
        labels={{ governanceLog: 'Governance log provenance' }}
        title="Governance log"
        subtitle="Whether admin actions are recorded, and whether those records carry tamper evidence."
      />

      <p className="adm-note">
        Read-only snapshot assembled from existing admin endpoints plus moderation and audit aggregates. No
        figure on this page is cached, interpolated, or carried over from a previous response.
      </p>
    </>
  )
}
