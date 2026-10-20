import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAdminAccounts, updateAdvertiserGate, deleteAdvertiserAccount, deleteDeveloperAccount } from '../../lib/adminApi.js'
import {
  CapabilityLedger, Cell, EmptyState, ErrorState, GovBadge, LoadingState, PageHeader,
  Pill, Section, Stdout, Unavailable, errorText, fmtDateFull, shortId,
} from './AdminGovernanceUi.jsx'
import './AdminGovernance.css'

const ROLE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'advertiser', label: 'Advertisers' },
  { key: 'developer', label: 'Developers' },
  { key: 'developer', label: 'Developers' },
  { key: 'admin', label: 'Admins' },
]

const STATUS_FILTERS = [
  { key: 'all', label: 'All states' },
  { key: 'gated', label: 'Serving gated' },
  { key: 'suspended', label: 'Developer suspended' },
]

function roleTone(role) {
  if (role === 'admin') return 'paused'
  if (role === 'advertiser') return 'active'
  if (role === 'developer') return 'completed'
  if (role === 'developer') return 'enabled'
  return 'archived'
}

/**
 * `null` here means "the schema has no such column", not "false" and not "0".
 * The distinctions matter: a suspended developer is a real recorded fact,
 * while an advertiser's review state has never been captured at all.
 */
function AccountState({ account }) {
  if (account.developer?.status === 'suspended') {
    return <GovBadge tone="suspended">suspended</GovBadge>
  }
  if (account.developer?.status === 'active') {
    return <GovBadge tone="active">active</GovBadge>
  }
  if (account.advertiser && account.advertiser.canRunCampaigns === false) {
    return <GovBadge tone="paused">serving gated</GovBadge>
  }
  return <span className="adm-gov-unknown">no status column</span>
}

function identityLines(account) {
  return [
    { key: 'profile', value: account.profileId },
    account.advertiser ? { key: 'advertiser', value: `${account.advertiser.id}` } : null,
    account.developer ? { key: 'developer', value: `${account.developer.id}` } : null,
    account.developer ? { key: 'developer', value: `${account.developer.id}` } : null,
  ].filter(Boolean)
}

function AccountCard({ account, onToggleGate, gateBusy, gateError, onDelete, deleteBusy, deleteError }) {
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirming, setDeleteConfirming] = useState(false)

  const gated = account.advertiser?.canRunCampaigns === false
  const canToggle = Boolean(account.advertiser)

  async function submit() {
    if (!reason.trim() || reason.trim().length < 3) {
      setConfirming(false)
      gateError('A reason of at least 3 characters is required.')
      return
    }
    await onToggleGate(account.advertiser.id, !gated, reason.trim())
    setReason('')
    setConfirming(false)
  }

  return (
    <article className="adm-entity">
      <header className="adm-entity__head">
        <span className="adm-entity__glyph" aria-hidden="true">{account.role.slice(0, 1).toUpperCase()}</span>
        <div className="adm-entity__id">
          <div className="adm-entity__name">{account.displayName || account.fullName || 'Unnamed profile'}</div>
          <div className="adm-entity__sub">
            <GovBadge tone={roleTone(account.role)}>{account.role}</GovBadge>
            <span className="adm-mono adm-dim">{shortId(account.profileId)}</span>
          </div>
        </div>
        <AccountState account={account} />
      </header>

      <Stdout lines={identityLines(account)} />

      <div className="adm-gov-kv">
        <Cell label="Email" value={account.email} empty={account.emailSource || 'No email column for this role'} />
        <Cell label="Joined" value={fmtDateFull(account.createdAt)} />
        <Cell
          label="Developer"
          value={account.developer ? account.developer.name : null}
          empty={account.ownedDeveloperCount > 0 ? `${account.ownedDeveloperCount} owned, unlinked` : 'None'}
        />
        <Cell
          label="Serving gate"
          value={account.advertiser ? (account.advertiser.canRunCampaigns ? 'can_run_campaigns = true' : 'can_run_campaigns = false') : null}
          empty="Advertiser records only"
        />
      </div>

      {canToggle && (
        <div className="adm-gate">
          <div className="adm-gate__head">
            <span className="adm-gate__label">
              {gated ? 'Campaigns blocked from delivery' : 'Campaigns may run'}
            </span>
            <button
              type="button"
              className={`adm-gov-btn ${gated ? 'adm-gov-btn--primary' : 'adm-gov-btn--danger'}`}
              onClick={() => setConfirming(true)}
            >
              {gated ? 'Restore serving' : 'Stop serving'}
            </button>
          </div>
          {confirming && (
            <div className="adm-gate__confirm">
              <p className="adm-gate__warning">
                This writes <span className="adm-mono">advertisers.can_run_campaigns</span> and is appended to
                the governance audit table. It stops this advertiser activating or resuming campaigns, and
                already-active campaigns stop being selected at delivery.
              </p>
              <input
                className="adm-gate__input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (recorded in the audit trail)"
                aria-label="Reason for the serving-gate change"
              />
              <div className="adm-gate__buttons">
                <button type="button" className="adm-gov-btn" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="adm-gov-btn adm-gov-btn--danger" disabled={gateBusy} onClick={submit}>
                  {gateBusy ? 'Applying…' : `Confirm: ${gated ? 'allow' : 'block'} serving`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {deleteError ? <p className="adm-gate__warning">{deleteError}</p> : null}
      {deleteConfirming ? (
        <div className="adm-gate__confirm">
          <p className="adm-gate__warning">
            Delete <span className="adm-mono">{account.displayName || account.fullName || 'this account'}</span>?
            The auth user is dropped and its role row cascades. Every campaign,
            impression and click belonging to it goes with it. There is no
            restore, and this is recorded in the governance audit trail.
          </p>
          <div className="adm-gate__buttons">
            <button type="button" className="adm-gov-btn" onClick={() => setDeleteConfirming(false)} disabled={deleteBusy}>
              Cancel
            </button>
            <button type="button" className="adm-gov-btn adm-gov-btn--danger" disabled={deleteBusy} onClick={() => onDelete(account.profileId, account.role)}>
              {deleteBusy ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </div>
      ) : (
        <div className="adm-gate__foot">
          <button
            type="button"
            className="adm-gov-btn adm-gov-btn--danger"
            onClick={() => setDeleteConfirming(true)}
            disabled={deleteBusy}
          >
            Delete account
          </button>
        </div>
      )}
    </article>
  )
}

export default function AdminAccounts() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('all')
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [gateBusy, setGateBusy] = useState(false)
  const [gateMessage, setGateMessage] = useState({ tone: '', text: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await fetchAdminAccounts())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleGate = useCallback(async (advertiserId, canRunCampaigns, reason) => {
    setGateBusy(true)
    setGateMessage({ tone: '', text: '' })
    try {
      const result = await updateAdvertiserGate(advertiserId, canRunCampaigns, reason)
      setGateMessage({
        tone: result.auditRecorded ? 'ok' : 'warn',
        text: result.auditRecorded
          ? `Serving gate updated for ${result.advertiser?.companyName || 'advertiser'}. Change appended to the audit trail.`
          : `Serving gate updated, but the audit append failed: ${result.note || 'unknown reason'}.`,
      })
      await load()
    } catch (e) {
      setGateMessage({ tone: 'error', text: errorText(e) })
    } finally {
      setGateBusy(false)
    }
  }, [load])

  const deleteAccount = useCallback(async (profileId, role) => {
    setGateBusy(true)
    setGateMessage({ tone: '', text: '' })
    try {
      const result = role === 'advertiser'
        ? await deleteAdvertiserAccount(profileId)
        : await deleteDeveloperAccount(profileId)
      setGateMessage({
        tone: 'ok',
        text: `${role} account deleted. ${result.auditRecorded ? 'Appended to the governance audit trail.' : 'Audit append failed.'}`,
      })
      await load()
    } catch (e) {
      setGateMessage({ tone: 'error', text: errorText(e) })
    } finally {
      setGateBusy(false)
    }
  }, [load])

  const accounts = useMemo(() => (data && Array.isArray(data.accounts) ? data.accounts : []), [data])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return accounts.filter((a) => {
      if (role !== 'all' && a.role !== role) return false
      if (status === 'gated' && !(a.advertiser && a.advertiser.canRunCampaigns === false)) return false
      if (status === 'suspended' && a.developer?.status !== 'suspended') return false
      if (!q) return true
      return [a.displayName, a.fullName, a.email, a.profileId, a.advertiser?.companyName, a.developer?.developerType, a.developer?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [accounts, role, status, query])

  const roleCounts = useMemo(() => {
    const counts = { all: accounts.length }
    for (const a of accounts) counts[a.role] = (counts[a.role] || 0) + 1
    return counts
  }, [accounts])

  if (loading) return <LoadingState breadcrumb="Operations / Governance" title="Accounts & Identity" />
  if (error) return <ErrorState breadcrumb="Operations / Governance" title="Accounts & Identity" error={error} />
  if (!data) {
    return (
      <EmptyState
        breadcrumb="Operations / Governance"
        title="Accounts & Identity"
        label="No data"
        body="The server returned an empty identity directory."
      />
    )
  }

  const counts = data.counts || {}
  const capabilities = data.capabilities || {}

  return (
    <>
      <PageHeader
        breadcrumb="Operations / Production"
        title="Accounts & Identity"
        sub={`${counts.total ?? 0} profiles · ${counts.advertisers ?? 0} advertisers · ${counts.developers ?? 0} developers · ${counts.developers ?? 0} developers`}
        status={capabilities.truncated ? `window capped at ${capabilities.rowLimit}` : 'live'}
        tone={capabilities.truncated ? 'amber' : ''}
      />

      {!capabilities.identityVerification?.supported && (
        <Unavailable
          label="No identity verification backend"
          reason={capabilities.identityVerification?.reason}
        >
          There is no KYC, document-verification, or review-state table or column in this database. Verification
          tier and screening state cannot be displayed because they are never recorded.
        </Unavailable>
      )}

      <Section
        title="Identity query"
        subtitle="Filters run in the browser over the rows the server returned. They do not query the database."
      >
        <div className="adm-gov-toolbar">
          <div className="adm-gov-search">
            <span className="adm-gov-search__prompt">&gt;</span>
            <input
              className="adm-gov-search__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, or id"
              aria-label="Search identities"
            />
            <span className="adm-gov-search__hint">{filtered.length}/{accounts.length}</span>
          </div>
          <div className="adm-gov-toolbar__group">
            {ROLE_FILTERS.map((f) => (
              <Pill key={f.key} active={role === f.key} count={roleCounts[f.key] || 0} onClick={() => setRole(f.key)}>
                {f.label}
              </Pill>
            ))}
          </div>
          <div className="adm-gov-toolbar__group">
            {STATUS_FILTERS.map((f) => (
              <Pill key={f.key} active={status === f.key} onClick={() => setStatus(f.key)}>
                {f.label}
              </Pill>
            ))}
          </div>
        </div>
        {gateMessage.text && (
          <div className={`adm-gate__message adm-gate__message--${gateMessage.tone}`}>{gateMessage.text}</div>
        )}
      </Section>

      <Section
        title="Entity ledger"
        subtitle={
          capabilities.truncated
            ? `Showing ${accounts.length} of the first ${capabilities.rowLimit} profiles. There is no pagination endpoint, so rows beyond the cap are invisible.`
            : `All ${accounts.length} profiles returned by the server.`
        }
      >
        {filtered.length === 0 ? (
          <div className="adm-empty">
            <div className="adm-empty__label">No matching identities</div>
            Adjust the role, state, or search filters.
          </div>
        ) : (
          <div className="adm-gov-grid">
            {filtered.map((account) => (
              <AccountCard
                key={account.profileId}
                account={account}
                gateBusy={gateBusy}
                deleteBusy={gateBusy}
                gateError={(text) => setGateMessage({ tone: 'error', text })}
                deleteError={gateMessage.tone === 'error' ? gateMessage.text : ''}
                onToggleGate={toggleGate}
                onDelete={deleteAccount}
              />
            ))}
          </div>
        )}
      </Section>

      {data.adminRoster?.available === false && (
        <Section title="Admin roster" subtitle="The source of admin authority.">
          <Unavailable label="Admin roster unavailable" reason={data.adminRoster.reason}>
            Admin membership is derived from <span className="adm-mono">profiles.role</span> plus a row in
            {' '}<span className="adm-mono">public.admin_emails</span>. That table could not be read, so the
            roster is unknown rather than empty.
          </Unavailable>
        </Section>
      )}

      {data.adminRoster?.available && data.adminRoster.entries?.length > 0 && (
        <Section title="Admin roster" subtitle="Rows that grant admin authority. Adding one requires a direct database insert.">
          <div className="adm-table-wrap">
            <div className="adm-table-scroll">
              <table className="adm-table">
                <thead>
                  <tr><th>Email</th><th>Note</th><th>Added</th></tr>
                </thead>
                <tbody>
                  {data.adminRoster.entries.map((row) => (
                    <tr key={row.email}>
                      <td className="adm-mono">{row.email}</td>
                      <td>{row.note || <span className="adm-dim">—</span>}</td>
                      <td className="adm-mono">{fmtDateFull(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      )}

      <CapabilityLedger
        capabilities={capabilities}
        omit={['rowLimit', 'truncated']}
        labels={{
          accountStatus: 'Profile account status',
          email: 'Email address',
          identityVerification: 'KYC / identity verification',
          riskFlags: 'Per-account risk flags',
          servingGate: 'Serving gate write',
          developerSuspension: 'Developer suspension state',
          pagination: 'Server-side pagination',
        }}
        title="What this screen can and cannot show"
        subtitle="Derived from the live schema. Anything marked unsupported has no backing column, table, or endpoint."
      />

      <p className="adm-note">
        Reads only. The sole write on this screen is the advertiser serving gate, which is the one governance
        lever the database actually enforces at campaign-activation time.
      </p>
    </>
  )
}
