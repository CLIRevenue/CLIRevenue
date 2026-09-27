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
          <Workbench economy={economy} />
          <AdvertiserConsole economy={economy} />
          <RewardsPanel economy={economy} />
          <EconomicLoop economy={economy} />

          <div className="console__foot">
            <p className="console__foot-line">
              CLIRevenue is a prototype. Every campaign, impression, reward, balance, and
              payout in this console is DEMO/TEST data held in page memory.
            </p>
            <p className="console__foot-line">
              No real financial transactions · no KYC · no payout processing · no
              advertiser is billed · no provider is integrated yet.
            </p>
          </div>
        </div>
      </section>
    </MotionConfig>
  )
}

export default Console
