/* =============================================================
   CLIRevenue — conversion & validation layer
   -------------------------------------------------------------
   Appended after the film and after the console, outside both. It
   carries its own MotionConfig so reduced motion is honoured here
   too, and it reuses the console's atoms — same section heads, same
   forms, same buttons, same tokens — rather than inventing a second
   visual language.
   ============================================================= */

import { MotionConfig } from 'motion/react'

import EntryPoints from './EntryPoints.jsx'
import LoopExplainer from './LoopExplainer.jsx'
import Participants from './Participants.jsx'
import Questions from './Questions.jsx'
import Contact from './Contact.jsx'

function Conversion() {
  return (
    <MotionConfig reducedMotion="user">
      <section className="conv" id="get-involved" aria-label="Get involved">
        <div className="conv__inner">
          <EntryPoints />
          <LoopExplainer />
          <Participants />
          <Questions />
          <Contact />

          <div className="console__foot">
            <p className="console__foot-line">
              CLIRevenue is an early-stage prototype. The film, the workbench and the console
              above are demonstration code: there is no backend, no marketplace and no payment
              rail behind any of it yet.
            </p>
          </div>
        </div>
      </section>
    </MotionConfig>
  )
}

export default Conversion
