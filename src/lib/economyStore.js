/**
 * Economy store.
 *
 * Same contract as `lib/cinemaStore.js`: plain module state, a snapshot that
 * is replaced rather than mutated, and a listener set. Nothing here imports
 * React — components bind with `useSyncExternalStore`.
 *
 * All money is integer cents. All records are simulated.
 */

import {
  PAYMENT_PROVIDERS,
  computeBalances,
  ledgerEvent,
  makeId,
  transaction,
} from './economy.js';
import {
  AUDIENCES,
  DEFAULT_CAMPAIGN_ID,
  DEMO_ACCOUNT,
  REWARD_PER_INTERACTION_CENTS,
  SEED_CAMPAIGNS,
  SETTLEMENT_MS,
  seedLedger,
  seedRewards,
} from '../data/economy.js';

function createSnapshot() {
  const campaigns = SEED_CAMPAIGNS.map((c) => ({ ...c }));
  const rewards = seedRewards();
  return {
    account: { ...DEMO_ACCOUNT },
    campaigns,
    activeCampaignId: DEFAULT_CAMPAIGN_ID,
    rewards,
    payouts: [],
    ledger: seedLedger(campaigns),
    impressionsRecorded: {},
    payoutDraft: { amountCents: 0, providerId: 'demo-ledger', open: false },
    lastEventId: null,
  };
}

let snapshot = createSnapshot();
let listeners = new Set();

function publish() {
  for (const listener of listeners) listener();
}

function replace(patch) {
  snapshot = { ...snapshot, ...patch };
  publish();
}

export function subscribeEconomy(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEconomySnapshot() {
  return snapshot;
}

function appendLedger(events) {
  return [...snapshot.ledger, ...events];
}

/* ------------------------------------------------------------------ *
 * connection
 * ------------------------------------------------------------------ */

export function connectAccount() {
  if (snapshot.account.connected) return;
  const at = Date.now();
  replace({
    account: { ...snapshot.account, connected: true, connectedAt: at },
    ledger: appendLedger([
      ledgerEvent({
        type: 'delivery',
        label: 'CLIRevenue connected',
        detail: `${snapshot.account.handle} · rewards armed`,
        at,
      }),
    ]),
  });
}

export function disconnectAccount() {
  if (!snapshot.account.connected) return;
  replace({
    account: { ...snapshot.account, connected: false },
    payoutDraft: { ...snapshot.payoutDraft, open: false, amountCents: 0 },
  });
}

/* ------------------------------------------------------------------ *
 * campaigns
 * ------------------------------------------------------------------ */

export function selectCampaign(id) {
  if (id === snapshot.activeCampaignId) return;
  if (!snapshot.campaigns.some((c) => c.id === id)) return;
  replace({ activeCampaignId: id });
}

/**
 * Mock campaign creation. Writes a campaign + a revenue ledger event and
 * makes the new campaign the one the workflow slot serves.
 * Returns the created campaign so the UI can link back to the workbench.
 */
export function createCampaign(input) {
  const now = Date.now();
  const audience = AUDIENCES.some((a) => a.id === input.audience)
    ? input.audience
    : AUDIENCES[0].id;
  const campaign = {
    id: makeId('cmp'),
    name: input.name?.trim() || 'Untitled campaign',
    headline: input.headline?.trim() || 'Your headline here.',
    description: input.description?.trim() || '',
    cta: input.cta?.trim() || 'Learn more',
    audience,
    budgetCents: input.budgetCents,
    spendCents: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    status: 'active',
    simulated: true,
    createdAt: now,
  };
  replace({
    campaigns: [...snapshot.campaigns, campaign],
    activeCampaignId: campaign.id,
    ledger: appendLedger([
      ledgerEvent({
        type: 'campaign',
        label: `Campaign created · ${campaign.name}`,
        detail: `${campaign.audience} audience · draft billing`,
        at: now,
      }),
      ledgerEvent({
        type: 'revenue',
        amountCents: campaign.budgetCents,
        label: `Budget committed · ${campaign.name}`,
        detail: 'platform ledger · not charged',
        at: now,
      }),
    ]),
    lastEventId: makeId('signal'),
  });
  return campaign;
}

export function getActiveCampaign(snap = snapshot) {
  return snap.campaigns.find((c) => c.id === snap.activeCampaignId) || snap.campaigns[0];
}

/* ------------------------------------------------------------------ *
 * delivery + qualifying events
 * ------------------------------------------------------------------ */

/** Called once per campaign when the sponsored slot actually renders. */
export function recordImpression(campaignId) {
  if (snapshot.impressionsRecorded[campaignId]) return;
  const now = Date.now();
  replace({
    impressionsRecorded: { ...snapshot.impressionsRecorded, [campaignId]: true },
    campaigns: snapshot.campaigns.map((c) =>
      c.id === campaignId ? { ...c, impressions: c.impressions + 1 } : c,
    ),
    ledger: appendLedger([
      ledgerEvent({
        type: 'impression',
        label: 'Sponsored slot rendered',
        detail: campaignLabel(campaignId),
        at: now,
      }),
    ]),
  });
}

/**
 * The advertiser-side truth: a click always records an interaction against
 * the campaign, whether or not a developer has connected a rewards account.
 */
export function recordInteraction(campaignId) {
  const now = Date.now();
  const campaigns = snapshot.campaigns.map((c) => {
    if (c.id !== campaignId) return c;
    const clicks = c.clicks + 1;
    // Demo conversion heuristic: one in four clicks converts.
    const conversions = clicks % 4 === 0 ? c.conversions + 1 : c.conversions;
    return { ...c, clicks, conversions, spendCents: c.spendCents + 10 };
  });
  const interactionId = makeId('int');
  replace({
    campaigns,
    ledger: appendLedger([
      ledgerEvent({
        type: 'impression',
        label: 'Interaction recorded',
        detail: `${campaignLabel(campaignId)} · ${interactionId}`,
        at: now,
      }),
    ]),
    lastEventId: interactionId,
  });
  return interactionId;
}

/**
 * The reward half of the path. Only runs when an account is connected —
 * an unconnected click still counts for the advertiser, it just earns nothing.
 */
export function accrueReward(campaignId, interactionId) {
  if (!snapshot.account.connected) return null;
  const now = Date.now();
  const reward = {
    id: makeId('rwd'),
    accountId: snapshot.account.id,
    campaignId,
    interactionId,
    amountCents: REWARD_PER_INTERACTION_CENTS,
    status: 'accrued',
    at: now,
    simulated: true,
  };
  replace({
    rewards: [...snapshot.rewards, reward],
    ledger: appendLedger([
      ledgerEvent({
        type: 'reward_accrued',
        amountCents: reward.amountCents,
        label: 'Reward pending',
        detail: `${campaignLabel(campaignId)} · settles in 5s`,
        at: now,
      }),
    ]),
  });
  return reward;
}

/** One full qualifying path, in the order the product documents it. */
export function recordQualifyingEvent(campaignId) {
  const interactionId = recordInteraction(campaignId);
  return accrueReward(campaignId, interactionId);
}

/**
 * Pending -> available. Driven by a single console-level interval so the
 * wallet, activity list, and ledger all move off one clock.
 */
export function settlePending(now = Date.now()) {
  const due = snapshot.rewards.filter(
    (r) => r.status === 'accrued' && now - r.at >= SETTLEMENT_MS,
  );
  if (!due.length) return 0;
  const dueIds = new Set(due.map((r) => r.id));
  replace({
    rewards: snapshot.rewards.map((r) =>
      dueIds.has(r.id) ? { ...r, status: 'available', settledAt: now } : r,
    ),
    ledger: appendLedger(
      due.map((r) =>
        ledgerEvent({
          type: 'reward_available',
          amountCents: r.amountCents,
          label: 'Reward available',
          detail: `${campaignLabel(r.campaignId)} · withdrawable`,
          at: now,
        }),
      ),
    ),
  });
  return due.length;
}

/* ------------------------------------------------------------------ *
 * payout — never moves money
 * ------------------------------------------------------------------ */

export function openPayoutDraft(amountCents, providerId) {
  replace({
    payoutDraft: {
      amountCents,
      providerId: PAYMENT_PROVIDERS.some((p) => p.id === providerId)
        ? providerId
        : 'demo-ledger',
      open: true,
    },
  });
}

export function closePayoutDraft() {
  if (!snapshot.payoutDraft.open) return;
  replace({ payoutDraft: { ...snapshot.payoutDraft, open: false } });
}

export function setPayoutProvider(providerId) {
  replace({ payoutDraft: { ...snapshot.payoutDraft, providerId } });
}

/**
 * Mock withdrawal. Writes a `payout` record in `requested` state plus the
 * matching `Transaction`. Nothing is authorised, nothing is settled.
 */
export function requestPayout() {
  const { amountCents, providerId } = snapshot.payoutDraft;
  const balances = economyBalances();
  if (!snapshot.account.connected || amountCents <= 0 || amountCents > balances.availableCents) {
    return null;
  }
  const now = Date.now();
  const payout = {
    id: makeId('pay'),
    accountId: snapshot.account.id,
    amountCents,
    providerId,
    status: 'requested',
    at: now,
    simulated: true,
  };
  replace({
    payouts: [...snapshot.payouts, payout],
    ledger: appendLedger([
      ledgerEvent({
        type: 'payout',
        amountCents,
        label: 'Payout requested',
        detail: `${providerLabel(providerId)} · demo rail, not sent`,
        at: now,
      }),
    ]),
    payoutDraft: { amountCents: 0, providerId: snapshot.payoutDraft.providerId, open: false },
    lastEventId: payout.id,
  });
  return {
    payout,
    transaction: transaction({
      type: 'payout',
      amountCents,
      providerId,
      status: 'requested',
      at: now,
    }),
  };
}

/* ------------------------------------------------------------------ *
 * selectors
 * ------------------------------------------------------------------ */

export function economyBalances() {
  return computeBalances(snapshot.rewards, snapshot.payouts);
}

export function rewardActivity(limit = 6) {
  const rows = [
    ...snapshot.rewards.map((r) => ({
      id: r.id,
      kind: 'reward',
      title: 'Sponsored interaction',
      meta: campaignLabel(r.campaignId),
      amountCents: r.amountCents,
      status: r.status,
      at: r.settledAt || r.at,
      simulated: r.simulated,
    })),
    ...snapshot.payouts.map((p) => ({
      id: p.id,
      kind: 'payout',
      title: 'Payout requested',
      meta: providerLabel(p.providerId),
      amountCents: -p.amountCents,
      status: p.status,
      at: p.at,
      simulated: p.simulated,
    })),
  ];
  return rows.sort((a, b) => b.at - a.at).slice(0, limit);
}

function campaignLabel(id) {
  const found = snapshot.campaigns.find((c) => c.id === id);
  return found ? found.name : 'Campaign';
}

function providerLabel(id) {
  const found = PAYMENT_PROVIDERS.find((p) => p.id === id);
  return found ? found.label : 'Demo ledger';
}

/** Full teardown — used by nothing in production, handy for the rig. */
export function resetEconomy() {
  snapshot = createSnapshot();
  publish();
}
