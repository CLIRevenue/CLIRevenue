import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client with the public URL and anon key
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
if (!supabaseConfigured) {
  console.warn('Supabase environment variables are missing. Some features may not work.')
}

/* Without credentials there is still a site to render: the auth
   surface answers exactly as it would with no signed-in session,
   instead of createClient(undefined) throwing and blanking the app. */
const stubFrom = () => ({
  select: () => ({
    eq: () => ({
      maybeSingle: async () => ({ data: null, error: new Error('Supabase not configured') }),
      single: async () => ({ data: null, error: new Error('Supabase not configured') }),
    }),
  }),
  insert: async () => ({ data: null, error: new Error('Supabase not configured') }),
})

const authUnavailable = {
  getSession: async () => ({ data: { session: null }, error: null }),
  getUser: async () => ({ data: { user: null }, error: null }),
  signUp: async () => ({
    data: { user: null, session: null },
    error: new Error('Supabase not configured'),
  }),
  signInWithPassword: async () => ({
    data: { user: null, session: null },
    error: new Error('Supabase not configured'),
  }),
  signOut: async () => ({ error: null }),
  onAuthStateChange: () => ({
    data: { subscription: { unsubscribe() {} } },
  }),
  resetPasswordForEmail: async () => ({ data: null, error: new Error('Supabase not configured') }),
}

const supabaseUnavailable = {
  auth: authUnavailable,
  from: stubFrom,
  rpc: async () => ({ data: null, error: new Error('Supabase not configured') }),
}

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : supabaseUnavailable

// Base URL for our API endpoints (the Supabase Edge Functions)
const apiBase = import.meta.env.VITE_API_BASE_URL || ''

/**
 * Makes an authenticated request to the API.
 * @param {string} endpoint - The endpoint (e.g., '/api/campaigns')
 * @param {Object} options - Fetch options (method, body, etc.)
 * @returns {Promise<any>} - The parsed JSON response
 */
async function apiRequest(endpoint, options = {}) {
  const token = (await supabase.auth.getSession()).data.session?.access_token
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  
  const response = await fetch(`${apiBase}${endpoint}`, {
    ...options,
    headers,
  })
  
  if (!response.ok) {
    // Try to parse error JSON
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

// Auth functions
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

// Campaign functions
export async function getCampaigns() {
  return await apiRequest('/api/campaigns')
}

export async function createCampaign(campaignData) {
  return await apiRequest('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(campaignData),
  })
}

export async function getCampaign(id) {
  return await apiRequest(`/api/campaigns/${id}`)
}

export async function updateCampaign(id, updates) {
  return await apiRequest(`/api/campaigns/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function selectCampaign(id) {
  return await apiRequest(`/api/campaigns/${id}/select`, {
    method: 'POST',
  })
}

// Active campaign
export async function getActiveCampaign() {
  return await apiRequest('/api/active-campaign')
}

// Event tracking
export async function recordImpression(data) {
  return await apiRequest('/api/events/impression', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function recordInteraction(data) {
  return await apiRequest('/api/events/interaction', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// Rewards
export async function getRewardBalance() {
  return await apiRequest('/api/rewards/balance')
}

export async function getRewards(params = {}) {
  const query = new URLSearchParams(params).toString()
  const endpoint = `/api/rewards${query ? `?${query}` : ''}`
  return await apiRequest(endpoint)
}

// Payouts
export async function requestPayout(data) {
  return await apiRequest('/api/payouts/request', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// Auth status (for connected flag)
export async function getAuthStatus() {
  try {
    const session = await getSession()
    if (!session) {
      return { connected: false }
    }
    const { data: { user } } = await supabase.auth.getUser()
    return {
      connected: true,
      user: {
        id: user.id,
        email: user.email,
        // We'll get the role from the profiles table later if needed
        // For now, we can fetch it from the API or from the user's metadata
        // But we don't have role in the auth user by default; we need to fetch from profiles
      }
    }
  } catch {
    return { connected: false }
  }
}