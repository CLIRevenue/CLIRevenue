import { arrowGlyph } from '../../data/demo.js'
import { DemoTag } from './ui.jsx'
import OrbitRing from './OrbitRing.jsx'

const Arrow = arrowGlyph

/**
 * The four parties of the thesis, in thesis order rather than page order.
 * Each one is a real anchor into the console below.
 */
const JOURNEY = [
  { index: '01', label: 'Advertiser', note: 'brief, budget, audience', href: '#advertiser' },
  { index: '02', label: 'CLIRevenue', note: 'records the revenue', href: '#loop' },
  { index: '03', label: 'AI coding workflow', note: 'the sponsored slot', href: '#workbench' },
  { index: '04', label: 'User reward', note: 'pending to available', href: '#rewards' },
]

function ConsoleMasthead() {
  return (
    <div className="block masthead">
      <div className="masthead__lede">
        <p className="eyebrow eyebrow--plain">07 — Product simulation</p>
        <h2 className="masthead__title" id="console-title">
          One loop.
          <br />
          Four parties.
        </h2>
        <p className="masthead__body">
          Everything below is an interactive model of the same thesis the film just
          argued: an advertiser funds a campaign, the campaign is delivered into an
          agent session, a qualifying event is recorded, and a developer reward moves
          from pending to available. Work the controls — the ledger keeps up.
        </p>
        <DemoTag>Every figure is simulated</DemoTag>
      </div>

      <nav className="journey glass" aria-label="The revenue loop, party by party">
        <ol className="journey__list">
          {JOURNEY.map((step, i) => (
            <li className="journey__item" key={step.index}>
              <a className="journey__link" href={step.href}>
                <span className="journey__index">{step.index}</span>
                <span className="journey__copy">
                  <span className="journey__label">{step.label}</span>
                  <span className="journey__note">{step.note}</span>
                </span>
                <Arrow className="journey__arrow" aria-hidden="true" />
              </a>
              {i < JOURNEY.length - 1 && (
                <span className="journey__rail" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      </nav>
      <OrbitRing />
    </div>
  )
}

export default ConsoleMasthead
