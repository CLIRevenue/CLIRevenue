import { useMemo } from 'react'
import { AdvBarChart, AdvEmpty, AdvError, AdvLoading, AdvPageHead, AdvStats } from './AdvertiserUI.jsx'
import { ctrPct, conversionRatePct, formatCents } from '../../lib/advertiserApi.js'

export default function AdvertiserAnalytics({ campaigns, loading, error, onRetry }) {
  const totals = useMemo(() => {
    const spend = campaigns.reduce((n, c) => n + (c.spendCents || 0), 0)
    const impressions = campaigns.reduce((n, c) => n + (c.impressions || 0), 0)
    const clicks = campaigns.reduce((n, c) => n + (c.clicks || 0), 0)
    const conversions = campaigns.reduce((n, c) => n + (c.conversions || 0), 0)
    return {
      spend,
      impressions,
      clicks,
      conversions,
      ctr: ctrPct(clicks, impressions),
      cvr: conversionRatePct(conversions, clicks),
    }
  }, [campaigns])

  const byCampaign = useMemo(
    () => [...campaigns].sort((a, b) => b.impressions - a.impressions).map((c) => ({
      id: c.id,
      name: c.name,
      impressions: c.impressions,
      clicks: c.clicks,
      conversions: c.conversions,
      spendCents: c.spendCents,
      ctr: ctrPct(c.clicks, c.impressions),
    })),
    [campaigns],
  )

  const byAudience = useMemo(() => {
    const map = new Map()
    for (const c of campaigns) {
      const k = c.audienceLabel || c.audienceId
      const row = map.get(k) || { id: k, name: k, impressions: 0, clicks: 0, spendCents: 0 }
      row.impressions += c.impressions || 0
      row.clicks += c.clicks || 0
      row.spendCents += c.spendCents || 0
      map.set(k, row)
    }
    return [...map.values()].sort((a, b) => b.impressions - a.impressions)
  }, [campaigns])

  const trend = useMemo(
    () =>
      [...campaigns]
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
        .slice(0, 8)
        .map((c) => ({ id: c.id, name: c.name, value: c.impressions || 0, display: (c.impressions || 0).toLocaleString('en-US') })),
    [campaigns],
  )

  return (
    <div className="adv-page">
      <AdvPageHead
        index="A3"
        label="Advertiser · Analytics"
        title="Delivery, efficiency, and mix."
        body="Every number comes straight from your campaigns. With no delivery yet, the charts stay empty rather than guessing."
      />
      <AdvError message={error} onRetry={onRetry} />
      {loading ? <AdvLoading /> : campaigns.length === 0 ? (
        <AdvEmpty
          mark="No delivery"
          title="No analytics yet"
          body="Analytics appear once campaigns exist and record delivery."
          actionLabel="Go to campaigns"
          to="/app/advertiser/campaigns"
        />
      ) : (
        <>
          <AdvStats
            items={[
              {
                label: 'Impressions',
                value: totals.impressions.toLocaleString('en-US'),
                hint: 'sponsored slots served',
                tone: totals.impressions > 0 ? 'live' : 'zero',
              },
              {
                label: 'Clicks',
                value: totals.clicks.toLocaleString('en-US'),
                hint: `CTR ${totals.ctr.toFixed(2)}%`,
                tone: totals.clicks > 0 ? 'live' : 'zero',
              },
              {
                label: 'CTR',
                value: `${totals.ctr.toFixed(2)}%`,
                hint: 'clicks / impressions',
                tone: totals.impressions > 0 ? 'plain' : 'zero',
              },
              {
                label: 'Conversion rate',
                value: `${totals.cvr.toFixed(2)}%`,
                hint: 'conversions / clicks',
                tone: totals.clicks > 0 ? 'plain' : 'zero',
              },
              {
                label: 'Conversions',
                value: totals.conversions.toLocaleString('en-US'),
                hint: 'reported actions',
                tone: totals.conversions > 0 ? 'plain' : 'zero',
              },
              {
                label: 'Spend',
                value: formatCents(totals.spend),
                hint: totals.spend > 0 ? 'recorded to date' : 'nothing spent yet',
                flag: totals.spend > 0 ? 'live' : 'idle',
                tone: totals.spend > 0 ? 'live' : 'zero',
              },
            ]}
          />
          <div className="adv-grid adv-grid--2">
            <section className="panel adv-panel" aria-label="Historical trend">
              <h4 className="adv-panel__title">Historical trend</h4>
              <p className="adv-panel__sub">Impressions in the order campaigns were created — zero means no delivery yet.</p>
              {trend.length === 0 ? (
                <AdvEmpty mark="No delivery" title="No trend yet" body="Charts appear once campaigns record impressions." />
              ) : (
                <AdvBarChart rows={trend} valueLabel="Impressions (count)" />
              )}
            </section>
            <section className="panel adv-panel" aria-label="Audience performance">
              <h4 className="adv-panel__title">Audience performance</h4>
              <p className="adv-panel__sub">Aggregated from the same campaign rows.</p>
              <div className="adv-tablewrap">
                <table className="adv-table">
                  <thead><tr><th>Audience</th><th>Impr.</th><th>Clicks</th><th>Spend</th></tr></thead>
                  <tbody>
                    {byAudience.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Audience">{r.name}</td>
                        <td className="mono" data-label="Impr.">{r.impressions.toLocaleString('en-US')}</td>
                        <td className="mono" data-label="Clicks">{r.clicks.toLocaleString('en-US')}</td>
                        <td className="mono" data-label="Spend">{formatCents(r.spendCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <section className="panel adv-panel" aria-label="Campaign performance">
            <h4 className="adv-panel__title">Campaign performance</h4>
            <div className="adv-tablewrap">
              <table className="adv-table">
                <thead><tr><th>Campaign</th><th>Impr.</th><th>Clicks</th><th>CTR</th><th>Conv.</th><th>Spend</th></tr></thead>
                <tbody>
                  {byCampaign.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Campaign">{c.name}</td>
                      <td className="mono" data-label="Impr.">{c.impressions.toLocaleString('en-US')}</td>
                      <td className="mono" data-label="Clicks">{c.clicks.toLocaleString('en-US')}</td>
                      <td className="mono" data-label="CTR">{c.ctr.toFixed(2)}%</td>
                      <td className="mono" data-label="Conv.">{c.conversions.toLocaleString('en-US')}</td>
                      <td className="mono" data-label="Spend">{formatCents(c.spendCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
