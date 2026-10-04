/* =============================================================
   CLIRevenue — the delivered sponsored slot
   -------------------------------------------------------------
   The workbench's ad region, wired to real delivery. It asks the SDK
   for the placement named in the registry, renders whatever comes back
   (or says why nothing came back), and lets the SDK decide when the ad
   was genuinely seen.

   The component owns no accounting, no revenue figure and no campaign
   choice. It cannot: it only ever holds one `ServedAd` and the SDK is
   the thing that turns that into a recorded impression.
   ============================================================= */

import { useCallback, forwardRef } from 'react'

import SponsoredSlot from './SponsoredSlot.jsx'
import useServedAd, { activationReportsClick, AD_STATE } from '../../hooks/useServedAd.js'
import { PLACEMENTS } from '../../data/placements.js'
import { getClient } from '../../lib/clirevenue.js'

/* Forward the ref to the inner .servedad div so callers (like the
   drum overlay) can position the exact element the SDK watches for
   viewability. */
const ServedAdSlot = forwardRef(function ServedAdSlot(
  { placementId = 'consoleWorkbench', hidden = false, surface },
  forwardedRef,
) {
  const placement = PLACEMENTS[placementId] || null
  const { state, served, containerRef, retry, headline, support } = useServedAd(placementId)

  /* One control, and its meaning follows the slot's state: on the
     delivered path it is the call to action and reports the click to the
     SDK; when the request failed or the device is offline it becomes a
     retry, because there is nothing else to press. */
  const landingUrl = state === AD_STATE.READY && served ? served.ad.landingUrl : ''

  const handleActivate = useCallback(() => {
    if (state !== AD_STATE.READY || !served) {
      retry()
      return
    }
    /* `landingUrl` is nullable in the served contract. When it is absent
       the control degrades to a plain button that only expands the detail
       panel. That is a disclosure, not a click-through, and it must not
       be reported as one. */
    if (!activationReportsClick(state, served)) return
    const client = getClient()
    if (!client) return
    /* Fire and forget on purpose: navigation must not wait on, or
       survive the failure of, a reporting call. */
    Promise.resolve(client.recordClick(served)).catch(() => {})
  }, [state, served, retry])

  /* Merge the forwarded ref with the internal containerRef so the
     SDK's viewability observer watches the same element the caller
     positions. */
  const mergedRef = forwardedRef ?? containerRef

  return (
    <div ref={mergedRef} className="servedad">
      <SponsoredSlot
        served={served}
        state={state}
        headline={headline}
        support={support}
        placementKey={placement ? placement.key : null}
        ctaHref={landingUrl}
        hidden={hidden}
        onActivate={handleActivate}
        surface={surface}
      />
    </div>
  )
})

ServedAdSlot.displayName = 'ServedAdSlot'

export default ServedAdSlot
