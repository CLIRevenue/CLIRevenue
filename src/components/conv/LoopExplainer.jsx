/* =============================================================
   CLIRevenue — how the money moves
   -------------------------------------------------------------
   The five steps the console above simulates, written out plainly.
   Deliberately does not state a revenue split: none has been set.
   ============================================================= */

import { motion } from 'motion/react'

import { SectionHead } from '../console/ui.jsx'
import { useReveal } from './helpers.js'

const STEPS = [
  {
    index: '01',
    title: 'Advertiser',
    body: 'An advertiser writes a brief: a product, an audience of developers, and a budget to spend.',
  },
  {
    index: '02',
    title: 'Sponsored placement',
    body: 'CLIRevenue runs that brief as a single sponsored slot inside an AI coding workflow, alongside the tool’s own output.',
  },
  {
    index: '03',
    title: 'Developer interaction',
    body: 'A developer interacts with the slot. That interaction is recorded against the campaign.',
  },
  {
    index: '04',
    title: 'Revenue generated',
    body: 'The recorded interaction produces billable value for the campaign. Rates come from the marketplace, not from this page.',
  },
  {
    index: '05',
    title: 'Revenue shared with the developer',
    body: 'A share of that value returns to the developer as a reward. The share itself is not fixed yet, so this page does not publish one.',
  },
]

function LoopExplainer() {
  const reveal = useReveal()

  return (
    <motion.section
      className="block conv__block"
      id="model"
      aria-label="How the money moves"
      {...reveal}
    >
      <SectionHead
        level="h2"
        index="10"
        label="How the money moves"
        title="Five steps, from brief to developer reward."
        body="The same loop the console above simulates, written out plainly and in order."
      />

      <div className="conv__flow">
        <ol className="loop__steps">
          {STEPS.map((step, i) => (
            <li className="loop__step" key={step.index}>
              <span className="conv__stepnum">
                <span className="loop__index">{step.index}</span>
                {i < STEPS.length - 1 ? (
                  <span className="conv__arrow" aria-hidden="true">
                    ↓
                  </span>
                ) : null}
              </span>
              <div className="loop__copy">
                <h3 className="loop__title">{step.title}</h3>
                <p className="loop__body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <p className="conv__stipulation">
        This is the model, not a measurement. No figure on this page is a performance
        claim, and no revenue split has been set.
      </p>
    </motion.section>
  )
}

export default LoopExplainer
