import { useAuth, authNavState } from './authState.js'

/**
 * Logout for the surfaces that do not render PublicHeader — the /app
 * dashboards. Visibility is still decided by authNavState(), the same
 * single source the header reads, so this control appears and disappears
 * with exactly the auth state the rest of the navigation sees.
 */
export function LogoutButton({ className = 'adv-nav__btn' }) {
  const { loading, isAuthenticated, role, signOut } = useAuth()
  const nav = authNavState({ loading, isAuthenticated, role })

  if (!nav.showLogout) return null

  async function onLogout() {
    try {
      await signOut('/')
    } catch {
      // signOut already cleared local auth state and navigated to the
      // logged-out navigation before re-throwing; nothing left to do.
    }
  }

  return (
    <button type="button" className={className} onClick={onLogout}>
      Log out
    </button>
  )
}