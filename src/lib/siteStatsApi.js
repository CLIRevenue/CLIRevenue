import { supabase, supabaseConfigured } from './api.js'

const VISITOR_KEY = 'clirevenue.visitor.v1'
const VIEW_EVENT_KEY = 'clirevenue.view_event.v1'

function generateVisitorId() {
  return crypto.randomUUID()
}

function getVisitorId() {
  if (typeof window === 'undefined') return null
  try {
    let id = window.localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

function hasViewedCurrentPage() {
  if (typeof window === 'undefined') return false
  try {
    const key = 'clirevenue.view_event' + window.location.pathname
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function markPageViewed() {
  if (typeof window === 'undefined') return
  try {
    const key = 'clirevenue.view_event' + window.location.pathname
    window.sessionStorage.setItem(key, '1')
  } catch {
    // ignore
  }
}

export async function registerPageView() {
  if (!supabaseConfigured) return { viewCount: 0, firstVisit: false }
  const path = window.location.pathname
  if (hasViewedCurrentPage()) return { viewCount: 0, firstVisit: false }
  
  markPageViewed()
  
  try {
    const { data, error } = await supabase.rpc('increment_page_view', { p_path: window.location.pathname })
    if (error) {
      console.warn('Failed to record page view:', error.message)
      return { viewCount: 0, firstVisit: false }
    }
    return { viewCount: data ?? 0, firstVisit: true }
  } catch (e) {
    console.warn('Failed to record page view:', e)
    return { viewCount: 0, firstVisit: false }
  }
}

export async function fetchTotalLifetimeViews() {
  if (!supabaseConfigured) return 0
  try {
    const { data, error } = await supabase.rpc('get_total_lifetime_views')
    if (error) return 0
    return data ?? 0
  } catch {
    return 0
  }
}

export async function fetchPageViews() {
  if (!supabaseConfigured) return []
  try {
    const { data, error } = await supabase.rpc('get_page_views')
    if (error) return []
    return data ?? []
  } catch {
    return []
  }
}


