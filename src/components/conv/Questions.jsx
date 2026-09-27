/* =============================================================
   CLIRevenue — questions
   -------------------------------------------------------------
   Seven questions, answered as the prototype stands today. Native
   <details> so disclosure works without script, without motion, and
   with the browser's own keyboard behaviour.
   ============================================================= */

import { motion } from 'motion/react'

import { SectionHead } from '../console/ui.jsx'
import { useReveal } from './helpers.js'

const QUESTIONS = [
  {
    q: 'Why would developers accept ads?',
    a: 'Because the slot is narrow, sits beside tool output rather than inside it, and pays for attention that was already being given. In this prototype the payment is simulated, so the honest answer today is that the premise is being tested, not that anyone has been paid.',
  },
  {
    q: 'How do developers earn?',
    a: 'By interacting with a sponsored slot while a demo account is connected. The interaction is recorded, a reward moves from pending to available after a settlement period, and a balance builds up in the economic console above. All of that state lives in the page and resets on reload.',
  },
  {
    q: 'How do advertisers pay?',
    a: 'Campaigns in the console carry a budget and a spend figure so the loop can be followed end to end. No card is taken, no invoice is raised, and nothing in this prototype is purchasable.',
  },
  {
    q: 'How does CLIRevenue make money?',
    a: 'By taking a margin on what an advertiser pays for a placement, and sharing part of that with the developer. The margin and the share are deliberately not fixed yet, and this page does not publish either.',
  },
  {
    q: 'Is CLIRevenue live?',
    a: 'No. It is a prototype: a six-act film, a developer workbench, and an economic console that all run in the browser. There is no ad server, no marketplace, no account system, and no backend behind any of it.',
  },
  {
    q: 'Are the rewards real?',
    a: 'No. The current economic console is simulated. Campaigns, rewards and settlements shown here are demo data held in page memory, and no real money moves at any point.',
  },
  {
    q: 'What data is collected?',
    a: 'Nothing. This prototype has no backend, no analytics, and no storage. The forms confirm locally and send nothing; no email address, session, or identifier is kept, and reloading the page clears whatever you typed.',
  },
]

function Questions() {
  const reveal = useReveal()

  return (
    <motion.section
      className="block conv__block"
      id="questions"
      aria-label="Questions"
      {...reveal}
    >
      <SectionHead
        level="h2"
        index="12"
        label="Questions"
        title="The seven we get asked first."
        body="Answered as they stand today. Where something is simulated, this page says so."
      />

      <div className="conv__faq">
        {QUESTIONS.map((item, i) => (
          <details className="faq__item" key={item.q} open={i === 0}>
            <summary className="faq__q">
              <h3 className="faq__title">{item.q}</h3>
            </summary>
            <div className="faq__a">
              <p>{item.a}</p>
            </div>
          </details>
        ))}
      </div>
    </motion.section>
  )
}

export default Questions
