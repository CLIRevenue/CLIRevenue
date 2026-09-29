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
   that command's output arriving slowly.

   The hold below is what makes the frame readable at rest. Chapter
   local time starts at zero, and at zero the command has not been typed
   yet — which is the right opening for the *film* and the wrong opening
   for a *hero*, because the first thing a viewer sees is the terminal
   sitting there empty. Freezing the derivation for the first seventh of
   the chapter means scroll position zero already shows a submitted
   command with the agent just getting into it, and every frame after
   that still tracks the playhead exactly. It is a hold, not a shift:
   nothing is ever ahead of where the film would put it. */
const HOLD = 0.07

const SCRIPT = {
  command: waitScene.command,
  lines: [],
  resetPrompt: false,
  spans: { type: [0, 0.05], stream: [0.05, 0.96], settle: [0.96, 1] },
}

function TheWait() {
  const progress = Math.max(useSceneProgress('wait'), HOLD)
  const frame = useTerminal(SCRIPT, progress)

  return (
    <Scene id="wait" labelledBy="wait-title">
      <div className="hero">
        <header className="hero__lead">
          <span className="eyebrow">01 — the wait</span>
          <h2 className="hero__title" id="wait-title">
            <span>The slot above</span>
            <span>the command line.</span>
          </h2>
        </header>

        <div className="hero__grid">
          <div className="hero__copy">
            <p className="hero__body">
              Output is sacred. Scripts parse it, pipes consume it, people diff
              it. So the advertisement does not go in the output — it goes in a
              permanent region between the transcript and the prompt, and it
              shares what it earns.
            </p>

            <dl className="hero__facts">
              <div className="hero__fact">
                <dt>Stdout</dt>
                <dd>Untouched</dd>
              </div>
              <div className="hero__fact">
                <dt>Region</dt>
                <dd>Native, reserved</dd>
              </div>
              <div className="hero__fact">
                <dt>Split</dt>
                <dd>Four parties</dd>
              </div>
            </dl>

            <div className="hero__cta">
              <a className="btn btn--primary" href="#ad">
                Read the concept
              </a>
              <a className="btn" href="#money">
                See the split
              </a>
            </div>
          </div>

          <div className="hero__terminal">
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
          </div>
        </div>

        <div className="hero__meta" aria-hidden="true">
          <span>CLIRevenue</span>
          <span>ad slot / cli</span>
          <span>session 0001</span>
          <span>rev — shared</span>
          <span className="hero__meta-signal">live</span>
        </div>
      </div>
    </Scene>
  )
}

export default TheWait
