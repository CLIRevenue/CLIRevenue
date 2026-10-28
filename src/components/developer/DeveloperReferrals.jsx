import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/authState.js'
import { AdvEmpty, AdvError, AdvLoading, AdvPageHead, AdvStats } from '../advertiser/AdvertiserUI.jsx'
import { formatCredits } from '../advertiser/AdvertiserBilling.jsx'
import CopyButton from '../CopyButton.jsx'
import ReferralCongrats from '../shared/ReferralCongrats.jsx'
import { useReferralCongrats } from '../shared/useReferralCongrats.js'
import {
  fetchReferralCode,
  fetchReferralDashboard,
  attributeReferral,
  REFERRAL_MINOR_THRESHOLD,
} from '../../lib/referralApi.js'

/** One credit is one rupee. */

function statusLabel(status) {
  const labels = {
    pending: 'Awaiting funding',
    qualified: 'Pending verification',
    rewarded: 'Successful',
    rejected: 'Rejected',
    reversed: 'Reversed',
  }
  return labels[status] || status
}

export default function DeveloperReferrals() {
  const auth = useAuth()
  const [dashboard, setDashboard] = useState(null)
  const [code, setCode] = useState(null)
  const [codeLoading, setCodeLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState('')

  const load = useCallback(async () => {
    try {
      const [dash, codeData] = await Promise.all([fetchReferralDashboard(), fetchReferralCode()])
      setDashboard(dash)
      setCode(codeData?.token ?? null)
      setDashboardError('')
    } catch (err) {
      setDashboardError(err.message || 'Could not load referrals.')
    }
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      await load()
    }
    void fetchData()
  }, [load])

  const handleCreateCode = useCallback(async () => {
    setCodeLoading(true)
    try {
      const data = await fetchReferralCode()
      setCode(data?.token ?? null)
    } catch (err) {
      setDashboardError(err.message || 'Could not create referral code.')
    } finally {
      setCodeLoading(false)
    }
  }, [])

  const handleAttribute = useCallback(async (event) => {
    event.preventDefault()
    const token = event.currentTarget.elements.token.value.trim()
    if (!token) return
    try {
      const result = await attributeReferral(token)
      if (result.attributed) {
        event.currentTarget.reset()
        void load()
      } else {
        setDashboardError(result.duplicate
          ? 'This account is already attributed to a referrer and ownership cannot be overwritten.'
          : 'Attribution failed.')
      }
    } catch (err) {
      setDashboardError(err.message || 'Attribution failed.')
    }
  }, [load])

  const referralLink = useMemo(() => {
    if (!code) return null
    try {
      const url = new URL(window.location.origin)
      url.pathname = '/signup'
      url.searchParams.set('ref', code)
      return url.toString()
    } catch {
      return null
    }
  }, [code])

  const successful = Number(dashboard?.successfulReferrals ?? 0)
  const pending = Number(dashboard?.pendingReferrals ?? 0)
  const remaining = Number(dashboard?.remainingSlots ?? 0)
  const totalCredits = Number(dashboard?.totalCreditsEarned ?? 0)
  const thresholdRupees = Number(REFERRAL_MINOR_THRESHOLD) / 100

  const { open: congratsOpen, activeReferral: congratsReferral, dismiss: dismissCongrats } =
    useReferralCongrats(dashboard, auth?.profile?.id ?? null)

  return (
    <div className="adv-page">
      <AdvPageHead
        index="D5"
        label="Developer · Referrals"
        title="Referral program"
        body="Invite fellow developers. You each earn 150 promotional credits when a referred developer funds their wallet with at least ₹1,000 (GST excluded). You can earn from up to three successful referrals."
      />
      {dashboardError ? <AdvError message={dashboardError} /> : null}

      {!dashboard ? <AdvLoading /> : (
        <>
          {congratsOpen && congratsReferral ? (
            <ReferralCongrats
              open={congratsOpen}
              onClose={dismissCongrats}
              referral={congratsReferral}
              viewerRole={
                String(congratsReferral.referrer_profile_id) === String(auth?.profile?.id)
                  ? 'referrer'
                  : 'referred'
              }
              credits={150}
            />
          ) : null}

          <AdvStats
            items={[
              {
                label: 'Referred registrations',
                value: String(dashboard.referredRegistrations),
                hint: 'Signed up through your link',
                tone: 'plain',
              },
              {
                label: 'Successful referrals',
                value: `${successful} / 3`,
                hint: remaining > 0 ? `${remaining} slot${remaining === 1 ? '' : 's'} left` : 'Limit reached',
                flag: remaining === 0 ? 'full' : successful > 0 ? 'live' : 'empty',
                tone: remaining === 0 ? 'warn' : successful > 0 ? 'live' : 'plain',
              },
              {
                label: 'Pending referrals',
                value: String(pending),
                hint: 'Awaiting the referred wallet funding',
                tone: 'plain',
              },
              {
                label: 'Credits earned',
                value: formatCredits(totalCredits),
                hint: 'Promotional credits, not withdrawable cash',
                tone: totalCredits > 0 ? 'live' : 'zero',
              },
            ]}
          />

          <section className="panel adv-panel" aria-label="Your referral link">
            <h4 className="adv-panel__title">Your referral link</h4>
            <p className="adv-panel__sub">
              Share this link. When someone signs up through it and funds their
              wallet with at least ₹{thresholdRupees.toFixed(2)} (eligible funding;
              GST, when charged, is separate), you both earn 150 credits.
            </p>
            <div className="adv-referral__link">
              {code ? (
                <>
                  <span className="adv-referral__link-text">{referralLink}</span>
                  <CopyButton text={referralLink} label="referral link" baseClass="dev-copy" />
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={codeLoading}
                    onClick={handleCreateCode}
                  >
                    {codeLoading ? 'Creating…' : 'Create referral link'}
                  </button>
                </>
              )}
              <p className="adv-upload__hint">
                The link contains an opaque token, not your account id. It can
                be regenerated, which revokes the previous one.
              </p>
            </div>
          </section>

          <section className="panel adv-panel" aria-label="Attribute a signup">
            <h4 className="adv-panel__title">Signed up through a link?</h4>
            <p className="adv-panel__sub">
              If you joined through someone else's referral link, paste the
              token from that link here so your signup is attributed.
            </p>
            <form className="form adv-form" onSubmit={handleAttribute} noValidate>
              <label className="field">
                <span className="field__label">Referral token</span>
                <input
                  name="token"
                  className="field__input"
                  placeholder="Paste the referral token"
                  required
                />
              </label>
              <button type="submit" className="btn btn--primary">
                Attribute signup
              </button>
            </form>
          </section>

          <section className="panel adv-panel" aria-label="Referral history">
            <h4 className="adv-panel__title">Referral history</h4>
            <p className="adv-panel__sub">One row per person you referred, newest first.</p>
            {dashboard.referrals.length === 0 ? (
              <AdvEmpty
                mark="No referrals yet"
                title="No one referred so far"
                body="Your referrals appear here once someone signs up through your link."
              />
            ) : (
              <ul className="adv-activity">
                {dashboard.referrals.map((r) => (
                  <li key={r.id} className="adv-activity__row">
                    <span className="adv-activity__label">
                      {r.referredProfileId ? r.referredProfileId.slice(0, 8) + '…' : '—'}
                    </span>
                    <span className="adv-activity__detail">
                      {statusLabel(r.status)}
                      {r.status === 'rewarded' ? ` · +150 credits` : ''}
                    </span>
                    <span className={`adv-referral__status adv-referral__status--${r.status}`}>
                      {statusLabel(r.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="adv-upload__hint">
            Promotional credits are not withdrawable cash. No multi-level
            commissions are paid, and each referred advertiser can have only
            one referrer. Rewards are issued only after a confirmed, eligible
            wallet funding of at least ₹{thresholdRupees.toFixed(2)} has been
            verified server-side.
          </p>
        </>
      )}
    </div>
  )
}
