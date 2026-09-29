/**
 * Demo data for the revenue product.
 *
 * Nothing here is a claim. Every number is a seeded simulation, every record
 * carries `simulated: true`, and no copy in this file asserts earnings,
 * pricing, reach, or performance for anything real.
 */

import { SIMULATED, toCents } from '../lib/economy.js';

/** Reward granted for one qualifying sponsored interaction (demo). */
export const REWARD_PER_INTERACTION_CENTS = 18;

/** How long an accrued reward stays pending before it becomes available. */
export const SETTLEMENT_MS = 5000;

/** Tick interval for the pending -> available settle pass. */
export const SETTLE_TICK_MS = 1000;

export const DEMO_ACCOUNT = {
  id: 'acct_demo_7fd2',
  handle: 'ada@northwind.dev',
  org: 'Northwind Labs',
  rail: 'demo-ledger',
  connected: false,
  simulated: SIMULATED,
};

export const AUDIENCES = [
  { id: 'backend', label: 'Backend & API', note: 'Node, Go, Rust, Postgres' },
  { id: 'frontend', label: 'Frontend & Web', note: 'React, TypeScript, CSS' },
  { id: 'devops', label: 'DevOps & Platform', note: 'CI, Kubernetes, observability' },
  { id: 'data', label: 'Data & ML', note: 'Pipelines, notebooks, model ops' },
  { id: 'oss', label: 'OSS maintainers', note: 'Public repos, 1k+ stars' },
];

/**
 * The seeded campaigns. Metrics are invented but internally consistent:
 * CTR = clicks / impressions, conversions <= clicks, spend <= budget.
 */
export const SEED_CAMPAIGNS = [
  {
    id: 'cmp_atlas',
    name: 'Atlas launch',
    advertiser: 'Meridian Works',
    brand: 'Atlas',
    category: 'Developer platform',
    disclosure: 'Demo',
    headline: 'Ship the gateway before lunch.',
    description:
      'Atlas turns a written spec into a running service with tests, migrations, and a deploy preview. Built for teams who review before they merge.',
    cta: 'Read the docs',
    audience: 'backend',
    budgetCents: toCents(2500),
    spendCents: toCents(1148.2),
    impressions: 48392,
    clicks: 1412,
    conversions: 87,
    status: 'active',
    simulated: SIMULATED,
  },
  {
    id: 'cmp_quill',
    name: 'Quill type search',
    advertiser: 'Quill Labs',
    brand: 'Quill',
    category: 'Search infrastructure',
    disclosure: 'Demo',
    headline: 'Search that understands your schema.',
    description:
      'Quill indexes migrations and types so answers cite the file they came from. No embeddings to tune, no vector bill.',
    cta: 'See how it works',
    audience: 'data',
    budgetCents: toCents(1800),
    spendCents: toCents(642.55),
    impressions: 31874,
    clicks: 744,
    conversions: 39,
    status: 'active',
    simulated: SIMULATED,
  },
  {
    id: 'cmp_beacon',
    name: 'Beacon on-call',
    advertiser: 'Beacon Relay',
    brand: 'Beacon',
    category: 'Incident response',
    disclosure: 'Demo',
    headline: 'Fewer pages. Better ones.',
    description:
      'Beacon groups related alerts into a single incident with the runbook already attached, so the right person is woken once.',
    cta: 'Start a trial',
    audience: 'devops',
    budgetCents: toCents(1200),
    spendCents: toCents(96.4),
    impressions: 6120,
    clicks: 98,
    conversions: 4,
    status: 'draft',
    simulated: SIMULATED,
  },
];

export const DEFAULT_CAMPAIGN_ID = 'cmp_atlas';

/** A believable agent run. The sponsored slot is anchored by `slotAfterIndex`. */
export const AGENT_RUN = {
  app: 'atlas',
  windowTitle: 'atlas — ~/projects/api-gateway',
  command: 'atlas --task "harden the /auth middleware"',
  typeMs: 1600,
  holdMs: 5600,
  lines: [
    { kind: 'rule' },
    { kind: 'kv', key: 'task', value: 'harden the /auth middleware' },
    { kind: 'kv', key: 'scope', value: 'src/middleware/**, tests/**' },
    { kind: 'rule' },
    { kind: 'step', text: 'Read task', tone: 'dim' },
    { kind: 'step', text: 'Plan: audit the middleware chain' },
    { kind: 'read', text: 'src/middleware/auth.js', meta: '142 lines' },
    { kind: 'read', text: 'src/routes/session.js', meta: '68 lines' },
    { kind: 'read', text: 'src/lib/tokens.js', meta: '91 lines' },
    { kind: 'step', text: 'Write: reject unknown `alg`, cap skew at 30s' },
    { kind: 'write', text: 'src/middleware/auth.js', meta: '+41 −12' },
    { kind: 'write', text: 'tests/auth.middleware.test.js', meta: '+86 −0' },
    { kind: 'rule' },
    { kind: 'run', text: 'vitest run tests/auth', meta: '14 passed  1.9s', tone: 'ok' },
    { kind: 'run', text: 'tsc --noEmit', meta: '0 errors', tone: 'ok' },
    { kind: 'slot' },
    { kind: 'rule' },
    { kind: 'step', text: 'Summary: 2 files changed, 14 tests passing' },
    { kind: 'muted', text: 'diff staged · review before merge' },
  ],
};

/**
 * The economic loop. Six steps, each one mapped to a record type that the
 * simulated ledger actually writes, so the rail can light up from live state
 * instead of from a hardcoded animation.
 */
export const ECONOMIC_LOOP = [
  {
    id: 'brief',
    index: '01',
    title: 'Advertiser pays for campaign',
    body: 'An advertiser writes a brief, picks a developer audience, and commits a budget. No card is charged in this build.',
    types: ['campaign'],
  },
  {
    id: 'ledger',
    index: '02',
    title: 'CLIRevenue records revenue',
    body: 'The committed budget lands on the platform ledger as campaign revenue, scoped to the campaign id.',
    types: ['revenue'],
  },
  {
    id: 'deliver',
    index: '03',
    title: 'Ad delivered in an AI workflow',
    body: 'The sponsored slot renders inside an otherwise empty region of a coding agent session, labelled as an ad.',
    types: ['delivery'],
  },
  {
    id: 'event',
    index: '04',
    title: 'Qualifying event recorded',
    body: 'An impression and, if the developer acts on it, an interaction are written against the campaign.',
    types: ['impression', 'interaction'],
  },
  {
    id: 'pending',
    index: '05',
    title: 'Reward becomes pending',
    body: 'The interaction mints a reward in accrued state. It is visible immediately and spendable never.',
    types: ['reward_accrued'],
  },
  {
    id: 'available',
    index: '06',
    title: 'Reward becomes available',
    body: 'After the settlement pass the reward flips to available and moves into the withdrawable balance.',
    types: ['reward_available'],
  },
];

/** Seeded ledger history so the loop and the wallet are never empty. */
export function seedLedger(campaigns) {
  const base = Date.now() - 1000 * 60 * 60 * 6;
  const events = [];
  let t = base;

  const push = (type, amountCents, label, detail) => {
    events.push({
      id: `led_seed_${events.length}`,
      type,
      amountCents,
      currency: 'USD',
      label,
      detail,
      at: (t += 1000 * 60 * 17),
      simulated: SIMULATED,
    });
  };

  for (const campaign of campaigns) {
    push('campaign', 0, `Campaign created · ${campaign.name}`, `${campaign.audience} audience`);
    push('revenue', campaign.budgetCents, `Budget committed · ${campaign.name}`, 'platform ledger');
    push('delivery', 0, `Slot approved · ${campaign.name}`, 'ai workflow inventory');
    push('impression', 0, `${campaign.impressions.toLocaleString('en-US')} impressions`, campaign.name);
    push('interaction', 0, `${campaign.clicks.toLocaleString('en-US')} interactions`, campaign.name);
  }

  return events;
}

/** Seeded reward history so lifetime earnings are not zero on first look. */
export function seedRewards() {
  const start = Date.now() - 1000 * 60 * 60 * 5;
  const rows = [
    { minutes: 288, amount: 18, status: 'available', campaign: 'cmp_atlas' },
    { minutes: 251, amount: 18, status: 'available', campaign: 'cmp_atlas' },
    { minutes: 214, amount: 18, status: 'available', campaign: 'cmp_quill' },
    { minutes: 176, amount: 18, status: 'available', campaign: 'cmp_atlas' },
    { minutes: 132, amount: 18, status: 'available', campaign: 'cmp_quill' },
    { minutes: 96, amount: 18, status: 'available', campaign: 'cmp_atlas' },
    { minutes: 41, amount: 18, status: 'available', campaign: 'cmp_atlas' },
    { minutes: 12, amount: 18, status: 'accrued', campaign: 'cmp_quill' },
  ];
  return rows.map((row, i) => {
    /* The still-pending row starts at "now" so the settle pass has
       something to move a few seconds after first paint, rather than
       clearing a stale row on the very first tick. */
    const at = row.status === 'accrued' ? Date.now() : start + row.minutes * 60000
    return {
      id: `rwd_seed_${i}`,
      accountId: DEMO_ACCOUNT.id,
      campaignId: row.campaign,
      amountCents: row.amount,
      status: row.status,
      at,
      settledAt: row.status === 'available' ? at + SETTLEMENT_MS : undefined,
      simulated: SIMULATED,
    }
  })
}
