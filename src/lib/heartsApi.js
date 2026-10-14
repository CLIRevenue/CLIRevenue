import { supabase, supabaseConfigured } from './api.js'

/* The visitor's own click is remembered in localStorage rather than tied to
   an account: the heart has to read as "you did this" on every page and
   survive a refresh, with no sign-in between the visitor and the button.
   Every access is wrapped, because storage throws outright in a locked-down
   browser profile and an uncaught throw here would blank a page whose every
   section is behind a script. */
const KEY = 'clirevenue.heart.v1'

export function readOwnHeart() {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function writeOwnHeart() {
  try {
    window.localStorage.setItem(KEY, '1')
  } catch {
    /* Nothing to do -- the click still counts in the database, it just will
       not be recognised as ours on the next visit. */
  }
}

export async function readHearts() {
  if (!supabaseConfigured) return { count: null, error: null }
  const { data, error } = await supabase
    .from('site_hearts')
    .select('hearts')
    .eq('id', 1)
    .maybeSingle()
  if (error) return { count: null, error }
  return { count: typeof data?.hearts === 'number' ? data.hearts : 0, error: null }
}

export async function addHeart() {
  if (!supabaseConfigured) return { count: null, error: null }
  const { data, error } = await supabase.rpc('increment_heart')
  if (error) return { count: null, error }
  return { count: typeof data === 'number' ? data : null, error: null }
}