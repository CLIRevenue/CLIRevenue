/* =============================================================
   CLIRevenue — the sponsored slot
   -------------------------------------------------------------
   Same class names and same visual contract as the film's `AdSlot`, and
   three things can fill it:

     `served`  the SDK's Serve result for a placement key.
               The slot then renders it, links to its destination and
               lets the SDK record the impression once it is viewable.
     `state`   loading / nofill / error / offline / disabled. The words
               for those come from the placement registry, so the copy
               lives next to the placement it describes.
     `campaign` a creative being edited in the advertiser console. That
               is a picture of an advertisement, not an advertisement:
               never delivered, never counted, never attributed.

   Two things happen when the call to action is used, and they stay
   separate: the panel opens (a region of the interface opening, never a
   line the terminal printed), and — only on the delivered path — the
   click is reported to the SDK, which owns it. Nothing here records an
   impression, computes a reward or decides an advertiser.
   ============================================================= */

import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { arrowGlyph } from '../../data/demo.js'
import { REWARD_PER_INTERACTION_CENTS } from '../../data/economy.js'
import { formatMoney } from '../../lib/economy.js'

const Arrow = arrowGlyph

const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }
const FLAT = { duration: 0 }

const STATE_META = 'ui region · not stdout · clirevenue delivery'

export default function SponsoredSlot({
  served = null,
  campaign = null,
  state = 'ready',
  headline: stateHeadline = '',
  support: stateSupport = '',
  placementKey = null,
  ctaHref = '',
  connected,
  hidden,
  onActivate,
  surface = 'workbench',
}) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const panelId = useId()
  const detail = reduced ? FLAT : SPRING

  /* `served` is the SDK's Serve result, so the creative itself lives one
     level down. Reaching for `served.ad` here rather than in the caller
     keeps the shape the gateway actually returns in exactly one place. */
  const ad = served?.ad ?? null
  const delivered = Boolean(ad) && state === 'ready'
  const preview = !delivered && Boolean(campaign)

  /* Seeded campaigns carry a full creative (advertiser, brand, category,
     disclosure). A campaign written in the console form may not, so the
     presentation layer falls back rather than the economy being asked to
     store display metadata it does not need. */
  const fields = (() => {
    if (delivered) {
      return {
        railLabel: 'Sponsored',
        publisher: ad.name,
        brand: ad.name,
        mark: String(ad.name).slice(0, 1).toUpperCase(),
        headline: ad.headline,
        support: ad.description,
        meta: `${ad.audience || 'Sponsored placement'} · ui region · not stdout · Sponsored`,
        disclosure: 'Sponsored',
        cta: ad.cta || 'Visit',
        description: ad.description,
        name: ad.name,
        showLogo: true,
        showCta: true,
      }
    }
    if (preview) {
      const advertiser = campaign.advertiser || campaign.name
      const brand = campaign.brand || campaign.name
      const category = campaign.category || 'Sponsored placement'
      const disclosure = campaign.disclosure || 'Demo'
      return {
        railLabel: 'Sponsored',
        publisher: advertiser,
        brand,
        mark: String(brand).slice(0, 1).toUpperCase(),
        headline: campaign.headline,
        support: campaign.description,
        meta: `${category} · ui region · not stdout · ${disclosure}`,
        disclosure,
        cta: campaign.cta,
        description: campaign.description,
        name: campaign.name,
        showLogo: true,
        showCta: true,
      }
    }
    /* Nothing has been served and nothing is on its way: the slot keeps
       its frame and says what it is waiting for, in the same typeface
       as everything else. An unfilled slot is inventory, not a fault.
       A request that actually failed offers the one action that could
       help — asking again — rather than a dead control. */
    const canRetry = state === 'error' || state === 'offline'
    return {
      railLabel: 'Placement',
      publisher: 'CLIRevenue',
      brand: '',
      mark: '',
      headline: stateHeadline,
      support: stateSupport,
      meta: STATE_META,
      disclosure: 'Delivery',
      cta: canRetry ? 'Try again' : '',
      description: '',
      name: 'CLIRevenue placement',
      showLogo: false,
      showCta: canRetry,
    }
  })()

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next && onActivate) onActivate()
  }

  const ctaProps = {
    className: 'placement-slot__cta',
    onClick: handleToggle,
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
    whileTap: { scale: 0.97 },
    transition: detail,
  }

  const slotClass = surface === 'workbench' ? 'placement-slot placement-slot--workbench' : 'placement-slot'

  return (
    <aside
      className={slotClass}
      aria-label="Sponsored advertisement"
      data-state={hidden ? 'pending' : 'printed'}
      data-visual={open ? 'opened' : 'visible'}
      data-ad-state={delivered ? 'ready' : preview ? 'preview' : state}
    >
      <p className="visually-hidden">
        Sponsored placement inside the coding agent session. This is an
        advertisement, not output produced by the agent.
      </p>

      <div className="placement-slot__plate">

        <div className="placement-slot__rail">
          <span className="placement-slot__label">{fields.railLabel}</span>
          <span className="placement-slot__dot" aria-hidden="true" />
          <span className="placement-slot__publisher">{fields.publisher}</span>
          <span className="placement-slot__mark">Ad</span>
          <span className="placement-slot__disclosure">{fields.disclosure}</span>
        </div>

        <div className="placement-slot__body">
          {fields.showLogo ? (
            <span className="placement-slot__logo" aria-hidden="true">
              {fields.mark}
            </span>
          ) : null}
          <div className="placement-slot__copy">
            {fields.brand ? <span className="placement-slot__brand">{fields.brand}</span> : null}
            <p className="placement-slot__headline">{fields.headline}</p>
            {fields.support ? <p className="placement-slot__support">{fields.support}</p> : null}
            <p className="placement-slot__meta">{fields.meta}</p>
          </div>
          {fields.showCta ? (
            delivered && ctaHref ? (
              /* A served destination is a real link, so the browser
                 navigates exactly as it always would; the click is
                 reported alongside it and cannot block it. */
              <motion.a href={ctaHref} {...ctaProps}>
                {fields.cta}
                <Arrow aria-hidden="true" />
              </motion.a>
            ) : (
              <motion.button type="button" {...ctaProps}>
                {fields.cta}
                <Arrow aria-hidden="true" />
              </motion.button>
            )
          ) : null}
        </div>

        <AnimatePresence initial={false}>
          {open && fields.showCta && (
            <motion.div
              key="detail"
              id={panelId}
              role="region"
              aria-label={`Sponsored — ${fields.name}`}
              className="placement-slot__detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={detail}
            >
              <div className="placement-slot__detail-inner">
                <p className="placement-slot__detail-text">
                  {fields.description || fields.support}
                </p>
                {delivered ? (
                  <>
                    <p className="placement-slot__detail-earn">
                      served by CLIRevenue · impression recorded at 50% viewability for one second
                    </p>
                    <p className="placement-slot__detail-region">
                      ui region · not stdout · {placementKey || 'placement'}
                    </p>
                  </>
                ) : null}
                {preview ? (
                  <>
                    <p className="placement-slot__detail-earn">
                      {connected
                        ? `Interaction recorded · ${formatMoney(
                            REWARD_PER_INTERACTION_CENTS,
                          )} pending · demo`
                        : 'Interaction recorded for the advertiser · connect CLIRevenue to earn'}
                    </p>
                    <p className="placement-slot__detail-region">
                      ui region · not stdout · demo placement
                    </p>
                  </>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  )
}
