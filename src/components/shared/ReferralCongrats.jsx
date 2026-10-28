
/**
 * ReferralCongrats — congratulations overlay shown when a referral reward
 * lands for either party.
 *
 * Props:
 *  open        - whether the overlay is visible
 *  onClose     - dismiss handler
 *  referral    - the rewarded referral row (status === 'rewarded')
 *  viewerRole  - 'referrer' | 'referred' | 'unknown' — which party the
 *                current user is in this relationship
 *  credits     - credits each party receives (default 150)
 *
 * The overlay shows both parties' earnings and a single dismiss button. It
 * does not auto-dismiss: the user acknowledges it before it goes away, so
 * the credit news is never missed.
 */
export default function ReferralCongrats({ open = false, onClose, referral, viewerRole = 'unknown', credits = 150 }) {
  if (!open || !referral) return null

  const isReferrer = viewerRole === 'referrer'
  const isReferred = viewerRole === 'referred'

  const yourEarnedLabel = isReferrer ? 'for referring a new advertiser' : isReferred ? 'for joining through a referral link' : 'for this referral'
  const otherEarnedLabel = isReferrer ? 'for joining through a referral link' : isReferred ? 'for referring a new advertiser' : 'for this referral'

  return (
    <div className="referral-congrats__scrim" role="dialog" aria-modal="true" aria-label="Referral reward earned" onClick={onClose}>
      <div className="referral-congrats__card" onClick={(event) => event.stopPropagation()}>
        <div className="referral-congrats__head">
          <h2 className="referral-congrats__title">Congratulations!</h2>
          <button type="button" className="referral-congrats__close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m6 6 12 12m-12 0L18 6" />
            </svg>
          </button>
        </div>
        <div className="referral-congrats__body">
          <p className="referral-congrats__line">
            <span className="referral-congrats__strong">You earned {credits} promotional credits</span>{' '}
            {yourEarnedLabel}.
          </p>
          <p className="referral-congrats__line">
            {isReferrer ? 'Your friend joined' : isReferred ? 'Your referrer invited' : 'The other party'} also earned {credits} promotional credits{' '}
            {otherEarnedLabel}.
          </p>
          <p className="referral-congrats__note">
            Promotional credits are not withdrawable cash. Each referred
            advertiser can have only one referrer, and rewards are issued
            only after a confirmed, eligible wallet funding has been
            verified server-side.
          </p>
        </div>
        <div className="referral-congrats__foot">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
