import { useAuth } from '../auth/authState.js'
import AccountPage from '../advertiser/AccountPage.jsx'

/**
 * Admin settings surface.
 *
 * This is the target of the "Settings" entry in the admin sidebar. It used
 * to be a button with an empty onClick, so the item promised a settings page
 * and delivered nothing.
 *
 * Rather than inventing a fourth settings UI, this binds the same shared
 * AccountPage the advertiser and developer dashboards already use. An admin
 * has no `advertisers` or `developer_accounts` row, so AccountPage renders the
 * Profile panel and skips the role-specific Company / Developer panels, and
 * `saveAccountProfile` is called with only `profilePatch`. Password change and
 * account deletion are the same owner-scoped operations every other role has.
 */
export default function AdminAccount() {
  const auth = useAuth()

  return (
    <AccountPage
      role="admin"
      email={auth.user?.email}
      userId={auth.user?.id}
      headlineIndex="S1"
      roleLabel="Admin"
    />
  )
}