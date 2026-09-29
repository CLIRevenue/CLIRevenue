import { useAuth } from '../auth/authState.js'
import AccountPage from '../advertiser/AccountPage.jsx'

/**
 * Developer account tab. Same shared account experience as the advertiser
 * side, bound to the developer role (profile + developer sections).
 */
export default function DeveloperAccount() {
  const auth = useAuth()

  return (
    <AccountPage
      role="developer"
      email={auth.user?.email}
      userId={auth.user?.id}
      headlineIndex="D5"
      roleLabel="Developer"
    />
  )
}
