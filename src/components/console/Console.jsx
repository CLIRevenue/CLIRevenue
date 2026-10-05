/* =============================================================
   CLIRevenue — the product console
   -------------------------------------------------------------
   Rendered as a sibling of the film rather than inside it: the six
   acts keep their own <main>, their own scroll geometry, and their
   own choreography, and this section never participates in any of it.
   It only carries its own MotionConfig so reduced motion is honoured
   here too.
   ============================================================= */

import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'

import ConsoleMasthead from './ConsoleMasthead.jsx'
import Workbench from './Workbench.jsx'
import AdvertiserConsole from './AdvertiserConsole.jsx'
import RewardsPanel from './RewardsPanel.jsx'
import EconomicLoop from './EconomicLoop.jsx'
import { PromoAd } from '../PromoAd.jsx'
import useEconomy from '../../hooks/useEconomy.js'
import { SETTLE_TICK_MS } from '../../data/economy.js'
import { settlePending } from '../../lib/economyStore.js'

function Console() {
  const economy = useEconomy()

  /* One clock for the whole console. Pending rewards age out here, so
     the wallet, the activity list, and the ledger all move together. */
  useEffect(() => {
    const id = window.setInterval(() => settlePending(), SETTLE_TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <section className="console" id="product" aria-label="CLIRevenue product simulation">
        <div className="console__inner">
          <ConsoleMasthead />

          {/* Requirement: subtle, but unmistakable. */}
          <p className="console__disclosure">
            Demo environment. Campaigns, rewards and settlements shown here are
            simulated and do not involve real money.
          </p>

          <div className="console__promo">
            <PromoAd index={1} variant="compact" />
          </div>

          <Workbench />
          <AdvertiserConsole economy={economy} />
          <RewardsPanel economy={economy} />
          <EconomicLoop economy={economy} />

          <div className="console__foot">
            <p className="console__foot-line">
              CLIRevenue ad delivery is real: the sponsored slot in the workbench above is
              delivered by the CLIRevenue SDK, and its impression is counted server-side.
            </p>
            <p className="console__foot-line">
              CLIRevenue account features use Supabase. Campaign, reward, balance, and payout
              figures in this console are simulated and do not involve real money.
            </p>
            <p className="console__foot-line">
              No advertiser billing · no provider integration · no publisher payout · no KYC.
            </p>
          </div>
        </div>
      </section>
    </MotionConfig>
  )
}

export default Console
