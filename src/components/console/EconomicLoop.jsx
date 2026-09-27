/* =============================================================
   CLIRevenue — the economic loop
   -------------------------------------------------------------
   Six steps, each one keyed to the record type the store actually
   writes, plus the ledger rows themselves so the explanation is
   sitting next to its evidence rather than illustrating it.
   ============================================================= */

import { SectionHead, DemoTag } from './ui.jsx'
import { ECONOMIC_LOOP } from '../../data/economy.js'
import { formatMoney } from '../../lib/economy.js'

function clock(at) {
  return new Date(at).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function EconomicLoop({ economy }) {
  const ledger = economy.ledger
  const latest = ledger[ledger.length - 1]
  const feed = ledger.slice(-6).reverse()

  return (
    <div className="block loop" id="loop">
      <SectionHead
        index="04"
        label="CLIRevenue"
        title="Six steps, one ledger, no money."
        body="Follow the path a single campaign takes. Every arrow below is a record type the simulation writes for real — the feed beside it is that ledger, live."
      />

      <div className="loop__grid">
        <ol className="loop__steps">
          {ECONOMIC_LOOP.map((step) => {
            const hits = ledger.filter((event) => step.types.includes(event.type))
            const active = latest ? step.types.includes(latest.type) : false
            return (
              <li
                className="loop__step"
                key={step.id}
                data-active={active ? 'true' : undefined}
              >
                <span className="loop__index">{step.index}</span>
                <div className="loop__copy">
                  <h4 className="loop__title">{step.title}</h4>
                  <p className="loop__body">{step.body}</p>
                </div>
                <span
                  className="loop__chip"
                  data-recorded={hits.length > 0 ? 'true' : undefined}
                >
                  {hits.length > 0 ? `${hits.length} recorded` : 'awaiting event'}
                </span>
              </li>
            )
          })}
        </ol>

        <div className="ledger">
          <header className="ledger__head">
            <h4 className="ledger__title">Reward ledger</h4>
            <DemoTag>Simulated</DemoTag>
          </header>
          <ul className="ledger__list">
            {feed.map((event) => (
              <li className="ledger__row" key={event.id} data-type={event.type}>
                <span className="ledger__time">{clock(event.at)}</span>
                <span className="ledger__label">{event.label}</span>
                <span className="ledger__amount">
                  {event.amountCents ? formatMoney(event.amountCents, { sign: true }) : '—'}
                </span>
              </li>
            ))}
          </ul>
          <p className="ledger__foot">
            DEMO/TEST events written to local memory. No processor, no counterparty, no
            settlement.
          </p>
        </div>
      </div>
    </div>
  )
}

export default EconomicLoop
