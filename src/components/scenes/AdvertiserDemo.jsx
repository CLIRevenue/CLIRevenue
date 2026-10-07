import { useSceneProgress } from '../../hooks/useSceneProgress.js'
import { useTerminal } from '../../hooks/useTerminal.js'
import { advertiserDemoScene, hostApp } from '../../data/demo.js'
import Terminal from '../Terminal.jsx'
import OutputStream from '../OutputStream.jsx'
import { PromoAd } from '../PromoAd.jsx'
import Scene from '../Scene.jsx'
import './AdvertiserDemo.css'

const SCRIPT = {
  command: advertiserDemoScene.command,
  lines: advertiserDemoScene.output,
  spans: { type: [0.02, 0.24], stream: [0.28, 0.66], settle: [0.66, 1] },
}

function AdvertiserDemo() {
  const progress = useSceneProgress('advertiserDemo')
  const frame = useTerminal(SCRIPT, progress)

  return (
    <Scene
      id="advertiserDemo"
      label={advertiserDemoScene.eyebrow}
      title="The advertiser writes the brief. The campaign lands in a real session."
      body="Campaign records, budget commit, delivery metrics — all simulated, all moving against the same ledger the developer's wallet reads from."
    >
      <Terminal
        title={hostApp.windowTitle}
        live
        outHeight="tall"
        frame={frame}
        slot="ad"
        foot="demo advertiser console · simulated figures"
        hint="campaign brief → live slot"
      >
        <OutputStream lines={frame.lines} />
        <AdvertiserDemoSlot campaign={advertiserDemoScene.campaign} />
        <PromoAd index={0} variant="compact" />
      </Terminal>

      <ul className="advertiser-demo__annotations" aria-label="Campaign metrics">
        {advertiserDemoScene.annotations.map((item, i) => (
          <li key={item.label} className="advertiser-demo__annotation">
            <span className="advertiser-demo__index">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="advertiser-demo__label">{item.label}</span>
            <span className="advertiser-demo__value">{item.value}</span>
          </li>
        ))}
      </ul>

      <div className="advertiser-demo__split">
        <CampaignList campaigns={advertiserDemoScene.campaigns} />
        <DeliveryActivity activity={advertiserDemoScene.activity} />
      </div>

      <CampaignWorkflow workflow={advertiserDemoScene.workflow} />
      <LedgerReaders ledger={advertiserDemoScene.ledger} />
    </Scene>
  )
}

function CampaignList({ campaigns }) {
  return (
    <section className="advertiser-demo__board" aria-label="Campaign list">
      <header className="advertiser-demo__board-head">
        <h4 className="advertiser-demo__board-title">Campaigns</h4>
        <span className="advertiser-demo__board-count">
          {campaigns.length} total · {campaigns.filter((c) => c.status === 'active').length} delivering
        </span>
      </header>

      <div className="advertiser-demo__table" role="table" aria-label="Advertiser campaigns">
        <div className="advertiser-demo__tr advertiser-demo__th" role="row">
          <span role="columnheader">Campaign</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Audience</span>
          <span role="columnheader">Spend / budget</span>
          <span role="columnheader">Impr.</span>
          <span role="columnheader">CTR</span>
        </div>

        {campaigns.map((c) => (
          <div
            key={c.id}
            className="advertiser-demo__tr advertiser-demo__td"
            role="row"
            data-status={c.status}
          >
            <span className="advertiser-demo__cell advertiser-demo__cell--name" role="cell">
              <span className="advertiser-demo__cell-strong">{c.name}</span>
              <span className="advertiser-demo__cell-sub">
                {c.advertiser} · {c.category}
              </span>
            </span>
            <span className="advertiser-demo__cell" role="cell">
              <span className="advertiser-demo__status-indicator" data-status={c.status}>
                <span className="advertiser-demo__status-dot" aria-hidden="true" />
                {c.status}
              </span>
            </span>
            <span className="advertiser-demo__cell advertiser-demo__cell--muted" role="cell">
              {c.audienceLabel}
            </span>
            <span className="advertiser-demo__cell" role="cell">
              <span className="advertiser-demo__cell-strong">
                {c.spend} <span className="advertiser-demo__cell-sub">/ {c.budget}</span>
              </span>
              <span className="advertiser-demo__bar" aria-hidden="true">
                <span className="advertiser-demo__bar-fill" style={{ width: `${Math.min(c.fill, 100)}%` }} />
              </span>
            </span>
            <span className="advertiser-demo__cell advertiser-demo__cell--num" role="cell">
              {c.impressions}
            </span>
            <span className="advertiser-demo__cell advertiser-demo__cell--num" role="cell">
              {c.ctr}
            </span>
          </div>
        ))}
      </div>

      <p className="advertiser-demo__board-foot">
        Every row above is simulated. Budget bars show committed spend against the
        campaign's ceiling — the same relationship the real console reports.
      </p>
    </section>
  )
}

function DeliveryActivity({ activity }) {
  return (
    <section className="advertiser-demo__board" aria-label="Delivery activity">
      <header className="advertiser-demo__board-head">
        <h4 className="advertiser-demo__board-title">Delivery activity</h4>
        <span className="advertiser-demo__board-live">
          <span className="advertiser-demo__status-dot" aria-hidden="true" />
          streaming
        </span>
      </header>

      <ul className="advertiser-demo__feed">
        {activity.map((a) => (
          <li key={a.id} className="advertiser-demo__feed-row">
            <span className="advertiser-demo__feed-time">{a.time}</span>
            <span className="advertiser-demo__feed-event">{a.event}</span>
            <span className="advertiser-demo__feed-campaign">{a.campaign}</span>
            <span className="advertiser-demo__feed-detail">{a.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CampaignWorkflow({ workflow }) {
  return (
    <section className="advertiser-demo__flow" aria-label="Campaign workflow">
      <h4 className="advertiser-demo__board-title">Brief to report</h4>
      <ol className="advertiser-demo__flow-track">
        {workflow.map((step, i) => (
          <li key={step.id} className="advertiser-demo__flow-step">
            <span className="advertiser-demo__flow-index" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="advertiser-demo__flow-label">{step.label}</span>
            <span className="advertiser-demo__flow-note">{step.note}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function LedgerReaders({ ledger }) {
  return (
    <section className="advertiser-demo__ledger" aria-label={ledger.label}>
      <h4 className="advertiser-demo__board-title">{ledger.label}</h4>
      <p className="advertiser-demo__ledger-body">
        One impression writes once. Each party reads a different column of that
        same entry — nothing is reconciled between dashboards.
      </p>
      <ul className="advertiser-demo__ledger-track">
        {ledger.rows.map((row) => (
          <li key={row.party} className="advertiser-demo__ledger-step" data-tone={row.tone}>
            <span className="advertiser-demo__ledger-party">{row.party}</span>
            <span className="advertiser-demo__ledger-read">{row.read}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AdvertiserDemoSlot({ campaign }) {
  const metrics = advertiserDemoScene.metrics

  return (
    <div className="advertiser-demo__slot" role="region" aria-label="Campaign preview">
      <div className="advertiser-demo__plate">
        <div className="advertiser-demo__rail">
          <span className="advertiser-demo__badge">SPONSORED</span>
          <span className="advertiser-demo__network">CLIREVENUE // NETWORK</span>
          <span className="advertiser-demo__sequence">01 / 07</span>
        </div>

        <div className="advertiser-demo__creative">
          <div className="advertiser-demo__logo" aria-hidden="true">
            {campaign.brand.charAt(0)}
          </div>
          <div className="advertiser-demo__copy">
            <h4 className="advertiser-demo__headline">{campaign.headline}</h4>
            <p className="advertiser-demo__support">{campaign.description}</p>
            <div className="advertiser-demo__meta">
              <span className="advertiser-demo__advertiser">{campaign.advertiser}</span>
              <span className="advertiser-demo__category">{campaign.category}</span>
            </div>
          </div>
          <a className="advertiser-demo__cta" href="#money">
            {campaign.cta}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </div>

        <div className="advertiser-demo__metrics">
          <div className="advertiser-demo__metric">
            <span className="advertiser-demo__metric-label">Budget</span>
            <span className="advertiser-demo__metric-value">{metrics.budget}</span>
          </div>
          <div className="advertiser-demo__metric">
            <span className="advertiser-demo__metric-label">Spend</span>
            <span className="advertiser-demo__metric-value">{metrics.spend}</span>
          </div>
          <div className="advertiser-demo__metric">
            <span className="advertiser-demo__metric-label">Impressions</span>
            <span className="advertiser-demo__metric-value">{metrics.impressions}</span>
          </div>
          <div className="advertiser-demo__metric">
            <span className="advertiser-demo__metric-label">CTR</span>
            <span className="advertiser-demo__metric-value">{metrics.ctr}</span>
          </div>
          <div className="advertiser-demo__metric">
            <span className="advertiser-demo__metric-label">Conversions</span>
            <span className="advertiser-demo__metric-value">{metrics.conversions}</span>
          </div>
        </div>

        <div className="advertiser-demo__status-bar">
          <span className="advertiser-demo__status-indicator" data-status={campaign.status}>
            <span className="advertiser-demo__status-dot" aria-hidden="true" />
            {campaign.status.toUpperCase()}
          </span>
          <span className="advertiser-demo__audience">{campaign.audienceLabel}</span>
        </div>
      </div>

      <p className="advertiser-demo__disclosure">
        This is the advertiser's creative preview, rendered locally in the console. Campaigns shown here are simulated — the delivery is not: the sponsored slot in the workbench above is served by the CLIRevenue SDK and its impressions are counted.
      </p>
    </div>
  )
}

export default AdvertiserDemo