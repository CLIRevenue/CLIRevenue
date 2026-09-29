/**
 * Economy store - backed by real API calls to Supabase Edge Functions.
 * Maintains the same shape and function names as the mock store for compatibility.
 */

import { supabase } from './api.js'
import { SETTLEMENT_MS, SEED_CAMPAIGNS, DEFAULT_CAMPAIGN_ID } from '../data/economy.js'

// Base URL for our API endpoints (the Supabase Edge Functions)
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

/* Synchronous seed state: the console must render a real campaign on
   the very first frame (before any async init resolves), so the
   snapshot starts on the demo seed instead of an empty object that
   makes consumers read properties of undefined. */
let snapshot = {
  account: { id: '', email: '', connected: false },
  campaigns: SEED_CAMPAIGNS,
  activeCampaignId: DEFAULT_CAMPAIGN_ID,
  rewards: [],
  payouts: [],
  ledger: [],
  impressionsRecorded: {},
  payoutDraft: { amountCents: 0, providerId: 'demo-ledger', open: false },
  lastEventId: null,
}
let listeners = new Set()

// Initialize the store
async function initializeStore() {
  try {
    // Get session to set initial account state
    const { data: { session } } = await supabase.auth.getSession()
    
    // Fetch initial data if signed in; signed out keeps the demo seed
    const fetched = session ? await fetchCampaigns() : SEED_CAMPAIGNS
    // An empty list (API up but zero rows, or unreachable) must not
    // starve the ad surfaces — fall back to the demo seed.
    const campaigns = fetched && fetched.length ? fetched : SEED_CAMPAIGNS
    const activeCampaignId = session ? await fetchActiveCampaignId() : DEFAULT_CAMPAIGN_ID
    const rewards = session ? await fetchRewards() : []
    // For now, we'll keep payouts empty as we don't have a list endpoint
    const payouts = []
    const account = session ? await fetchAccount() : { id: '', email: '', connected: false }
    
    snapshot = {
      account,
      campaigns,
      activeCampaignId,
      rewards,
      payouts,
      // We'll keep these for compatibility but they are not used in the UI we saw
      ledger: [],
      impressionsRecorded: {},
      payoutDraft: { amountCents: 0, providerId: 'demo-ledger', open: false },
      lastEventId: null,
    }
  } catch (error) {
    console.error('Failed to initialize economy store:', error)
    // Set to empty state on error
    snapshot = {
      account: { id: '', email: '', connected: false },
      campaigns: SEED_CAMPAIGNS,
      activeCampaignId: DEFAULT_CAMPAIGN_ID,
      rewards: [],
      payouts: [],
      ledger: [],
      impressionsRecorded: {},
      payoutDraft: { amountCents: 0, providerId: 'demo-ledger', open: false },
      lastEventId: null,
    }
  }
  publish()
}

// Call initialize on load
initializeStore()

// Supabase auth change listener to refresh data when login/logout occurs
supabase.auth.onAuthStateChange(() => {
  initializeStore()
})

function publish() {
  for (const listener of listeners) listener()
}

function replace(patch) {
  // Accept either an object patch or a prev => next updater — callers
  // across the store use both, and spreading a function produced a
  // silently unchanged snapshot (counters never moved).
  const next = typeof patch === 'function' ? patch(snapshot) : patch
  snapshot = { ...snapshot, ...next }
  publish()
}

export function subscribeEconomy(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getEconomySnapshot() {
  return snapshot
}

/* ------------------------------------------------------------------ *
 * Connection (now using Supabase Auth)
 * ------------------------------------------------------------------ */

export function connectAccount() {
  // This is now handled by Supabase Auth session
  // We'll keep the function for compatibility but it will be a no-op
  // The actual connection is managed via auth state
  return
}

export function disconnectAccount() {
  // Similarly, sign out is handled elsewhere
  return
}

/* ------------------------------------------------------------------ *
 * Campaigns
 * ------------------------------------------------------------------ */

export function selectCampaign(id) {
  // Call API to set active campaign
  updateActiveCampaignInAPI(id)
    .then(() => {
      // Update snapshot after success
      replace({ activeCampaignId: id })
    })
    .catch(error => {
      console.error('Failed to select campaign:', error)
      // Optionally, show a notification to the user
    })
}

export function createCampaign(input) {
  // Transform input to match API expectations
  const campaignData = {
    name: input.name,
    headline: input.headline,
    description: input.description,
    cta: input.cta || 'Learn more',
    audience: input.audience,
    budgetCents: input.budgetCents,
  }
  
  createCampaignInAPI(campaignData)
    .then(createdCampaign => {
      // Add the new campaign to the snapshot
      replace(prev => ({
        campaigns: [...prev.campaigns, createdCampaign],
        activeCampaignId: createdCampaign.id,
      }))
    })
    .catch(error => {
      console.error('Failed to create campaign:', error)
    })
}

/* ------------------------------------------------------------------ *
 * Event tracking
 * ------------------------------------------------------------------ */

export function recordImpression(data) {
  const campaignId = typeof data === 'string' ? data : data?.campaign_id
  recordImpressionInAPI(
    typeof data === 'string' ? { campaign_id: data } : data,
  )
    .then(() => {
      // Update impressions count for the campaign
      replace(prev => ({
        campaigns: prev.campaigns.map(camp =>
          camp.id === campaignId
            ? { ...camp, impressions: (camp.impressions ?? 0) + 1 }
            : camp
        ),
      }))
    })
    .catch(error => {
      console.error('Failed to record impression:', error)
    })
}

export function recordQualifyingEvent(data) {
  // This function in the mock store just calls recordQualifyingEvent on the campaign id.
  // In the backend, we have recordInteraction which also accrues a reward.
  // We'll map recordQualifyingEvent to recordInteraction.
  const campaignId = typeof data === 'string' ? data : data?.campaign_id
  recordInteractionInAPI(
    typeof data === 'string' ? { campaign_id: data } : data,
  )
    .then(result => {
      // Update clicks count and add reward to snapshot
      const accrued = result?.reward_accrued
      replace(prev => ({
        campaigns: prev.campaigns.map(camp =>
          camp.id === campaignId
            ? { ...camp, clicks: (camp.clicks ?? 0) + 1 }
            : camp
        ),
        // Add the new reward to the rewards list
        rewards: accrued
          ? [...prev.rewards, {
              id: accrued.id,
              campaignId: accrued.campaign_id,
              amountCents: accrued.amount_cents,
              status: accrued.status,
              createdAt: accrued.created_at,
              settledAt: accrued.settled_at,
            }]
          : prev.rewards,
      }))
    })
    .catch(error => {
      console.error('Failed to record qualifying event:', error)
    })
}

/* ------------------------------------------------------------------ *
 * Rewards and balance
 * ------------------------------------------------------------------ */

export function economyBalances() {
  // Compute from the snapshot's rewards and payouts
  const available = snapshot.rewards
    .filter(r => r.status === 'available')
    .reduce((sum, r) => sum + r.amountCents, 0)
  const pending = snapshot.rewards
    .filter(r => r.status === 'accrued')
    .reduce((sum, r) => sum + r.amountCents, 0)
  const lifetime = snapshot.rewards.reduce((sum, r) => sum + r.amountCents, 0)
  const reserved = snapshot.payouts.reduce((sum, p) => sum + p.amountCents, 0) // Assuming payouts have amountCents
  
  return {
    availableCents: available,
    pendingCents: pending,
    lifetimeCents: lifetime,
    reservedCents: reserved,
  }
}

/* Activity-row labels for the console. */
function getCampaignNameById(id) {
  const found = (snapshot.campaigns || []).find((c) => c.id === id)
  return found ? found.name : 'Campaign'
}

function getProviderLabel(id) {
  if (!id || id === 'demo-ledger') return 'Demo ledger'
  return String(id)
}

export function getActiveCampaign(snap = snapshot) {
  return (
    (snap.campaigns || []).find((c) => c.id === snap.activeCampaignId) ||
    (snap.campaigns || [])[0]
  )
}

/**
 * Pending -> available. Driven by the single console-level interval
 * (Console.jsx) so wallet, activity list and ledger move off one
 * clock — a local settlement simulation against SETTLEMENT_MS.
 */
export function settlePending(now = Date.now()) {
  const due = (snapshot.rewards || []).filter(
    (r) =>
      r.status === 'accrued' &&
      now - Date.parse(r.createdAt || 0) >= SETTLEMENT_MS,
  )
  if (!due.length) return 0
  const dueIds = new Set(due.map((r) => r.id))
  replace((prev) => ({
    rewards: prev.rewards.map((r) =>
      dueIds.has(r.id)
        ? { ...r, status: 'available', settledAt: new Date(now).toISOString() }
        : r,
    ),
  }))
  return due.length
}

export function rewardActivity(limit = 6) {
  const rows = [
    ...snapshot.rewards.map(r => ({
      id: r.id,
      kind: 'reward',
      title: 'Sponsored interaction',
      meta: getCampaignNameById(r.campaignId),
      amountCents: r.amountCents,
      status: r.status,
      at: r.createdAt,
      simulated: false,
    })),
    ...snapshot.payouts.map(p => ({
      id: p.id,
      kind: 'payout',
      title: 'Payout requested',
      meta: getProviderLabel(p.providerId),
      amountCents: -p.amountCents,
      status: p.status,
      at: p.createdAt,
      simulated: false,
    })),
  ]
  return rows.sort((a, b) => b.at - a.at).slice(0, limit)
}

/* ------------------------------------------------------------------ *
 * Payout draft (mock functions)
 * ------------------------------------------------------------------ */

export function openPayoutDraft(amountCents, providerId) {
  replace({ payoutDraft: { amountCents, providerId, open: true } })
}

export function closePayoutDraft() {
  replace({ payoutDraft: { ...snapshot.payoutDraft, open: false } })
}

export function setPayoutProvider(providerId) {
  replace({ payoutDraft: { ...snapshot.payoutDraft, providerId } })
}

export function requestPayout() {
  const { amountCents, providerId } = snapshot.payoutDraft
  const balances = economyBalances()
  
  // Check if connected (we'll rely on the API to check auth, but we can do a quick check)
  if (!snapshot.account.connected || amountCents <= 0 || amountCents > balances.availableCents) {
    return null
  }
  
  // We'll return a temporary object immediately and update the snapshot after the API call
  const tempId = `temp_${Date.now()}`
  const pendingPayout = {
    id: tempId,
    accountId: snapshot.account.id,
    amountCents,
    providerId,
    status: 'requested',
    at: Date.now(),
    simulated: true,
  }
  const pendingTransaction = {
    id: `txn_${tempId}`,
    type: 'payout',
    amountCents,
    providerId,
    status: 'requested',
    at: Date.now(),
    simulated: true,
  }
  
  // Update the snapshot optimistically
  replace(prev => ({
    payouts: [...prev.payouts, pendingPayout],
    payoutDraft: { amountCents: 0, providerId: prev.payoutDraft.providerId, open: false },
  }))
  
  // Now make the API call to persist it
  requestPayoutInAPI({ amountCents, providerId })
    .then(result => {
      // Replace the temporary payout with the real one
      replace(prev => ({
        payouts: prev.payouts.map(p => 
          p.id === tempId ? result.payout : p
        ),
        // We don't store transactions in the snapshot, so we don't need to update them here.
        // The ledger will be updated via a separate mechanism? We don't have a ledger endpoint.
        // We'll add a ledger event for the payout if we had a ledger endpoint, but we don't.
        // For now, we'll leave the ledger as is.
      }))
    })
    .catch(error => {
      console.error('Failed to request payout:', error)
      // Rollback the optimistic update
      replace(prev => ({
        payouts: prev.payouts.filter(p => p.id !== tempId),
        payoutDraft: { ...prev.payoutDraft, open: false },
      }))
    })
  
  // Return the pending object to match the mock store's return value
  return {
    payout: pendingPayout,
    transaction: pendingTransaction,
  }
}

/* ------------------------------------------------------------------ *
 * Helper functions to fetch data from API
 * ------------------------------------------------------------------ */

async function fetchCampaigns() {
  try {
    const payload = await apiGetCampaigns()
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.campaigns)
        ? payload.campaigns
        : []
    // The edge function already speaks camelCase (budgetCents,
    // impressions, clicks, conversions); snake_case rows are accepted
    // too so either API shape lands intact.
    return rows.map(c => ({
      id: c.id,
      name: c.name,
      headline: c.headline,
      description: c.description,
      cta: c.cta,
      audience: c.audience,
      brand: c.brand,
      disclosure: c.disclosure,
      category: c.category,
      advertiser: c.advertiser,
      budgetCents: c.budgetCents ?? c.budget_cents ?? 0,
      spendCents:
        c.spendCents ??
        (typeof c.spend_milli_cents === 'number'
          ? Math.floor(c.spend_milli_cents / 1000)
          : 0),
      impressions: c.impressions ?? c.impressions_count ?? 0,
      clicks: c.clicks ?? c.clicks_count ?? 0,
      conversions: c.conversions ?? c.conversions_count ?? 0,
      status: c.status,
      simulated: c.simulated ?? false,
    }))
  } catch (error) {
    // A failed fetch must never wipe the store: the console keeps its
    // campaign list (the app's demo seed) so the ad surfaces stay
    // rendered instead of the tree crashing on an empty list.
    console.error('Failed to fetch campaigns:', error)
    return SEED_CAMPAIGNS
  }
}

async function fetchActiveCampaignId() {
  try {
    const active = await apiGetActiveCampaign()
    return active?.id ?? active?.campaign?.id ?? null
  } catch (error) {
    // If no active campaign is set, the API returns 404
    if (error.message.includes('404')) {
      return null
    }
    // Unreachable API: fall back to the seeded default so consumers
    // resolve a real campaign instead of undefined.
    console.error('Failed to fetch active campaign:', error)
    return DEFAULT_CAMPAIGN_ID
  }
}

async function fetchRewards() {
  try {
    const rewards = await apiGetRewards()
    return rewards.map(r => ({
      id: r.id,
      campaignId: r.campaign_id,
      amountCents: r.amount_cents,
      status: r.status,
      createdAt: r.created_at,
      settledAt: r.settled_at,
      simulated: false,
    }))
  } catch (error) {
    console.error('Failed to fetch rewards:', error)
    return []
  }
}

async function fetchAccount() {
  try {
    const status = await apiGetAuthStatus()
    if (status.connected) {
      const { data: { user } } = await supabase.auth.getUser()
      return {
        id: user.id,
        email: user.email,
        org: 'Demo Org', // We don't have this from auth; we'll hardcode for now
        handle: user.email,
        connected: true,
      }
    }
    return { id: '', email: '', connected: false }
  } catch (error) {
    console.error('Failed to get account info:', error)
    return { id: '', email: '', connected: false }
  }
}

/* ------------------------------------------------------------------ *
 * API wrapper functions
 * ------------------------------------------------------------------ */

async function apiGetCampaigns() {
  return await apiRequest('/api/campaigns')
}

async function apiGetActiveCampaign() {
  return await apiRequest('/api/active-campaign')
}

async function apiGetRewards() {
  return await apiRequest('/api/rewards')
}

async function apiGetAuthStatus() {
  return await apiRequest('/api/auth/status')
}

async function updateActiveCampaignInAPI(id) {
  return await apiRequest(`/api/campaigns/${id}/select`, {
    method: 'POST',
  })
}

async function createCampaignInAPI(campaignData) {
  return await apiRequest('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(campaignData),
  })
}

async function recordImpressionInAPI(data) {
  return await apiRequest('/api/events/impression', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function recordInteractionInAPI(data) {
  return await apiRequest('/api/events/interaction', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function requestPayoutInAPI(data) {
  return await apiRequest('/api/payouts/request', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// Generic API request function
async function apiRequest(endpoint, options = {}) {
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  })
  
  if (!response.ok) {
    let errorMessage
    try {
      const errorData = await response.json()
      errorMessage = errorData.error?.message || errorData.message || 'Unknown error'
    } catch {
      errorMessage = response.statusText
    }
    throw new Error(`API error: ${response.status} - ${errorMessage}`)
  }
  
  return response.json()
}