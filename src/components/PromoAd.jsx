import './PromoAd.css'

const PROMO_CAMPAIGNS = [
  {
    id: 'mech_01_advertiser_funding',
    sequence: '01 / 06',
    mark: 'MECH',
    headline: 'ADVERTISERS FUND THE NETWORK.',
    support:
      'Advertisers deposit budgets to campaign for developer attention. Their spend buys impressions in the reserved CLI slot — never in stdout, never in logs. Each impression is validated, counted, and attributed before the developer sees a cent.',
    cta: 'Read the funding model',
    href: '#advertiser',
    category: 'Mechanism',
  },
  {
    id: 'mech_02_developer_monetization',
    sequence: '02 / 06',
    mark: 'MECH',
    headline: 'DEVELOPERS INTEGRATE ONCE. EARN ON EVERY IMPRESSION.',
    support:
      'Drop the SDK into your CLI tool. No configuration, no maintenance. Every time a user runs a command and the sponsored slot renders, you earn. Revenue accrues per impression and settles automatically.',
    cta: 'See the integration',
    href: '#developer',
    category: 'Mechanism',
  },
  {
    id: 'mech_03_stdout_untouched',
    sequence: '03 / 06',
    mark: 'MECH',
    headline: 'STDOUT IS SACRED. THE SLOT LIVES OUTSIDE IT.',
    support:
      'CLIRevenue delivers ads in a dedicated UI region above the prompt — never injected into stdout, never written to logs, never contaminating scripts, pipelines, or CI output. Your terminal output stays clean. The ad is a surface, not a stream.',
    cta: 'See the delivery layer',
    href: '#experience',
    category: 'Mechanism',
  },
  {
    id: 'mech_04_delivery_validation',
    sequence: '04 / 06',
    mark: 'MECH',
    headline: 'EVERY IMPRESSION DELIVERED. EVERY IMPRESSION VALIDATED.',
    support:
      'The SDK requests an ad from the edge network. The edge responds with a signed payload — campaign ID, creative, timestamp, and a verification hash. The SDK renders the slot and posts a view event. No view, no payout. No hash, no trust.',
    cta: 'Inspect the payload',
    href: '#delivery',
    category: 'Mechanism',
  },
  {
    id: 'mech_05_reward_ledger',
    sequence: '05 / 06',
    mark: 'MECH',
    headline: 'FOUR PARTIES. ONE LOOP. ONE LEDGER.',
    support:
      'Each validated impression writes one row to the reward ledger: Advertiser (spend), Network (fee), Developer (payout), User (credit). The ledger is append-only, auditable, and the source of truth for every settlement. No black boxes.',
    cta: 'Open the ledger',
    href: '#rewards',
    category: 'Mechanism',
  },
  {
    id: 'mech_06_revenue_split',
    sequence: '06 / 06',
    mark: 'MECH',
    headline: 'THE SPLIT: 50 / 15 / 30 / 5.',
    support:
      'Of every dollar an advertiser spends: 50¢ goes to the developer who owns the CLI surface, 15¢ covers network operations and edge delivery, 30¢ returns to the user as redeemable credits, 5¢ stays with CLIRevenue as platform fee. The math is fixed. The ledger proves it.',
    cta: 'Verify the split',
    href: '#money',
    category: 'Mechanism',
  },
]

export function getPromoCampaign(index = 0) {
  return PROMO_CAMPAIGNS[index % PROMO_CAMPAIGNS.length]
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}

function PromoSlot({ index, variant, className, showMeta }) {
  const campaign = getPromoCampaign(index)

  return (
    <aside
      className={`promo-ad promo-ad--${variant}${className ? ` ${className}` : ''}`}
      aria-label="Sponsored message from CLIRevenue"
    >
      <div className="promo-ad__rail">
        <span className="promo-ad__badge">Sponsored</span>
        <span className="promo-ad__network">CLIRevenue // Network</span>
        <span className="promo-ad__sequence">{campaign.sequence}</span>
      </div>

      <div className="promo-ad__creative">
        <span className="promo-ad__logo" aria-hidden="true">
          {campaign.mark}
        </span>

        <div className="promo-ad__copy">
          <h4 className="promo-ad__headline">{campaign.headline}</h4>
          <p className="promo-ad__support">{campaign.support}</p>
          {showMeta ? (
            <p className="promo-ad__meta">
              <span className="promo-ad__advertiser">CLIRevenue</span>
              <span className="promo-ad__category">{campaign.category}</span>
            </p>
          ) : null}
        </div>

        <a className="promo-ad__cta" href={campaign.href}>
          {campaign.cta}
          <Arrow />
        </a>
      </div>
    </aside>
  )
}

export function PromoAd({ index = 0, variant = 'default', className = '' }) {
  return <PromoSlot index={index} variant={variant} className={className} showMeta />
}

export function PromoAdCompact({ index = 0, className = '' }) {
  return <PromoSlot index={index} variant="compact" className={className} showMeta={false} />
}

export function PromoAdInline({ index = 0, className = '' }) {
  return <PromoSlot index={index} variant="inline" className={className} showMeta />
}

export { PROMO_CAMPAIGNS }