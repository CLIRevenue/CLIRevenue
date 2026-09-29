import { useAuth } from '../auth/authState.js'

/**
 * Back-compat wrapper: existing advertiser dashboard code that imports
 * useAdvertiserAuth keeps working, but there is only ONE auth system.
 */
export default function useAdvertiserAuth() {
  const auth = useAuth()
  return {
    loading: auth.loading,
    session: auth.session,
    user: auth.user,
    role: auth.role,
    advertiser: auth.advertiser,
    error: auth.error,
  }
}
