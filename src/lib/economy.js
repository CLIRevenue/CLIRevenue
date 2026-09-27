/**
 * Provider-agnostic economy primitives.
 *
 * Everything a real integration will need already exists here as data
 * structures, so swapping the simulated rail for a payment provider later
 * means filling in one adapter — not rewriting the console.
 *
 * Rules held across the whole module:
 *   - money is an integer number of CENTS. Never a float.
 *   - nothing here talks to the network, the DOM, or React.
 *   - every record carries `simulated: true` so no consumer can mistake a
 *     demo figure for a live one.
 */

/**
 * @typedef {'card'|'bank'|'wallet'|'ledger'} PaymentProviderKind
 *
 * @typedef {Object} PaymentProvider
 * @property {string} id
 * @property {string} label
 * @property {PaymentProviderKind} kind
 * @property {boolean} live        always false in this build
 * @property {string} status       human readable availability text
 *
 * @typedef {Object} Transaction
 * @property {string} id
 * @property {'campaign_spend'|'payout'} type
 * @property {number} amountCents
 * @property {string} currency
 * @property {string} providerId
 * @property {'pending'|'settled'|'requested'|'declined'} status
 * @property {boolean} simulated
 * @property {number} at           epoch ms
 *
 * @typedef {'campaign'|'revenue'|'delivery'|'impression'|'interaction'|'reward_accrued'|'reward_available'|'payout'} LedgerType
 *
 * @typedef {Object} RewardLedgerEvent
 * @property {string} id
 * @property {LedgerType} type
 * @property {number} amountCents  0 for non-monetary events
 * @property {string} currency
 * @property {string} label        short display string
 * @property {string} [detail]     one line of context
 * @property {number} at
 * @property {boolean} simulated
 *
 * @typedef {Object} Campaign
 * @property {string} id
 * @property {string} name
 * @property {string} headline
 * @property {string} description
 * @property {string} cta
 * @property {string} audience
 * @property {number} budgetCents
 * @property {number} spendCents
 * @property {number} impressions
 * @property {number} clicks
 * @property {number} conversions
 * @property {'active'|'paused'|'draft'} status
 * @property {boolean} simulated
 *
 * @typedef {Object} Impression
 * @property {string} id
 * @property {string} campaignId
 * @property {number} at
 * @property {boolean} simulated
 *
 * @typedef {Object} Interaction
 * @property {string} id
 * @property {string} campaignId
 * @property {string} [impressionId]
 * @property {'click'} kind
 * @property {number} at
 * @property {boolean} simulated
 *
 * @typedef {Object} Reward
 * @property {string} id
 * @property {string} accountId
 * @property {string} campaignId
 * @property {string} [interactionId]
 * @property {number} amountCents
 * @property {'accrued'|'available'} status
 * @property {number} at            when it accrued
 * @property {number} [settledAt]   when it became available
 * @property {boolean} simulated
 *
 * @typedef {Object} Payout
 * @property {string} id
 * @property {string} accountId
 * @property {number} amountCents
 * @property {string} providerId
 * @property {'requested'|'processing'|'sent'} status
 * @property {number} at
 * @property {boolean} simulated
 *
 * @typedef {Object} DemoAccount
 * @property {string} id
 * @property {string} handle
 * @property {PaymentProviderKind} rail
 * @property {boolean} connected
 * @property {boolean} simulated
 */

/** Every figure rendered anywhere in this product is demo data. */
export const SIMULATED = true;

/** Payout rails the mock flow can select. None of them settle. */
/** @type {PaymentProvider[]} */
export const PAYMENT_PROVIDERS = [
  {
    id: 'demo-ledger',
    label: 'Demo ledger',
    kind: 'ledger',
    live: false,
    status: 'Built in · no account needed',
  },
  {
    id: 'card-stub',
    label: 'Card (stub)',
    kind: 'card',
    live: false,
    status: 'Interface only · never charged',
  },
  {
    id: 'bank-stub',
    label: 'Bank transfer (stub)',
    kind: 'bank',
    live: false,
    status: 'Interface only · never debited',
  },
  {
    id: 'wallet-stub',
    label: 'Wallet (stub)',
    kind: 'wallet',
    live: false,
    status: 'Interface only · never funded',
  },
];

export const CURRENCY = 'USD';

let counter = 0;

/** Stable, collision-free id for locally created records. */
export function makeId(prefix = 'evt') {
  counter += 1;
  return `${prefix}_${counter.toString(36)}${Date.now().toString(36).slice(-4)}`;
}

/** dollars (float, for display input only) -> integer cents */
export function toCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

/** integer cents -> dollars (number) */
export function fromCents(cents) {
  return cents / 100;
}

/**
 * Integer cents -> a plain display string.
 * `$1,148.20` — no locale surprises, no floats leaking into the DOM.
 */
export function formatMoney(cents, { sign = false, currency = CURRENCY } = {}) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const body = `${Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(abs % 100).toString().padStart(2, '0')}`;
  const symbol = currency === 'USD' ? '$' : '';
  const prefix = negative ? '-' : sign ? '+' : '';
  return `${prefix}${symbol}${body}`;
}

/** Whole-dollar budget input -> cents, clamped to something sane. */
export function parseBudget(input, fallbackCents) {
  const parsed = Number(String(input).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackCents;
  return Math.min(toCents(parsed), 100_000_00);
}

export function percent(value, digits = 2) {
  if (!Number.isFinite(value)) return '0.00%';
  return `${value.toFixed(digits)}%`;
}

/** click-through rate, as a percentage */
export function ctr(clicks, impressions) {
  if (!impressions) return 0;
  return (clicks / impressions) * 100;
}

/** conversion rate against clicks, as a percentage */
export function cvr(conversions, clicks) {
  if (!clicks) return 0;
  return (conversions / clicks) * 100;
}

/** Derive the advertiser-facing numbers from the campaign itself. */
export function campaignMetrics(campaign) {
  return {
    budgetCents: campaign.budgetCents,
    spendCents: campaign.spendCents,
    impressions: campaign.impressions,
    engagement: campaign.clicks,
    ctr: ctr(campaign.clicks, campaign.impressions),
    conversions: campaign.conversions,
    cvr: cvr(campaign.conversions, campaign.clicks),
    remainingCents: Math.max(0, campaign.budgetCents - campaign.spendCents),
    delivery: campaign.budgetCents
      ? Math.min(100, (campaign.spendCents / campaign.budgetCents) * 100)
      : 0,
  };
}

/**
 * Balances are always derived, never stored — a stored total drifts from the
 * ledger the moment anything is added.
 *
 * available = settled rewards - payouts already requested
 * pending   = rewards still accruing
 */
export function computeBalances(rewards = [], payouts = []) {
  const available = rewards
    .filter((r) => r.status === 'available')
    .reduce((sum, r) => sum + r.amountCents, 0);
  const pending = rewards
    .filter((r) => r.status === 'accrued')
    .reduce((sum, r) => sum + r.amountCents, 0);
  const reserved = payouts.reduce((sum, p) => sum + p.amountCents, 0);
  const lifetime = rewards.reduce((sum, r) => sum + r.amountCents, 0);
  return {
    availableCents: Math.max(0, available - reserved),
    pendingCents: pending,
    lifetimeCents: lifetime,
    reservedCents: reserved,
  };
}

/** Build a ledger event. Every step of the loop goes through here. */
export function ledgerEvent({ type, amountCents = 0, label, detail, at = Date.now(), currency = CURRENCY }) {
  return {
    id: makeId('led'),
    type,
    amountCents,
    currency,
    label,
    detail,
    at,
    simulated: SIMULATED,
  };
}

/** Same shape a real payment provider adapter would hand back. */
export function transaction({ type, amountCents, providerId, status = 'pending', at = Date.now() }) {
  return {
    id: makeId('txn'),
    type,
    amountCents,
    currency: CURRENCY,
    providerId,
    status,
    simulated: SIMULATED,
    at,
  };
}
