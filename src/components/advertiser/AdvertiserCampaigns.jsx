import { useMemo, useState } from 'react'
import { AdvEmpty, AdvError, AdvLoading, AdvPageHead } from './AdvertiserUI.jsx'
import { Panel } from '../console/ui.jsx'
import {
  ADVERTISER_AUDIENCES,
  CAMPAIGN_STATUSES,
  archiveAdvertiserCampaign,
  createAdvertiserCampaign,
  ctrPct,
  formatCents,
  setActiveCampaign,
  toBudgetDollars,
  updateAdvertiserCampaign,
  validateCampaignInput,
} from '../../lib/advertiserApi.js'
import { campaignErrorMessage } from '../../lib/campaignErrors.js'
import { allowedNextStatuses } from '../../lib/campaignRules.js'

const EMPTY_FORM = {
  name: '',
  headline: '',
  description: '',
  cta: 'Learn more',
  audienceId: 'backend',
  budgetDollars: '1500',
  status: 'draft',
}

export default function AdvertiserCampaigns({ campaigns, loading, error, onRetry, onChanged, onUpsert }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [audience, setAudience] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [detailError, setDetailError] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return campaigns.filter((c) => {
      if (status !== 'all' && c.status !== status) return false
      if (audience !== 'all' && c.audienceId !== audience) return false
      if (!q) return true
      return [c.name, c.headline, c.description].join(' ').toLowerCase().includes(q)
    })
  }, [campaigns, query, status, audience])

  const selected = campaigns.find((c) => c.id === selectedId) || null

  function editSelected() {
    if (!selected) return
    setForm({
      name: selected.name,
      headline: selected.headline,
      description: selected.description,
      cta: selected.cta,
      audienceId: selected.audienceId,
      budgetDollars: toBudgetDollars(selected.budgetCents),
      status: selected.status,
    })
    setFormErrors({})
    setNotice('')
    setDetailError('')
  }

  async function handleCreate(e) {
    e.preventDefault()
    const errors = validateCampaignInput(form)
    setFormErrors(errors)
    if (Object.keys(errors).length) return
    setSaving(true)
    setNotice('')
    try {
      const created = await createAdvertiserCampaign(form)
      onUpsert?.(created)
      setSelectedId(created.id)
      setNotice(`Created ${created.name}. It starts as draft in the backend.`)
      setForm(EMPTY_FORM)
      await onChanged()
    } catch (err) {
      setFormErrors({ form: campaignErrorMessage(err, 'Campaign could not be created.') })
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(e) {
    e.preventDefault()
    if (!selected) return
    const errors = validateCampaignInput({ ...form, budgetDollars: form.budgetDollars })
    setFormErrors(errors)
    if (Object.keys(errors).length) return
    setSaving(true)
    setDetailError('')
    try {
      const patch = {}
      if (form.name !== selected.name) patch.name = form.name
      if (form.headline !== selected.headline) patch.headline = form.headline
      if (form.description !== selected.description) patch.description = form.description
      if (form.cta !== selected.cta) patch.cta = form.cta
      if (form.audienceId !== selected.audienceId) patch.audienceId = form.audienceId
      if (toBudgetDollars(selected.budgetCents) !== String(form.budgetDollars)) {
        patch.budgetDollars = form.budgetDollars
      }
      if (form.status !== selected.status) patch.status = form.status
      if (Object.keys(patch).length === 0) {
        setNotice('No changes to save.')
        setSaving(false)
        return
      }
      const updated = await updateAdvertiserCampaign(selected.id, patch)
      onUpsert?.(updated)
      setNotice(`Saved ${updated.name}.`)
      await onChanged()
    } catch (err) {
      setDetailError(campaignErrorMessage(err, 'Campaign could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleSelect(id) {
    setDetailError('')
    try {
      await setActiveCampaign(id)
      setNotice('Active campaign updated server-side.')
      await onChanged()
    } catch (err) {
      setDetailError(campaignErrorMessage(err, 'Could not set active campaign.'))
    }
  }

  async function handleArchive() {
    if (!selected) return
    setDetailError('')
    try {
      const archived = await archiveAdvertiserCampaign(selected.id)
      onUpsert?.(archived)
      setNotice(`${archived.name} archived. Accounting history is kept.`)
      setForm((f) => ({ ...f, status: 'archived' }))
      await onChanged()
    } catch (err) {
      setDetailError(campaignErrorMessage(err, 'Campaign could not be archived.'))
    }
  }

  return (
    <div className="adv-page">
      <AdvPageHead
        index="A2"
        label="Advertiser · Campaigns"
        title="Briefs, budgets, and delivery state."
        body="Every campaign starts as a draft. Activation is an explicit step, so nothing goes live by accident."
      />
      <AdvError message={error} onRetry={onRetry} />
      {notice ? <div className="adv-notice" role="status">{notice}</div> : null}

      <div className="adv-grid adv-grid--split">
        <section className="panel adv-panel" aria-label="Campaign list">
          <div className="adv-panel__row">
            <h4 className="adv-panel__title">Campaigns</h4>
            <span className="adv-count mono">{filtered.length} / {campaigns.length}</span>
          </div>
          <div className="adv-filters">
            <input
              className="field__input"
              placeholder="Search name or headline"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search campaigns"
            />
            <select className="field__input field__input--select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="field__input field__input--select" value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Filter by audience">
              <option value="all">All audiences</option>
              {ADVERTISER_AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          {loading ? <AdvLoading label="Loading campaigns…" /> : filtered.length === 0 ? (
            campaigns.length === 0 ? (
              <AdvEmpty mark="No campaigns" title="No campaigns yet" body="Start your first brief in the New campaign form." />
            ) : (
              <AdvEmpty mark="No matches" title="No campaigns match" body="Adjust search or filters, or create a new brief." />
            )
          ) : (
            <div className="adv-tablewrap">
              <table className="adv-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Spend</th>
                    <th>Impr.</th>
                    <th>CTR</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} data-active={c.id === selectedId}>
                      <td data-label="Campaign">
                        <div className="adv-cell__name">{c.name}</div>
                        <div className="adv-cell__sub">{c.audienceLabel} · {formatCents(c.budgetCents)} budget</div>
                      </td>
                      <td data-label="Status"><span className="adv-pill" data-status={c.status}>{c.status}</span></td>
                      <td className="mono" data-label="Spend">{formatCents(c.spendCents)}</td>
                      <td className="mono" data-label="Impr.">{c.impressions.toLocaleString('en-US')}</td>
                      <td className="mono" data-label="CTR">{ctrPct(c.clicks, c.impressions).toFixed(2)}%</td>
                      <td data-label=" ">
                        <button type="button" className="btn btn--ghost" onClick={() => { setSelectedId(c.id); setNotice(''); setDetailError('') }}>
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="adv-stack">
          <Panel className="adv-panel">
            <h4 className="adv-panel__title">{selected ? 'Campaign details' : 'New campaign'}</h4>
            <p className="adv-panel__sub">
              {selected ? 'Edit the brief or change delivery state — only the fields you touch are saved.' : 'Start a new draft. Nothing is charged until a campaign is active.'}
            </p>
            {selected ? (
              <div className="adv-detail__actions">
                <button type="button" className="btn btn--ghost" onClick={editSelected}>Load into editor</button>
                <button type="button" className="btn btn--ghost" onClick={() => handleSelect(selected.id)}>Set active</button>
                {selected.status !== 'archived' ? (
                  <button type="button" className="btn btn--ghost" onClick={handleArchive}>Archive</button>
                ) : null}
                <button type="button" className="btn btn--ghost" onClick={() => setSelectedId(null)}>New…</button>
              </div>
            ) : null}
            {detailError ? <div className="adv-notice adv-notice--error" role="alert">{detailError}</div> : null}
            {selected && !form.name && form.budgetDollars === EMPTY_FORM.budgetDollars ? (
              <dl className="adv-detail">
                <div><dt>Headline</dt><dd>{selected.headline}</dd></div>
                <div><dt>Description</dt><dd>{selected.description || '—'}</dd></div>
                <div><dt>CTA</dt><dd>{selected.cta}</dd></div>
                <div><dt>Budget</dt><dd className="mono">{formatCents(selected.budgetCents)}</dd></div>
                <div><dt>Impressions / clicks / conv.</dt><dd className="mono">{selected.impressions.toLocaleString('en-US')} / {selected.clicks.toLocaleString('en-US')} / {selected.conversions.toLocaleString('en-US')}</dd></div>
              </dl>
            ) : null}
            <form className="form adv-form" onSubmit={selected ? handleUpdate : handleCreate} noValidate>
              <label className="field">
                <span className="field__label">Campaign name</span>
                <input className="field__input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" />
                {formErrors.name ? <span className="adv-field-error">{formErrors.name}</span> : null}
              </label>
              <label className="field">
                <span className="field__label">Headline</span>
                <input className="field__input" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} autoComplete="off" />
                {formErrors.headline ? <span className="adv-field-error">{formErrors.headline}</span> : null}
              </label>
              <label className="field">
                <span className="field__label">Description</span>
                <textarea className="field__input field__input--area" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Call to action</span>
                  <input className="field__input" value={form.cta} onChange={(e) => setForm({ ...form, cta: e.target.value })} autoComplete="off" />
                </label>
                <label className="field">
                  <span className="field__label">Budget (USD)</span>
                  <input className="field__input" type="number" min={1} step="0.01" value={form.budgetDollars} onChange={(e) => setForm({ ...form, budgetDollars: e.target.value })} inputMode="decimal" />
                  {formErrors.budgetDollars ? <span className="adv-field-error">{formErrors.budgetDollars}</span> : null}
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Audience</span>
                  <select className="field__input field__input--select" value={form.audienceId} onChange={(e) => setForm({ ...form, audienceId: e.target.value })}>
                    {ADVERTISER_AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                  {formErrors.audienceId ? <span className="adv-field-error">{formErrors.audienceId}</span> : null}
                </label>
                <label className="field">
                  <span className="field__label">Status</span>
                  <select
                    className="field__input field__input--select"
                    value={selected ? form.status : 'draft'}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    disabled={!selected}
                  >
                    {(selected ? allowedNextStatuses(selected.status) : CAMPAIGN_STATUSES).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  </select>
                </label>
              </div>
              {formErrors.form ? <p className="form__error" role="alert">{formErrors.form}</p> : null}
              <button className="btn btn--primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : selected ? 'Save changes' : 'Create campaign'}
              </button>
              <p className="form__note">Nothing is charged. Campaigns save to your account only.</p>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  )
}
