import './PromoAd.css'

const PROMO_CAMPAIGNS = [
  {
    id: 'promo_clirevenue_01',
    sequence: '01 / 07',
    mark: 'CLIREV',
    headline: 'YOUR CLI HAS ATTENTION. MAKE IT PAY.',
    support:
      'Developers spend hours inside terminal sessions. Advertisers reach them where they actually work — above the command line, in a reserved slot.',
    cta: 'See the slot',
    href: '#workbench',
    category: 'Ad network',
  },
  {
    id: 'promo_clirevenue_02',
    sequence: '02 / 07',
    mark: 'CLIREV',
    headline: 'REACH DEVELOPERS WHERE THEY WORK.',
    support:
      'No banner blindness here. The slot sits between stdout and the prompt — the one region every CLI user sees, every session.',
    cta: 'See the delivery',
    href: '#experience',
    category: 'Ad network',
  },
  {
    id: 'promo_clirevenue_03',
    sequence: '03 / 07',
    mark: 'CLIREV',
    headline: 'YOUR TERMINAL. YOUR AUDIENCE. YOUR REVENUE.',
    support:
      'Integrate the SDK once. Every sponsored impression splits four ways — advertiser, network, developer, user. No configuration, no maintenance.',
    cta: 'See the split',
    href: '#money',
    category: 'Ad network',
  },
  {
    id: 'promo_clirevenue_04',
    sequence: '04 / 07',
    mark: 'CLIREV',
    headline: 'THE AD NETWORK THAT RESPECTS STDOUT.',
    support:
      'Output is sacred. CLIRevenue delivers ads in a dedicated UI region — never in stdout, never in logs, never contaminating scripts or pipelines.',
    cta: 'See the wait',
    href: '#wait',
    category: 'Ad network',
  },
  {
    id: 'promo_clirevenue_05',
    sequence: '05 / 07',
    mark: 'CLIREV',
    headline: 'FOUR PARTIES. ONE LOOP. SHARED REVENUE.',
    support:
      'Advertiser budgets → CLIRevenue delivers → Developer integrates → User sees the ad. Every impression moves through the same four-party split.',
    cta: 'See the loop',
    href: '#loop',
    category: 'Ad network',
  },
  {
    id: 'promo_clirevenue_06',
    sequence: '06 / 07',
    mark: 'CLIREV',
    headline: 'DEMO MODE. NO BILLING. REAL DELIVERY.',
    support:
      'Campaigns shown here are simulated — the delivery is not. The sponsored slot in the workbench is served by the CLIRevenue SDK and its impressions are counted.',
    cta: 'See the rewards',
    href: '#rewards',
    category: 'Ad network',
  },
  {
    id: 'promo_clirevenue_07',
    sequence: '07 / 07',
    mark: 'CLIREV',
    headline: 'TURN TERMINAL ATTENTION INTO SHARED REVENUE.',
    support:
      'The whole thesis, delivered as a native ad. Developers have attention. Advertisers want it. CLIRevenue connects them — with a reserved slot and a fair split.',
    cta: 'See the advertiser view',
    href: '#advertiserDemo',
    category: 'Ad network',
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