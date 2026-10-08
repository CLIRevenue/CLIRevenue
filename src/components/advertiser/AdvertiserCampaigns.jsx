import { useEffect, useMemo, useRef, useState } from 'react'
import { AdvEmpty, AdvError, AdvLoading, AdvPageHead } from './AdvertiserUI.jsx'
import { Panel } from '../console/ui.jsx'
import {
  ADVERTISER_AUDIENCES,
  CAMPAIGN_STATUSES,
  archiveAdvertiserCampaign,
  createAdvertiserCampaign,
  ctrPct,
  deleteCreative,
  fetchCreatives,
  formatCents,
  setActiveCampaign,
  toBudgetDollars,
  updateAdvertiserCampaign,
  uploadCreativeFile,
  validateCampaignInput,
} from '../../lib/advertiserApi.js'
import { campaignErrorCode, campaignErrorMessage } from '../../lib/campaignErrors.js'
import {
  acceptForMediaType,
  activationBlockerMessage,
  advisoryBlockers,
  allowedNextStatuses,
  formatBytes,
  maxCreativeBytes,
} from '../../lib/campaignRules.js'

const EMPTY_FORM = {
  name: '',
  headline: '',
  description: '',
  cta: 'Learn more',
  audienceId: 'backend',
  budgetDollars: '1500',
  cpmDollars: '0.01',
  startsAt: '',
  endsAt: '',
  landingUrl: '',
  status: 'draft',
}

/** The eight steps an advertiser walks through, in order. */
const STEPS = [
  'Campaign details',
  'Audience',
  'Budget',
  'Schedule',
  'Creative upload',
  'Creative preview',
  'Save draft',
  'Activate',
]

/** `campaigns.cpm_cents` is milli-cents; the advertiser edits whole dollars. */
function toCpmDollars(milliCents) {
  if (typeof milliCents !== 'number' || !Number.isFinite(milliCents)) return ''
  return String(Number((milliCents / 1000).toFixed(4)))
}

/** Returns a positive integer of milli-cents, `null` when cleared, or NaN when nonsense. */
function toCpmMilliCents(dollars) {
  const text = String(dollars ?? '').trim()
  if (!text) return null
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) return Number.NaN
  return Math.round(value * 1000)
}

/** ISO timestamp -> the `YYYY-MM-DDTHH:mm` shape a datetime-local input expects. */
function toLocalInput(iso) {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function describeCreative(creative) {
  if (!creative) return null
  const bits = [creative.mimeType || creative.mediaType, formatBytes(creative.fileSizeBytes)]
  if (creative.width && creative.height) bits.push(`${creative.width}×${creative.height}`)
  if (creative.durationMs) bits.push(`${Math.round(creative.durationMs / 1000)}s`)
  return bits.filter(Boolean).join(' · ')
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
  const [blockers, setBlockers] = useState([])
  const [mediaType, setMediaType] = useState('image')
  const [creative, setCreative] = useState(null)
  const [creativeName, setCreativeName] = useState('')
  const [creativeError, setCreativeError] = useState('')
  const [creativeProgress, setCreativeProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

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
  const hints = useMemo(() => (selected ? advisoryBlockers(selected) : []), [selected])

  // The creative URL is a short-lived capability minted per request, so it is
  // fetched here instead of riding along on the campaign list response. Clearing
  // the previous selection happens in selectCampaign, not in this effect body:
  // resetting state synchronously here would cascade a render on every switch.
  useEffect(() => {
    if (!selectedId) return undefined
    let cancelled = false
    fetchCreatives({ campaignId: selectedId, includeUrl: true })
      .then((rows) => {
        if (cancelled) return
        const first = rows[0] || null
        setCreative(first)
        setMediaType(first?.mediaType === 'video' ? 'video' : 'image')
      })
      .catch((err) => {
        if (cancelled) return
        setCreative(null)
        setCreativeError(campaignErrorMessage(err, 'Creative could not be loaded.'))
      })
    return () => { cancelled = true }
  }, [selectedId])

  const stepState = useMemo(() => {
    const name = form.name.trim()
    const headline = form.headline.trim()
    const budgetCents = Math.round(Number(form.budgetDollars) * 100)
    const cpm = toCpmMilliCents(form.cpmDollars)
    const scheduleStart = form.startsAt ? Date.parse(form.startsAt) : null
    const scheduleEnd = form.endsAt ? Date.parse(form.endsAt) : null
    const saved = Boolean(selected)
    const delivered = creative?.status === 'validated'
    return [
      { done: name.length > 0 && headline.length > 0 },
      { done: Boolean(form.audienceId) },
      { done: Number.isFinite(budgetCents) && budgetCents > 0 && (cpm === null || (Number.isFinite(cpm) && cpm > 0)) },
      { done: !(Number.isFinite(scheduleStart) && Number.isFinite(scheduleEnd) && scheduleStart >= scheduleEnd) },
      { done: creative?.status === 'uploaded' || delivered },
      { done: delivered },
      { done: saved },
      { done: selected?.status === 'active' },
    ]
  }, [form, creative, selected])

  const activeStep = useMemo(() => {
    const firstUnfinished = stepState.findIndex((s) => !s.done)
    return firstUnfinished === -1 ? STEPS.length - 1 : firstUnfinished
  }, [stepState])

  function formToApiInput() {
    return { ...form, cpmCents: toCpmMilliCents(form.cpmDollars) }
  }

  function editSelected() {
    if (!selected) return
    setForm({
      name: selected.name,
      headline: selected.headline,
      description: selected.description,
      cta: selected.cta,
      audienceId: selected.audienceId,
      budgetDollars: toBudgetDollars(selected.budgetCents),
      cpmDollars: toCpmDollars(selected.cpmCents),
      startsAt: toLocalInput(selected.startsAt),
      endsAt: toLocalInput(selected.endsAt),
      landingUrl: selected.landingUrl || '',
      status: selected.status,
    })
    setFormErrors({})
    setNotice('')
    setDetailError('')
    setBlockers([])
  }

  async function handleCreate(e) {
    e.preventDefault()
    const errors = validateCampaignInput(formToApiInput())
    setFormErrors(errors)
    if (Object.keys(errors).length) return
    setSaving(true)
    setNotice('')
    setDetailError('')
    setBlockers([])
    try {
      const created = await createAdvertiserCampaign(formToApiInput())
      onUpsert?.(created)
      selectCampaign(created.id)
      setNotice(`Created ${created.name}. It starts as a draft — upload a creative, then activate it.`)
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
    const apiInput = formToApiInput()
    const errors = validateCampaignInput(apiInput)
    setFormErrors(errors)
    if (Object.keys(errors).length) return
    setSaving(true)
    setDetailError('')
    setBlockers([])
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
      if (toCpmDollars(selected.cpmCents) !== String(form.cpmDollars)) {
        patch.cpmCents = apiInput.cpmCents
      }
      if (toLocalInput(selected.startsAt) !== String(form.startsAt)) patch.startsAt = form.startsAt
      if (toLocalInput(selected.endsAt) !== String(form.endsAt)) patch.endsAt = form.endsAt
      if ((selected.landingUrl || '') !== String(form.landingUrl)) patch.landingUrl = form.landingUrl
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
      if (campaignErrorCode(err) === 'CAMPAIGN_NOT_ACTIVATABLE') {
        setBlockers(Array.isArray(err.payload?.blockers) ? err.payload.blockers : [])
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleActivate() {
    if (!selected) return
    setSaving(true)
    setDetailError('')
    setBlockers([])
    try {
      const activated = await updateAdvertiserCampaign(selected.id, { status: 'active' })
      onUpsert?.(activated)
      setForm((f) => ({ ...f, status: 'active' }))
      setNotice(`${activated.name} is live. Delivery will pick it up on the next ad request.`)
      await onChanged()
    } catch (err) {
      setDetailError(campaignErrorMessage(err, 'Campaign could not be activated.'))
      if (campaignErrorCode(err) === 'CAMPAIGN_NOT_ACTIVATABLE') {
        setBlockers(Array.isArray(err.payload?.blockers) ? err.payload.blockers : [])
      }
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

  async function loadCreative(campaignId) {
    const rows = await fetchCreatives({ campaignId, includeUrl: true })
    setCreative(rows[0] || null)
    return rows[0] || null
  }

  async function handleCreativeFile(e) {
    e.preventDefault()
    const file = e.target.files && e.target.files[0]
    if (!file || !selected) return
    setUploading(true)
    setCreativeError('')
    setCreativeProgress(0)
    setCreativeName(file.name)
    try {
      await uploadCreativeFile(selected.id, file, {
        mediaType,
        onProgress: (pct) => setCreativeProgress(pct),
      })
      const validated = await loadCreative(selected.id)
      setNotice(`Uploaded ${file.name}. Creative status: ${validated?.status || 'unknown'}.`)
      setDetailError('')
      await onChanged()
    } catch (err) {
      setCreativeError(campaignErrorMessage(err, 'The creative could not be uploaded.'))
      await loadCreative(selected.id).catch(() => {})
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleRemoveCreative() {
    if (!selected) return
    setUploading(true)
    setCreativeError('')
    try {
      await deleteCreative(selected.id)
      setCreative(null)
      setCreativeName('')
      setNotice('Creative removed from this campaign.')
      await onChanged()
    } catch (err) {
      setCreativeError(campaignErrorMessage(err, 'The creative could not be removed.'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function selectCampaign(id) {
    setSelectedId(id)
    setNotice('')
    setDetailError('')
    setBlockers([])
    setCreative(null)
    setCreativeName('')
    setCreativeError('')
    setCreativeProgress(0)
  }

  const creativeSummary = describeCreative(creative)
  const canActivate = Boolean(selected) && selected.status !== 'archived'

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
                        <div className="adv-cell__sub">
                          {c.audienceLabel} · {formatCents(c.budgetCents)} budget
                          {c.creative?.status === 'validated' ? ' · creative ready' : ' · no creative'}
                        </div>
                      </td>
                      <td data-label="Status"><span className="adv-pill" data-status={c.status}>{c.status}</span></td>
                      <td className="mono" data-label="Spend">{formatCents(c.spendCents)}</td>
                      <td className="mono" data-label="Impr">{c.impressions.toLocaleString('en-US')}</td>
                      <td className="mono" data-label="CTR">{ctrPct(c.clicks, c.impressions).toFixed(2)}%</td>
                      <td data-label=" ">
                        <button type="button" className="btn btn--ghost" onClick={() => selectCampaign(c.id)}>
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

            <ol className="adv-detail" aria-label="Campaign setup steps">
              {STEPS.map((label, i) => (
                <li key={label}>
                  <dt>
                    <span className="adv-id">{String(i + 1).padStart(2, '0')}</span> {label}
                    {i === activeStep ? ' · next' : ''}
                  </dt>
                  <dd>
                    <span className="adv-pill" data-status={stepState[i].done ? 'validated' : 'draft'}>
                      {stepState[i].done ? 'done' : 'todo'}
                    </span>
                  </dd>
                </li>
              ))}
            </ol>

            {selected ? (
              <div className="adv-detail__actions">
                <button type="button" className="btn btn--ghost" onClick={editSelected}>Load into editor</button>
                {canActivate ? (
                  <button type="button" className="btn btn--primary" onClick={handleActivate} disabled={saving || selected.status === 'active'}>
                    {saving ? 'Working…' : selected.status === 'active' ? 'Active' : 'Activate'}
                  </button>
                ) : null}
                <button type="button" className="btn btn--ghost" onClick={() => handleSelect(selected.id)}>Set active</button>
                {selected.status !== 'archived' ? (
                  <button type="button" className="btn btn--ghost" onClick={handleArchive}>Archive</button>
                ) : null}
                <button type="button" className="btn btn--ghost" onClick={() => selectCampaign(null)}>New…</button>
              </div>
            ) : null}
            {detailError ? <div className="adv-notice adv-notice--error" role="alert">{detailError}</div> : null}
            {blockers.length ? (
              <div className="adv-notice adv-notice--error" role="alert">
                <ul>
                  {blockers.map((code) => <li key={code}>{activationBlockerMessage(code)}</li>)}
                </ul>
              </div>
            ) : null}
            {selected && hints.length ? (
              <p className="adv-note adv-note--warn">
                Heads up: {hints.map((code) => activationBlockerMessage(code)).join(' ')}
              </p>
            ) : null}
            {selected && !form.name && form.budgetDollars === EMPTY_FORM.budgetDollars ? (
              <dl className="adv-detail">
                <div><dt>Headline</dt><dd>{selected.headline}</dd></div>
                <div><dt>Description</dt><dd>{selected.description || '—'}</dd></div>
                <div><dt>CTA</dt><dd>{selected.cta}</dd></div>
                <div><dt>Landing URL</dt><dd>{selected.landingUrl || '—'}</dd></div>
                <div><dt>Budget</dt><dd className="mono">{formatCents(selected.budgetCents)}</dd></div>
                <div><dt>CPM</dt><dd className="mono">${toCpmDollars(selected.cpmCents) || '—'}</dd></div>
                <div><dt>Schedule</dt><dd>{selected.startsAt ? new Date(selected.startsAt).toLocaleString() : 'Any time'}</dd></div>
                <div><dt>Impressions / clicks / conv.</dt><dd className="mono">{selected.impressions.toLocaleString('en-US')} / {selected.clicks.toLocaleString('en-US')} / {selected.conversions.toLocaleString('en-US')}</dd></div>
              </dl>
            ) : null}

            {selected ? (
              <div className="adv-detail" aria-label="Creative">
                <div>
                  <dt>Creative</dt>
                  <dd>
                    {creative
                      ? `${creative.status} · ${creativeSummary}`
                      : 'No creative uploaded yet — this campaign cannot be activated until one is.'}
                  </dd>
                </div>
                <div>
                  <dt>Delivery URL</dt>
                  <dd>
                    {creative?.url
                      ? 'Short-lived signed URL, minted per request.'
                      : '—'}
                  </dd>
                </div>
              </div>
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
                  <span className="field__label">Landing URL</span>
                  <input className="field__input" value={form.landingUrl} onChange={(e) => setForm({ ...form, landingUrl: e.target.value })} placeholder="https://example.com/offer" autoComplete="off" />
                  {formErrors.landingUrl ? <span className="adv-field-error">{formErrors.landingUrl}</span> : null}
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Budget (USD)</span>
                  <input className="field__input" type="number" min={1} step="0.01" value={form.budgetDollars} onChange={(e) => setForm({ ...form, budgetDollars: e.target.value })} inputMode="decimal" />
                  {formErrors.budgetDollars ? <span className="adv-field-error">{formErrors.budgetDollars}</span> : null}
                </label>
                <label className="field">
                  <span className="field__label">CPM (USD)</span>
                  <input className="field__input" type="number" min={0.001} step="0.001" value={form.cpmDollars} onChange={(e) => setForm({ ...form, cpmDollars: e.target.value })} inputMode="decimal" />
                  {formErrors.cpmCents ? <span className="adv-field-error">{formErrors.cpmCents}</span> : null}
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
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Starts</span>
                  <input className="field__input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field__label">Ends</span>
                  <input className="field__input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
                  {formErrors.endsAt ? <span className="adv-field-error">{formErrors.endsAt}</span> : null}
                </label>
              </div>

              {selected ? (
                <div className="adv-form">
                  <div className="adv-radio-row" role="radiogroup" aria-label="Creative type">
                    {['image', 'video'].map((t) => (
                      <label key={t} className="adv-check">
                        <input
                          type="radio"
                          name="creative-media-type"
                          value={t}
                          checked={mediaType === t}
                          onChange={() => setMediaType(t)}
                        />
                        <span>{t} · up to {formatBytes(maxCreativeBytes(t))}</span>
                      </label>
                    ))}
                  </div>
                  <label className="field">
                    <span className="field__label">
                      {creative?.status === 'validated' ? 'Replace creative' : 'Upload creative'}
                    </span>
                    <input
                      ref={fileRef}
                      className="field__input"
                      type="file"
                      accept={acceptForMediaType(mediaType)}
                      onChange={handleCreativeFile}
                      disabled={uploading}
                    />
                  </label>
                  {uploading ? (
                    <div aria-live="polite">
                      <div
                        className="adv-loading__bar"
                        style={{ width: `${creativeProgress}%` }}
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={creativeProgress}
                        aria-label="Creative upload progress"
                      />
                      <p className="form__note">
                        {creativeName} · uploading {creativeProgress}%
                      </p>
                    </div>
                  ) : null}
                  {creativeError ? <p className="form__error" role="alert">{creativeError}</p> : null}
                  {creative?.status === 'validated' ? (
                    <div>
                      {creative.mediaType === 'video' ? (
                        <video
                          className="field__input"
                          src={creative.url || ''}
                          poster={creative.posterUrl || undefined}
                          controls
                          muted
                          playsInline
                          preload="metadata"
                          style={{ width: '100%' }}
                        />
                      ) : (
                        <img
                          className="field__input"
                          src={creative.url || ''}
                          alt={`Creative for ${selected.name}`}
                          style={{ width: '100%' }}
                        />
                      )}
                      <p className="form__note">
                        {creativeName || describeCreative(creative)} — the signed URL above expires shortly and is never stored.
                      </p>
                      <button type="button" className="btn btn--danger" onClick={handleRemoveCreative} disabled={uploading}>
                        Remove creative
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {formErrors.form ? <p className="form__error" role="alert">{formErrors.form}</p> : null}
              <button className="btn btn--primary" type="submit" disabled={saving || uploading}>
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