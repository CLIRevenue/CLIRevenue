import Scene from '../Scene.jsx'
import Terminal from '../Terminal.jsx'
import { useSceneProgress } from '../../hooks/useSceneProgress.js'
import { useTerminal } from '../../hooks/useTerminal.js'
import { adScene, hostApp } from '../../data/demo.js'

/* The ad owns the closing third of this chapter. Output has to be
   finished streaming and settled before the slot starts to arrive,
   otherwise the two are competing for the same attention. */
const SCRIPT = {
  command: adScene.command,
  lines: adScene.output,
  spans: { type: [0.02, 0.24], stream: [0.28, 0.66], settle: [0.66, 1] },
}

function TheAd() {
  const progress = useSceneProgress('ad')
  const frame = useTerminal(SCRIPT, progress)

  return (
    <Scene
      id="ad"
      label={adScene.eyebrow}
      title="A reserved region above the command line."
      body="The host application keeps running. The advertisement sits in its own surface between the output and the prompt, so it is never mistaken for something the tool printed."
    >
      <Terminal
        title={hostApp.windowTitle}
        live
        outHeight="tall"
        frame={frame}
        showAd
        slot="ad"
        foot="stdout · clean"
        hint="ad slot · reserved region"
      />
    </Scene>
  )
}

export default TheAd
