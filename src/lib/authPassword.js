import { supabase } from './api.js'

export function sendPasswordReset(email) {
  return supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/login`,
  })
}
