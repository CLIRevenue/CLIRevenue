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
 * Campaigns (real backend URLs)
 * ------------------------------------------------------------------ */

/**
 * Candidates for a campaigns-edge-function URL.
 * The Supabase gateway strips /functions/v1/<fn> from the path, so
 * requesting <fn>/api/campaigns (or <fn>/campaigns) lands inside the
 * campaigns function, which parses those prefixes itself.
 */
function campaignsCandidates() {
  const raw = String(API_BASE || '').replace(/\/+$/, '')
  if (!raw) return ['/api/campaigns']
  if (raw.endsWith('/functions/v1')) {
    return [
      `${raw}/campaigns`,          // canonical layout: /functions/v1/campaigns
      `${raw}/campaigns/api/campaigns`, // /functions/v1/campaigns/api/campaigns
      `${raw}/api/campaigns`,      // legacy layout
    ]
  }
  return [`${raw}/api/campaigns`, `${raw}/campaigns/api/campaigns`]
}

/**
 * GET with fail-through on routing errors only (404/405), so auth and
 * validation errors surface to the caller instead of being swallowed by
 * the fallback chain.
 */
async function apiGetCampaigns() {
  return await apiRequestCandidates(campaignsCandidates(), { method: 'GET' })
}

async function apiGetActiveCampaign() {
  return await apiRequestCandidates(
    [API_BASE ? `${API_BASE}/get_active_campaign` : '/api/active-campaign'],
    { method: 'GET' },
  )
}

async function updateActiveCampaignInAPI(id) {
  return await apiRequestCandidates(
    [API_BASE ? `${API_BASE}/campaigns/${id}/select` : `/api/campaigns/${id}/select`],
    { method: 'POST' },
  )
}

async function createCampaignInAPI(campaignData) {
  return await apiRequestCandidates(
    [API_BASE ? `${API_BASE}/campaigns` : '/api/campaigns'],
    { method: 'POST', body: JSON.stringify(campaignData) },
  )
}

/* ------------------------------------------------------------------ *
 * Event tracking (impressions / clicks / conversions)
 * ------------------------------------------------------------------ */

/**
 * Candidates for the events-edge-function URL, in preferred order.
 * The server-side `events` aggregator and the legacy `record_impression`/
 * `record_interaction` functions speak the same HTTP contract; only the
 * first reachable candidate is used by the store.
 */
export function eventEndpoints(kind) {
  const raw = String(API_BASE || '').replace(/\/+$/, '')
  if (!raw) return [`/api/events/${kind}`]
  if (raw.endsWith('/functions/v1')) {
    const record = kind === 'impression'
      ? 'record_impression'
      : kind === 'conversion'
        ? 'events/conversion'
        : 'record_interaction'
    return [
      `${raw}/events/${kind}`,          // /functions/v1/events/impression
      `${raw}/events/api/events/${kind}`, // /functions/v1/events/api/events/impression
      `${raw}/${record}`,               // /functions/v1/record_impression
      `${raw}/api/events/${kind}`,      // legacy: would 404 on the gateway
    ]
  }
  return [`${raw}/api/events/${kind}`, `${raw}/events/${kind}`]
}

/**
 * POST with fail-through on routing errors only (404/405).
 */
async function apiRequestCandidates(urls, options = {}) {
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let lastErr = null
  for (const url of urls) {
    try {
      const res = await fetch(url, { ...options, headers })
      if (res.status === 404 || res.status === 405) continue // wrong route: try the next candidate
      const text = await res.text()
      let json = null
      try { json = text ? JSON.parse(text) : null } catch { /* keep null */ }
      if (!res.ok) {
        const msg =
          (json && (json.error?.message || (typeof json.error === 'string' ? json.error : json.message))) ||
          res.statusText || 'Request failed'
        const err = new Error(typeof msg === 'string' ? msg : 'Request failed')
        err.status = res.status
        err.payload = json
        throw err
      }
      return json
    } catch (e) {
      lastErr = e
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

/**
 * Build the event payload for the events backend.
 * - campaign_id: must be a real UUID; seeded demo campaigns short-circuit
 *   before the request leaves the store.
 * - session_id: one identifier per browser session for grouping.
 * - idempotency_key: deterministic per (session × campaign × kind), so a
 *   re-submit (or a React StrictMode double-fire) never inflates counters.
 * - cli_integration: which CLI integration the event came from, e.g.
 *   'workbench'. The backend requires a non-empty value.
 */
export function buildEventPayload(campaignId, kind = 'impression', opts = {}) {
  const { impressionId = null } = opts
  if (!isCampaignUuid(campaignId)) return null
  const idemKey = `${eventSessionId}:${kind}:${campaignId}`
  return {
    campaign_id: campaignId,
    cli_integration: opts.cliIntegration || 'workbench',
    session_id: eventSessionId,
    idempotency_key: idemKey,
    impression_id: impressionId,
    kind,
  }
}

/**
 * Record a billable impression.
 * - Idempotency: one impression per (session × campaign). Sweeping the
 *   slot in and out of view is a single counted impression; StrictMode
 *   re-renders do not double-count either.
 * - Server is authoritative: a successful response bumps the local snapshot
 *   only for display; retries against a duplicate key are silent.
 */
export function recordImpression(campaignId) {
  const payload = buildEventPayload(campaignId, 'impression')
  if (!payload) return // demo seed / non-UUID campaign: nothing billable

  recordImpressionInAPI(payload)
    .then((res) => {
      // On success — or a deduplicated earlier attempt — one real
      // impression was counted by the backend, so the snapshot mirrors it.
      replace(prev => ({
        campaigns: prev.campaigns.map(camp =>
          camp.id === campaignId
            ? { ...camp, impressions: (camp.impressions ?? 0) + 1 }
            : camp
        ),
      }))
    })
    .catch(error => {
      // 409 = duplicate event already recorded (backend is authoritative):
      // the reconciliation already happened server-side, nothing to do.
      if ((error?.status === 409 && error?.payload?.code === 'DUPLICATE_EVENT') ||
          /duplicate/i.test(String(error?.message || ''))) return
      console.error('Failed to record impression:', error)
    })
}

/**
 * Record a click (a qualifying / interaction event + reward).
 * - One requalifying event per (session × campaign) keeps a double-click
 *   from inflating the reward ledger; each subsequent activate is a new
 *   idempotency attempt, which the backend dedupes.
 * - Server is authoritative: a successful response bumps clicks + any
 *   reward_accrued for the snapshot; duplicates are silent.
 */
export function recordQualifyingEvent(data) {
  const campaignId = typeof data === 'string' ? data : data?.campaign_id
  const payload = buildEventPayload(campaignId, 'click')
  if (!payload) return // demo seed / non-UUID campaign: nothing billable

  recordInteractionInAPI(payload)
    .then((res) => {
      const accrued = res?.reward_accrued
      replace(prev => ({
        campaigns: prev.campaigns.map(camp =>
          camp.id === campaignId
            ? { ...camp, clicks: (camp.clicks ?? 0) + 1 }
            : camp
        ),
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
      if ((error?.status === 409 && error?.payload?.code === 'DUPLICATE_EVENT') ||
          /duplicate/i.test(String(error?.message || ''))) return
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
  return await apiRequestCandidates(campaignsCandidates(), { method: 'GET' })
}

async function apiGetActiveCampaign() {
  return await apiRequestCandidates(
    [API_BASE ? `${API_BASE}/get_active_campaign` : '/api/active-campaign'],
    { method: 'GET' },
  )
}

async function apiGetRewards() {
  return await apiRequestCandidates(
    [API_BASE ? `${API_BASE}/rewards` : '/api/rewards'],
    { method: 'GET' },
  )
}

async function apiGetAuthStatus() {
  return await apiRequestCandidates(
    [API_BASE ? `${API_BASE}/auth` : '/api/auth/status'],
    { method: 'GET' },
  )
}

async function updateActiveCampaignInAPI(id) {
  return await apiRequestCandidates(
    [API_BASE ? `${API_BASE}/campaigns/${id}/select` : `/api/campaigns/${id}/select`],
    { method: 'POST' },
  )
}

async function createCampaignInAPI(campaignData) {
  return await apiRequestCandidates(
    [API_BASE ? `${API_BASE}/campaigns` : '/api/campaigns'],
    { method: 'POST', body: JSON.stringify(campaignData) },
  )
}

async function recordImpressionInAPI(data) {
  return await apiRequestCandidates(eventEndpoints('impression'), {
    method: 'POST', body: JSON.stringify(data),
  })
}

async function recordInteractionInAPI(data) {
  return await apiRequestCandidates(eventEndpoints('interaction'), {
    method: 'POST', body: JSON.stringify(data),
  })
}

async function requestPayoutInAPI(data) {
  return await apiRequestCandidates(
    [API_BASE ? `${API_BASE}/payouts/request` : '/api/payouts/request'],
    { method: 'POST', body: JSON.stringify(data) },
  )
}

// Generic API request function (kept for call sites that still need it)
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
