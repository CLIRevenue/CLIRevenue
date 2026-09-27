/* =============================================================
   CLIRevenue — the agent at work
   -------------------------------------------------------------
   A list of the states an agent passes through. It is deliberately
   not a progress bar and deliberately not numbered: the scene it
   belongs to is about time spent producing no output, so anything
   measurable on this screen would be the wrong information.

   Every row stays mounted. Which row is lit is a runtime state owned
   by the cinema hook, and the stylesheet's default is the whole list
   visible — so a viewer who has asked for less motion, and for whom
   no timeline is built at all, reads the states the agent moves
   through rather than an empty box. For the same reason nothing here
   is hidden from assistive technology: this is a list of what the
   agent did, and that is true whether or not it is currently lit.
   ============================================================= */

import { waitScene } from '../data/demo.js'

function AgentStream() {
  return (
    <ul className="work" aria-label="Agent activity">
      {waitScene.activity.map((step) => (
        <li className="work__item" key={step.id}>
          <span className="work__line">
            <span className="work__text">{step.text}</span>
            <span className="work__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
          <span className="work__detail">{step.detail}</span>
        </li>
      ))}
    </ul>
  )
}

export default AgentStream
