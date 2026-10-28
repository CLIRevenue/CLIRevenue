import { useCallback, useEffect, useState } from 'react'

/**
 * useReferralCongrats — detect newly-rewarded referrals from the dashboard
 * payload and surface them via a sessionStorage-gated congrats overlay.
 *
 * Shows once per rewarded referral per viewer. Returns { open, activeReferral, dismiss }.
 */
export function useReferralCongrats(dashboard, viewerProfileId) {
  const [open, setOpen] = useState(false)
  const [activeReferral, setActiveReferral] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      if (!dashboard?.referrals?.length) return
      const shown = new Set(JSON.parse(window.sessionStorage.getItem('clirevenue.referral.congrats.shown') ?? '[]'))
      const next = dashboard.referrals.find(
        (r) =>
          r.status === 'rewarded' &&
          (String(r.referrer_profile_id) === viewerProfileId ||
            String(r.referred_profile_id) === viewerProfileId) &&
          !shown.has(String(r.id)),
      )
      if (next) {
        setActiveReferral(next)
        setOpen(true)
      }
    }
    void fetchData()
  }, [dashboard, viewerProfileId])

  const dismiss = useCallback(() => {
    setOpen(false)
    setActiveReferral(null)
    if (activeReferral) {
      const shown = new Set(JSON.parse(window.sessionStorage.getItem('clirevenue.referral.congrats.shown') ?? '[]'))
      shown.add(String(activeReferral.id))
      try {
        window.sessionStorage.setItem('clirevenue.referral.congrats.shown', JSON.stringify([...shown]))
      } catch {
        /* Storage off — congrats will re-show on reload. Harmless. */
      }
    }
  }, [activeReferral])

  return { open, activeReferral, dismiss }
}
