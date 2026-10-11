import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAdminModeration } from '../../lib/adminApi.js'
import {
  CapabilityLedger, Cell, EmptyState, ErrorState, GovBadge, LoadingState, PageHeader,
  Pill, Section, Stdout, Unavailable, errorText, fmtBytes, fmtCents, fmtDateFull, shortId,
} from './AdminGovernanceUi.jsx'
import './AdminGovernance.css'

const QUEUE_FILTERS = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'all', label: 'All campaigns' },
  { key: 'ready', label: 'Ready to activate' },
  { key: 'live', label: 'Live' },
  { key: 'archived', label: 'Archived' },
]

const REVIEW_TONE = {
  live: 'active',
  archived: 'archived',
  ready_to_activate: 'enabled',
  creative_missing: 'draft',
  awaiting_upload: 'paused',
  awaiting_validation: 'paused',
  creative_failed: 'paused',
  creative_revoked: 'paused',
  unknown: 'draft',
}

function reviewLabel(state) {
  return String(state || 'unknown').replace(/_/g, ' ')
}

function matchesQueue(item, filter) {
  if (filter === 'all') return true
  if (filter === 'attention') return item.needsAttention === true
  if (filter === 'ready') return item.reviewState === 'ready_to_activate'
  return item.reviewState === filter
}

function Blockers({ item }) {
  if (item.blockersAvailable === false) {
    return (
      <Unavailable label="Activation blockers unavailable" reason="The campaign_activation_blockers() function did not respond.">
        The server could not evaluate why this campaign might be blocked. That is different from knowing it is
        unblocked — nothing here should be read as approval.
      </Unavailable>
    )
  }
  if (!item.blockers || item.blockers.length === 0) {
    return (
      <div className="adm-mod__clear">
        No activation blockers. <span className="adm-mono">campaign_activation_blockers()</span> returned an empty array.
      </div>
    )
  }
  return (
    <ul className="adm-mod__blockers">
      {item.blockers.map((b) => (
        <li className="adm-blocker" key={b.code}>
          <span className="adm-blocker__code">{b.code}</span>
          <span className="adm-blocker__msg">{b.message}</span>
        </li>
      ))}
    </ul>
  )
}

function ReviewCard({ item }) {
  const creative = item.creative
  const spendMilli = Number(item.spendMilliCents || 0)
  return (
    <article className="adm-mod">
      <header className="adm-mod__head">
        <div className="adm-mod__id">
          <span className="adm-mono adm-dim">{shortId(item.campaignId)}</span>
          <h3 className="adm-mod__name">{item.name || 'Untitled campaign'}</h3>
        </div>
        <div className="adm-mod__badges">
          <GovBadge tone={REVIEW_TONE[item.reviewState] || 'draft'}>{reviewLabel(item.reviewState)}</GovBadge>
          <GovBadge tone="paused">{item.status}</GovBadge>
        </div>
      </header>

      <Stdout
        lines={[
          { key: 'headline', value: item.headline || '(none)' },
          { key: 'cta', value: item.cta || '(none)' },
          { key: 'audience', value: item.audienceId || '(none)' },
          { key: 'landing_url', value: item.landingUrl || '(none)' },
          {
            key: 'advertiser',
            value: item.advertiser
              ? `${item.advertiser.companyName || 'Unnamed'} — serving gate ${item.advertiser.canRunCampaigns ? 'open' : 'CLOSED'}`
              : 'No advertiser record',
          },
          { key: 'window', value: `${fmtDateFull(item.startsAt)} → ${item.endsAt ? fmtDateFull(item.endsAt) : 'open-ended'}` },
        ]}
      />

      <div className="adm-gov-kv">
        <Cell label="Budget" value={fmtCents(item.budgetCents)} />
        <Cell label="CPM" value={fmtCents(item.cpmCents)} />
        <Cell label="Spend" value={fmtCents(spendMilli)} />
        <Cell label="Impressions" value={Number(item.impressionsCount || 0).toLocaleString('en-US')} />
        <Cell label="Clicks" value={Number(item.clicksCount || 0).toLocaleString('en-US')} />
        <Cell label="Conversions" value={Number(item.conversionsCount || 0).toLocaleString('en-US')} />
        <Cell
          label="Creative"
          value={creative ? `${creative.status} · ${creative.mediaType || '—'} · ${fmtBytes(creative.fileSizeBytes)}` : null}
          empty="No creative row"
        />
        <Cell
          label="Creative object"
          value={creative ? (creative.objectKeyPresent ? 'object_key present' : 'object_key absent') : null}
          empty="No creative row"
        />
        <Cell label="Checksum" value={creative?.checksum} empty={creative ? 'Not supplied' : 'No creative row'} />
        <Cell label="Updated" value={fmtDateFull(item.updatedAt)} />
      </div>

      <div className="adm-mod__section-label">Activation blockers</div>
      <Blockers item={item} />
    </article>
  )
}

export default function AdminModeration() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [queue, setQueue] = useState('attention')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await fetchAdminModeration())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const items = useMemo(() => (data && Array.isArray(data.items) ? data.items : []), [data])
  const filtered = useMemo(() => items.filter((i) => matchesQueue(i, queue)), [items, queue])

  if (loading) return <LoadingState breadcrumb="Operations / Governance" title="Campaign Moderation" />
  if (error) return <ErrorState breadcrumb="Operations / Governance" title="Campaign Moderation" error={error} />
  if (!data) {
    return (
      <EmptyState
        breadcrumb="Operations / Governance"
        title="Campaign Moderation"
        label="No data"
        body="The server returned an empty moderation queue."
      />
    )
  }

  const summary = data.summary || {}
  const capabilities = data.capabilities || {}

  return (
    <>
      <PageHeader
        breadcrumb="Operations / Production"
        title="Campaign Moderation"
        sub={`${summary.needsAttention ?? 0} of ${summary.windowSize ?? 0} campaigns cannot go live · queue is derived from creative state and activation blockers`}
        status={capabilities.truncated ? `window capped at ${capabilities.rowLimit}` : 'live'}
        tone={capabilities.truncated ? 'amber' : ''}
      />

      <Unavailable
        label="No moderation decision endpoint"
        reason={capabilities.decide?.reason || capabilities.forceStatus?.reason}
      >
        Approve, reject, flag, and bulk actions cannot be implemented. The only write paths to a campaign or its
        creative are advertiser-scoped and reject an admin without an advertiser record. Nothing on this screen
        changes state; it reports it.
      </Unavailable>

      {data.blockerLookupError && (
        <div className="adm-error">
          Blocker lookup failed for part of the window: {data.blockerLookupError}
        </div>
      )}

      <Section title="Queue" subtitle={`${filtered.length} shown · ${items.length} in window`}>
        <div className="adm-gov-toolbar">
          <div className="adm-gov-toolbar__group">
            {QUEUE_FILTERS.map((f) => (
              <Pill
                key={f.key}
                active={queue === f.key}
                count={items.filter((i) => matchesQueue(i, f.key)).length}
                onClick={() => setQueue(f.key)}
              >
                {f.label}
              </Pill>
            ))}
          </div>
        </div>

        <div className="adm-gov-grid adm-gov-grid--wide">
          {(Object.keys(summary.byReviewState || {})).length > 0 && (
            <div className="adm-mod__legend">
              {Object.entries(summary.byReviewState).map(([state, count]) => (
                <span className="adm-mod__legend-item" key={state}>
                  <GovBadge tone={REVIEW_TONE[state] || 'draft'}>{reviewLabel(state)}</GovBadge>
                  <span className="adm-mono">{count}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="adm-empty">
            <div className="adm-empty__label">Nothing in this view</div>
            Switch the queue filter to see the rest of the window.
          </div>
        ) : (
          <div className="adm-gov-grid adm-gov-grid--wide">
            {filtered.map((item) => <ReviewCard key={item.campaignId} item={item} />)}
          </div>
        )}
      </Section>

      <CapabilityLedger
        capabilities={capabilities}
        omit={['rowLimit', 'truncated']}
        labels={{
          queueSemantics: 'Meaning of the queue',
          decide: 'Approve / reject decision',
          forceStatus: 'Force campaign status',
          storageVerification: 'Creative object existence check',
          domainReputation: 'Landing-domain reputation',
          piiScanning: 'PII leak scanning of creative',
          slaTimer: 'Per-item SLA timer',
          servingGate: 'Advertiser serving gate',
        }}
        title="What this screen can and cannot do"
        subtitle="Each unsupported row names the missing backend capability. No item on this screen is a placeholder for a feature that was cut."
      />

      <p className="adm-note">
        Read-only. Blockers come from the database function
        {' '}<span className="adm-mono">campaign_activation_blockers(campaign_id)</span>, which is the same
        authority the activation path uses.
      </p>
    </>
  )
}
