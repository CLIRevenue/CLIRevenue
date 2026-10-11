import { useCallback, useEffect, useState } from 'react'
import { fetchAdminAudit, fetchAdminHealth } from '../../lib/adminApi.js'
import {
  CapabilityLedger, EmptyState, ErrorState, GovBadge, LoadingState, PageHeader,
  Section, Unavailable, errorText, fmtDateFull, shortId,
} from './AdminGovernanceUi.jsx'
import './AdminGovernance.css'

/**
 * `ok === null` is the whole point of this screen. It means "no signal
 * exists" — distinct from `false`, which means "measured and failing".
 * The dot class is driven off `kind`, never off a falsy `ok`.
 */
function SignalChip({ signal }) {
  const unverified = signal.kind === 'unverified'
  const tone = unverified ? 'unknown' : signal.ok === true ? 'ok' : signal.ok === false ? 'fail' : 'unknown'
  const verdict = unverified ? 'not instrumented' : signal.ok === true ? 'healthy' : signal.ok === false ? 'failing' : 'unavailable'
  return (
    <div className={`adm-signal adm-signal--${unverified ? 'unverified' : 'measured'}`}>
      <div className="adm-signal__label">
        <span className={`adm-health__dot adm-health__dot--${tone}`} />
        {signal.label}
      </div>
      <div className="adm-signal__value">
        {verdict}
        {typeof signal.durationMs === 'number' && signal.durationMs >= 0 && (
          <span className="adm-signal__ms"> {signal.durationMs} ms</span>
        )}
      </div>
      <div className="adm-signal__detail">{signal.detail}</div>
      <div className="adm-signal__source adm-mono">{signal.source}</div>
    </div>
  )
}

function GovernanceRow({ action }) {
  const enabled = action.action === 'SERVING_GATE_ENABLED'
  return (
    <div className="adm-event-row">
      <div className="adm-event-kind">
        <GovBadge tone={enabled ? 'enabled' : 'paused'}>
          {enabled ? 'gate opened' : 'gate closed'}
        </GovBadge>
      </div>
      <div className="adm-event-body">
        <div className="adm-event-meta">
          <span className="adm-mono">{action.actorEmail || shortId(action.actorProfileId)}</span>
          <span className="adm-dim">→</span>
          <span className="adm-mono">{shortId(action.subjectId)}</span>
          <span className="adm-dim">·</span>
          <span className="adm-mono">{fmtDateFull(action.createdAt)}</span>
        </div>
        <div className="adm-mod__reason">{action.reason}</div>
        <div className="adm-event-meta">
          <span className="adm-dim">can_run_campaigns:</span>
          <span className="adm-mono">{String(action.previousValue)}</span>
          <span className="adm-dim">→</span>
          <span className="adm-mono">{String(action.newValue)}</span>
        </div>
      </div>
    </div>
  )
}

function TelemetryRow({ event }) {
  const state = event.validationState
  return (
    <div className="adm-event-row">
      <div className="adm-event-kind">
        <GovBadge tone={state === 'accepted' ? 'active' : state === 'quarantined' ? 'paused' : 'archived'}>
          {state}
        </GovBadge>
      </div>
      <div className="adm-event-body">
        <div className="adm-mono adm-event-type">{event.eventType}</div>
        <div className="adm-event-meta">
          <span className="adm-mono">{fmtDateFull(event.recordedAt)}</span>
          <span className="adm-dim">· seq</span>
          <span className="adm-mono">{event.sequence}</span>
          <span className="adm-dim">· risk</span>
          <span className="adm-mono">{event.riskScore}</span>
          {Array.isArray(event.riskFlags) && event.riskFlags.length > 0 && (
            <span className="adm-dim">· {event.riskFlags.join(', ')}</span>
          )}
        </div>
        <div className="adm-event-meta adm-mono adm-truncate">
          {[
            ['session', shortId(event.sessionId)],
            ['placement', shortId(event.placementId)],
            ['campaign', shortId(event.campaignId)],
            ['creative', shortId(event.creativeId)],
            ['publisher', shortId(event.publisherId)],
          ].map(([k, v]) => `${k}=${v}`).join('  ')}
        </div>
      </div>
    </div>
  )
}

export default function AdminHealth() {
  const [health, setHealth] = useState(null)
  const [audit, setAudit] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [auditError, setAuditError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setAuditError('')
    const [h, a] = await Promise.allSettled([fetchAdminHealth(), fetchAdminAudit()])
    if (h.status === 'fulfilled') setHealth(h.value)
    else setError(errorText(h.reason))
    if (a.status === 'fulfilled') setAudit(a.value)
    else setAuditError(errorText(a.reason))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingState breadcrumb="Operations / Governance" title="System Health & Audit" />
  if (error) return <ErrorState breadcrumb="Operations / Governance" title="System Health & Audit" error={error} />
  if (!health) {
    return (
      <EmptyState
        breadcrumb="Operations / Governance"
        title="System Health & Audit"
        label="No data"
        body="The server returned no health payload."
      />
    )
  }

  const summary = health.summary || {}
  const capabilities = health.capabilities || {}
  const measured = (health.signals || []).filter((s) => s.kind === 'measured')
  const unverified = (health.signals || []).filter((s) => s.kind === 'unverified')

  return (
    <>
      <PageHeader
        breadcrumb="Operations / Production"
        title="System Health & Audit"
        sub={`${summary.measuredCount ?? 0} measured signals · ${summary.measuredFailures ?? 0} failing · ${summary.unverifiedCount ?? 0} not instrumented · checked ${fmtDateFull(health.checkedAt)}`}
        status={summary.state === 'degraded' ? 'measured signal failing' : 'measured signals ok'}
        tone={summary.state === 'degraded' ? 'amber' : ''}
      />

      <Unavailable
        label="No node mesh, no uptime history, no Merkle proofs"
        reason={capabilities.nodeMesh?.reason || capabilities.merkleProof?.reason}
      >
        Region RTT, dropped packets, edge latency percentiles, state proofs, and signed log entries have no
        backing table, metric stream, or signing service anywhere in this deployment. They are not approximated
        here.
      </Unavailable>

      <Section
        title="Measured signals"
        subtitle="Each chip is a live query the server ran and timed. A failing chip here means a real query failed."
      >
        <div className="adm-signal-grid">
          {measured.map((s) => <SignalChip key={s.key} signal={s} />)}
        </div>
      </Section>

      {unverified.length > 0 && (
        <Section
          title="Not instrumented"
          subtitle="Shown so the absence is visible. These are not passing checks — they are checks that do not exist."
        >
          <div className="adm-signal-grid">
            {unverified.map((s) => <SignalChip key={s.key} signal={s} />)}
          </div>
        </Section>
      )}

      <CapabilityLedger
        capabilities={capabilities}
        omit={['availabilityWindow']}
        labels={{
          merkleProof: 'Merkle state proof',
          nodeMesh: 'Edge node mesh',
          regionalLatency: 'Per-region latency',
          droppedPackets: 'Dropped packet counters',
          piiScrubbing: 'Server-side PII scrubbing',
          liveStream: 'Live websocket stream',
          signatures: 'Cryptographic log signatures',
        }}
        title="Health capabilities"
        subtitle="The design for this screen drew a Merkle proof, a converged node mesh, and signed audit entries. None of those subsystems exist."
      />

      {auditError && <div className="adm-error">Audit trail unavailable: {auditError}</div>}

      {audit && (
        <>
          <Section
            title="Governance action log"
            subtitle={
              audit.governance?.available
                ? `${audit.governance.windowSize ?? 0} rows in window. Append-only: the table grants INSERT and SELECT to the service role and nothing else.`
                : 'Not available.'
            }
          >
            {audit.governance?.available ? (
              audit.governance.actions?.length > 0 ? (
                <div className="adm-gov-stream">{audit.governance.actions.map((a) => <GovernanceRow key={a.id} action={a} />)}</div>
              ) : (
                <div className="adm-empty">
                  <div className="adm-empty__label">No governance actions recorded</div>
                  The table is empty. No admin has changed the serving gate yet.
                </div>
              )
            ) : (
              <Unavailable label="Governance log unavailable" reason={audit.governance?.reason}>
                Migration <span className="adm-mono">000024_admin_governance_audit.sql</span> has not been
                applied to this database, so there is no table to read. The screen reports that rather than
                pretending the log is empty.
              </Unavailable>
            )}
          </Section>

          <Section
            title="Delivery telemetry"
            subtitle={
              audit.telemetry?.totals?.available
                ? `Most recent ${audit.telemetry.window?.size ?? 0} of ${audit.telemetry.totals.total ?? 0} recorded events. This is ad-delivery telemetry, not an admin action audit.`
                : 'Totals unavailable.'
            }
          >
            {audit.telemetry?.totals?.available === false ? (
              <Unavailable label="Telemetry totals unavailable" reason={audit.telemetry.totals.reason}>
                The telemetry table could not be counted.
              </Unavailable>
            ) : (
              <>
                <div className="adm-telemetry adm-telemetry__secondary">
                  <div className="adm-tele-card"><div className="adm-tele-card__label">Recorded events</div><div className="adm-tele-card__value">{audit.telemetry.totals.total ?? '—'}</div></div>
                  <div className="adm-tele-card"><div className="adm-tele-card__label">Accepted</div><div className="adm-tele-card__value">{audit.telemetry.totals.accepted ?? '—'}</div></div>
                  <div className="adm-tele-card"><div className="adm-tele-card__label">Quarantined</div><div className="adm-tele-card__value">{audit.telemetry.totals.quarantined ?? '—'}</div></div>
                  <div className="adm-tele-card"><div className="adm-tele-card__label">Rejected</div><div className="adm-tele-card__value">{audit.telemetry.totals.rejected ?? '—'}</div></div>
                </div>
                {audit.telemetry.window?.truncated && (
                  <p className="adm-note adm-note--lead">
                    The event window is capped at {audit.capabilities?.rowLimit ?? '—'} rows. There is no
                    pagination parameter, so older events are not retrievable through this endpoint.
                  </p>
                )}
                {audit.telemetry.events?.length > 0 ? (
                  <div className="adm-gov-stream">{audit.telemetry.events.map((e) => <TelemetryRow key={e.id} event={e} />)}</div>
                ) : (
                  <div className="adm-empty">
                    <div className="adm-empty__label">No telemetry events</div>
                    Nothing has been recorded in the window this endpoint reads.
                  </div>
                )}
              </>
            )}
          </Section>

          <CapabilityLedger
            capabilities={audit.capabilities}
            omit={['rowLimit', 'scope']}
            labels={{
              adminActionAudit: 'Admin action audit log',
              tamperEvidence: 'Tamper evidence',
              signatures: 'Entry signatures',
              metadataInspection: 'Raw event metadata',
            }}
            title="Audit capabilities"
            subtitle="An append-only table is not a tamper-evident one. These rows make the difference explicit."
          />
        </>
      )}

      <p className="adm-note">
        Read-only, service-role scope. <span className="adm-mono">telemetry_events</span> has RLS enabled with
        zero policies, so this data is unreachable from any client session — including the browser.
      </p>
    </>
  )
}
