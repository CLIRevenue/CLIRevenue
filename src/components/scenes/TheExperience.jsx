import Scene from '../Scene.jsx'
import Terminal from '../Terminal.jsx'
import OutputStream from '../OutputStream.jsx'
import { PromoAd } from '../PromoAd.jsx'
import { useSceneProgress } from '../../hooks/useSceneProgress.js'
import { useTerminal } from '../../hooks/useTerminal.js'
import { experienceScene, hostApp } from '../../data/demo.js'

const SCRIPT = {
  command: experienceScene.command,
  lines: experienceScene.output,
  spans: { type: [0.02, 0.26], stream: [0.3, 0.72], settle: [0.72, 1] },
}

function TheExperience() {
  const progress = useSceneProgress('experience')
  const frame = useTerminal(SCRIPT, progress)

  return (
    <Scene
      id="experience"
      label={experienceScene.eyebrow}
      title="The command line keeps working."
      body="The advertisement is part of the interface, not the output. Pipelines and scripts still receive exactly what the tool emits, and the user never loses their place."
    >
      <Terminal
        title={hostApp.windowTitle}
        live
        outHeight="tall"
        frame={frame}
        slot="ad"
        foot="json on stdout · exit 0"
        hint="still yours to use"
      >
        <OutputStream lines={frame.lines} />
        <PromoAd index={1} variant="compact" />
      </Terminal>

      <ul className="annot">
        {experienceScene.annotations.map((item, i) => (
          <li key={item.label} className="annot__item">
            <span className="annot__index">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="annot__label">{item.label}</span>
          </li>
        ))}
      </ul>
    </Scene>
  )
}

export default TheExperience