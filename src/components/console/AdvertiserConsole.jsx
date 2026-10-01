/* =============================================================
   CLIRevenue — the advertiser console
   -------------------------------------------------------------
   Seeded demo figures, a table of campaigns, and a mock creation
   flow. Nothing here is billed: the form writes a campaign record
   and a ledger row, and the campaign immediately becomes the one the
   workbench slot serves.
   ============================================================= */

import { useState } from 'react'

import { DemoTag, SectionHead } from './ui.jsx'
import SponsoredSlot from './SponsoredSlot.jsx'
import { AUDIENCES } from '../../data/economy.js'
import { campaignMetrics, ctr, cvr, formatMoney, percent, parseBudget, toCents } from '../../lib/economy.js'
import { createCampaign, selectCampaign } from '../../lib/economyStore.js'

const COLUMNS = [
  { key: 'name', label: 'Campaign' },
  { key: 'audience', label: 'Audience' },
  { key: 'budget', label: 'Budget' },
  { key: 'spend', label: 'Spend' },
  { key: 'impressions', label: 'Impressions' },
  { key: 'ctr', label: 'CTR' },
  { key: 'conversions', label: 'Conv.' },
]

const EMPTY_FORM = {
  name: '',
  headline: '',
  description: '',
  cta: 'Learn more',
  audience: AUDIENCES[0].id,
  budget: '1500',
}

function AdvertiserConsole({ economy }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)

  const active =
    economy.campaigns.find((c) => c.id === economy.activeCampaignId) || economy.campaigns[0]
  const metrics = campaignMetrics(active)

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }))
    setError('')
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!form.name.trim() || !form.headline.trim()) {
      setError('Campaign name and headline are required.')
      return
    }
    const budgetCents = parseBudget(form.budget, toCents(1000))
    const campaign = createCampaign({
      name: form.name,
      headline: form.headline,
      description: form.description,
      cta: form.cta,
      audience: form.audience,
      budgetCents,
    })
    setCreated(campaign)
    setForm(EMPTY_FORM)
    setError('')
  }

  return (
    <div className="block advertiser" id="advertiser">
      <SectionHead
        index="02"
        label="Advertiser"
        title="Write the brief. Watch it land in a real session."
        body="Campaign records, budget commit, delivery metrics — all of it simulated, all of it moving against the same ledger the developer's wallet reads from."
      />

      <div className="advertiser__grid">
        <div className="advertiser__main">
          <div className="advertiser__toolbar">
            <div className="switcher" role="group" aria-label="Active campaign">
              {economy.campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  className="switcher__btn"
                  aria-pressed={campaign.id === active.id}
                  onClick={() => selectCampaign(campaign.id)}
                >
                  {campaign.name}
                </button>
              ))}
            </div>
            <DemoTag>Seeded demo data</DemoTag>
          </div>

          <div className="adpreview">
            <div className="adpreview__head">
              <h4 className="adpreview__title">Creative preview</h4>
              <span className="adpreview__tag">Serving from {active.name}</span>
            </div>
            <SponsoredSlot
              campaign={active}
              connected={economy.account.connected}
              hidden={false}
            />
            <p className="adpreview__note">
              What the developer would see in the reserved region: it sits beside the
              output, never inside it. This is the advertiser's own creative, rendered
              locally — it is not delivered and records nothing. The live, delivered slot
              is the one in the workbench above, and it is served by the CLIRevenue SDK.
            </p>
          </div>

          <div className="stats">
            <div className="stat">
              <span className="stat__label">Budget</span>
              <span className="stat__value">{formatMoney(metrics.budgetCents)}</span>
              <span className="stat__hint">{metrics.delivery.toFixed(1)}% delivered</span>
            </div>
            <div className="stat">
              <span className="stat__label">Spend</span>
              <span className="stat__value">{formatMoney(metrics.spendCents)}</span>
              <span className="stat__hint">
                {formatMoney(metrics.remainingCents)} remaining
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Impressions</span>
              <span className="stat__value">{metrics.impressions.toLocaleString('en-US')}</span>
              <span className="stat__hint">slots rendered</span>
            </div>
            <div className="stat">
              <span className="stat__label">Engagement</span>
              <span className="stat__value">{metrics.engagement.toLocaleString('en-US')}</span>
              <span className="stat__hint">interactions</span>
            </div>
            <div className="stat">
              <span className="stat__label">CTR</span>
              <span className="stat__value">{percent(metrics.ctr)}</span>
              <span className="stat__hint">of impressions</span>
            </div>
            <div className="stat">
              <span className="stat__label">Conversions</span>
              <span className="stat__value">{metrics.conversions.toLocaleString('en-US')}</span>
              <span className="stat__hint">{percent(metrics.cvr)} of clicks</span>
            </div>
          </div>

          <div className="tablewrap">
            <table className="camps">
              <caption className="visually-hidden">
                All campaigns in this simulation, with seeded demo metrics
              </caption>
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column.key} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {economy.campaigns.map((campaign) => {
                  const row = campaignMetrics(campaign)
                  return (
                    <tr key={campaign.id} data-active={campaign.id === active.id ? 'true' : undefined}>
                      <td data-label="Campaign">
                        <span className="camps__name">{campaign.name}</span>
                        <span className="camps__status" data-status={campaign.status}>
                          {campaign.status}
                        </span>
                      </td>
                      <td data-label="Audience">
                        {AUDIENCES.find((a) => a.id === campaign.audience)?.label ??
                          campaign.audience}
                      </td>
                      <td data-label="Budget">{formatMoney(row.budgetCents)}</td>
                      <td data-label="Spend">{formatMoney(row.spendCents)}</td>
                      <td data-label="Impressions">
                        {campaign.impressions.toLocaleString('en-US')}
                      </td>
                      <td data-label="CTR">{percent(ctr(campaign.clicks, campaign.impressions))}</td>
                      <td data-label="Conversions">
                        {campaign.conversions.toLocaleString('en-US')}
                        <span className="camps__sub">
                          {percent(cvr(campaign.conversions, campaign.clicks), 1)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="form__head">
            <h4 className="form__title">New campaign</h4>
            <span className="form__tag">No billing</span>
          </div>

          <label className="field">
            <span className="field__label">Campaign name</span>
            <input
              className="field__input"
              type="text"
              name="name"
              value={form.name}
              onChange={update('name')}
              placeholder="Q4 developer launch"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Headline</span>
            <input
              className="field__input"
              type="text"
              name="headline"
              value={form.headline}
              onChange={update('headline')}
              placeholder="Ship the gateway before lunch."
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Description</span>
            <textarea
              className="field__input field__input--area"
              name="description"
              rows={3}
              value={form.description}
              onChange={update('description')}
              placeholder="What the developer gets if they follow the call to action."
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Call to action</span>
              <input
                className="field__input"
                type="text"
                name="cta"
                value={form.cta}
                onChange={update('cta')}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span className="field__label">Budget (USD)</span>
              <input
                className="field__input"
                type="number"
                name="budget"
                min={1}
                step={1}
                value={form.budget}
                onChange={update('budget')}
                inputMode="decimal"
              />
            </label>
          </div>

          <label className="field">
            <span className="field__label">Developer audience</span>
            <select
              className="field__input field__input--select"
              name="audience"
              value={form.audience}
              onChange={update('audience')}
            >
              {AUDIENCES.map((audience) => (
                <option key={audience.id} value={audience.id}>
                  {`${audience.label} — ${audience.note}`}
                </option>
              ))}
            </select>
          </label>

          <p className="form__error" aria-live="assertive">
            {error}
          </p>

          <button className="btn btn--primary" type="submit">
            Create campaign
          </button>

          <p className="form__note">
            Demo only. No card is taken, no invoice is raised, nothing is delivered
            anywhere outside this page.
          </p>

          {created && (
            <p className="form__ok" aria-live="polite">
              <span className="form__ok-title">{created.name}</span> is now the live slot in
              the workbench. <a href="#workbench">See it render</a>
            </p>
          )}
        </form>
      </div>
    </div>
  )
}

export default AdvertiserConsole
