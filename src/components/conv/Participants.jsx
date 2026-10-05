/* =============================================================
   CLIRevenue — the three participants
   -------------------------------------------------------------
   One sentence per party. Factual by construction: no logos, no
   testimonials, no counts, no figures.
   ============================================================= */

import { motion } from 'motion/react'

import { SectionHead } from '../console/ui.jsx'
import { useReveal } from './helpers.js'

const PARTIES = [
  {
    index: '01',
    name: 'Developers',
    body: 'Earn a share of advertising revenue from qualifying activity.',
  },
  {
    index: '02',
    name: 'Advertisers',
    body: 'Reach developers inside AI-assisted coding workflows.',
  },
  {
    index: '03',
    name: 'CLIRevenue',
    body: 'Provides the advertising infrastructure, measurement, marketplace and revenue-sharing layer.',
  },
]

function Participants() {
  const reveal = useReveal()

  return (
    <motion.section
      className="block conv__block"
      id="participants"
      aria-label="The three participants"
      {...reveal}
    >
      <SectionHead
        level="h2"
        index="12"
        label="The three participants"
        title="Three parties, one marketplace."
        body="What each side is here to do, in one sentence each."
      />

      <div className="conv__cards">
        {PARTIES.map((party) => (
          <article className="conv__card" key={party.index}>
            <p className="conv__card-role">{party.index}</p>
            <h3 className="conv__card-title">{party.name}</h3>
            <p className="conv__card-body">{party.body}</p>
          </article>
        ))}
      </div>
    </motion.section>
  )
}

export default Participants
