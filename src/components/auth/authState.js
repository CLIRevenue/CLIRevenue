import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

const ROLE_HOME = {
  advertiser: '/app/advertiser',
  developer: '/app/developer',
  admin: '/app/admin',
}

export function roleHome(role) {
  return ROLE_HOME[role] || null
}

/**
 * THE authoritative mapping from auth state to what the header and the
 * dashboard nav may show. Every navigation surface derives its Login /
 * Signup / Dashboard / Logout visibility from this one function, so the
 * rule lives in exactly one place and cannot drift between components.
 *
 * Invariants:
 *  - loading never renders auth controls (no flash of the wrong nav)
 *  - logged out ALWAYS offers Login *and* Signup, on every route
 *  - logged in ALWAYS offers the dashboard entry and Logout
 *  - the dashboard href comes from public.profiles.role only
 */
export function authNavState({ loading, isAuthenticated, role }) {
  if (loading) {
    return {
      status: 'loading',
      showLogin: false,
      showSignup: false,
      showDashboard: false,
      showLogout: false,
      dashboardHref: null,
      accountHref: null,
    }
  }
  if (!isAuthenticated) {
    return {
      status: 'anonymous',
      showLogin: true,
      showSignup: true,
      showDashboard: false,
      showLogout: false,
      dashboardHref: null,
      accountHref: null,
    }
  }
  const home = roleHome(role)
  return {
    status: 'authenticated',
    showLogin: false,
    showSignup: false,
    showDashboard: true,
    showLogout: true,
    dashboardHref: home || '/app',
    // Only a known role has an account page; without one the account chip
    // falls back to the role-agnostic /app resolver rather than inventing
    // a /app/account route that does not exist.
    accountHref: home ? `${home}/account` : '/app',
  }
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
