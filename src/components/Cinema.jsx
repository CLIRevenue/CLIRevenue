/* =============================================================
   CLIRevenue — the stage
   -------------------------------------------------------------
   The component that owns the scrollbar. Everything else in the
   prototype reads from it and writes nothing back, so there is
   exactly one owner of the playhead and one place where it is
   mounted.

   `MotionConfig` is here as the React-side reduced-motion switch.
   GSAP has its own path — the cinema hook skips the timeline entirely
   when motion is reduced — and this is the equivalent for the
   interaction layer, so a viewer who asks for less motion gets none
   from either. It renders no element of its own, so the stage stays
   the outermost node and the GSAP context scoping is unaffected.
   ============================================================= */

import { useRef } from 'react'
import { MotionConfig } from 'motion/react'

import useCinema from '../hooks/useCinema.js'
import Intro from './Intro.jsx'
import Cta from './scenes/Cta.jsx'
import TheAd from './scenes/TheAd.jsx'
import TheExperience from './scenes/TheExperience.jsx'
import TheIncentive from './scenes/TheIncentive.jsx'
import TheMoney from './scenes/TheMoney.jsx'
import TheWait from './scenes/TheWait.jsx'

function Cinema() {
  const stageRef = useRef(null)

  useCinema(stageRef)

  return (
    <MotionConfig reducedMotion="user">
      {/* The boot overlay is a sibling of the stage, not a child of it:
          it is `position: fixed`, it is gone by the time the film
          starts, and the stage must stay the outermost element of the
          film so the GSAP context keeps its scope. */}
      <Intro />

      {/* The film has no visible title — it opens on a cursor in an
          empty terminal, and a masthead would break that. It still
          needs one for the document outline, so it is carried
          visually rather than not at all. It sits outside `<main>`
          so the stage remains the outermost element of the film and
          the GSAP context keeps its scope. */}
      <h1 className="visually-hidden">
        CLIRevenue — turn terminal attention into shared revenue
      </h1>

      <main className="stage" ref={stageRef}>
        <TheWait />
        <TheAd />
        <TheMoney />
        <TheExperience />
        <TheIncentive />
        <Cta />
      </main>
    </MotionConfig>
  )
}

export default Cinema
