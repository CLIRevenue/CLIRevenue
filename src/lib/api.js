import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client with the public URL and anon key
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
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
