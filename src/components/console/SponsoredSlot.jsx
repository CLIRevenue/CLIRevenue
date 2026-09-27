/* =============================================================
   CLIRevenue — the sponsored slot, driven by campaign data
   -------------------------------------------------------------
   Same class names and same contract as the film's `AdSlot`, but the
   copy comes from whichever campaign the console currently has
   selected, so editing a campaign in the advertiser view changes what
   the agent session renders.

   Two things happen on a click, and they are deliberately separate:
   the panel opens (a region of the interface opening, never a line the
   terminal printed), and the qualifying event is emitted upstream.
   ============================================================= */

import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { arrowGlyph } from '../../data/demo.js'
import { REWARD_PER_INTERACTION_CENTS } from '../../data/economy.js'
import { formatMoney } from '../../lib/economy.js'

const Arrow = arrowGlyph

const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }
const FLAT = { duration: 0 }

function SponsoredSlot({ campaign, connected, hidden, onActivate }) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const panelId = useId()
  const detail = reduced ? FLAT : SPRING

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next) onActivate()
  }

  return (
    <aside
      className="adslot adslot--workbench"
      aria-label="Sponsored advertisement"
      data-state={hidden ? 'pending' : 'printed'}
    >
      <p className="visually-hidden">
        Sponsored placement inside the coding agent session. This is an
        advertisement, not output produced by the agent.
      </p>

      <div className="adslot__rail">
        <span className="adslot__label">Sponsored</span>
        <span className="adslot__dot" aria-hidden="true" />
        <span className="adslot__publisher">{campaign.name}</span>
        <span className="adslot__mark">Ad</span>
      </div>

      <div className="adslot__body">
        <div className="adslot__copy">
          <p className="adslot__headline">{campaign.headline}</p>
        </div>
        <motion.button
          type="button"
          className="adslot__cta"
          onClick={handleToggle}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97, y: 0 }}
          transition={detail}
        >
          {campaign.cta}
          <Arrow aria-hidden="true" />
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="detail"
            id={panelId}
            role="region"
            aria-label={`Sponsored — ${campaign.name}`}
            className="adslot__detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={detail}
          >
            <div className="adslot__detail-inner">
              <p className="adslot__detail-text">{campaign.description}</p>
              <p className="adslot__detail-earn">
                {connected
                  ? `Interaction recorded · ${formatMoney(REWARD_PER_INTERACTION_CENTS)} pending · demo`
                  : 'Interaction recorded for the advertiser · connect CLIRevenue to earn'}
              </p>
              <p className="adslot__detail-region">ui region · not stdout · demo placement</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}

export default SponsoredSlot
