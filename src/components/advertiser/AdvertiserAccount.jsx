import { useAuth } from '../auth/authState.js'
import AccountPage from './AccountPage.jsx'

/**
 * Advertiser account tab. The full account experience (profile, company,
 * security, preferences, danger zone) is shared with the developer side in
 * AccountPage; this wrapper binds it to the advertiser role.
 */
export default function AdvertiserAccount() {
  const auth = useAuth()

  return (
    <AccountPage
      role="advertiser"
      email={auth.user?.email}
      userId={auth.user?.id}
      headlineIndex="A5"
      roleLabel="Advertiser"
    />
  )
}
