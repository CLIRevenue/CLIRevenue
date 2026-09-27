import Scene from '../Scene.jsx'
import Terminal from '../Terminal.jsx'
import AgentStream from '../AgentStream.jsx'
import { useSceneProgress } from '../../hooks/useSceneProgress.js'
import { useTerminal } from '../../hooks/useTerminal.js'
import { hostApp, waitScene } from '../../data/demo.js'

/* Almost all of this scene is spent with the command already submitted,
   so the typing span is over almost immediately — the caret leaving the
   prompt is the first thing that happens, and it is exactly what a busy
   shell does. The prompt keeps the command because the stream below is
   that command's output arriving slowly. */
const SCRIPT = {
  command: waitScene.command,
  lines: [],
  resetPrompt: false,
  spans: { type: [0, 0.05], stream: [0.05, 0.96], settle: [0.96, 1] },
}

function TheWait() {
  const progress = useSceneProgress('wait')
  const frame = useTerminal(SCRIPT, progress)

  return (
    <Scene id="wait" ariaLabel={waitScene.ariaLabel}>
      <Terminal
        title={hostApp.windowTitle}
        live
        outHeight="tall"
        frame={frame}
        foot="stdout · silent while the agent works"
        hint="waiting"
      >
        <AgentStream />
      </Terminal>
    </Scene>
  )
}

export default TheWait
