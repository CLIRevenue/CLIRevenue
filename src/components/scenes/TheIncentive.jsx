import Scene from '../Scene.jsx'
import { incentiveScene } from '../../data/demo.js'

function TheIncentive() {
  return (
    <Scene
      id="incentive"
      label={incentiveScene.eyebrow}
      title="Every side has a reason to participate."
      body="Reach the people who actually read documentation, let the audience benefit from the interruption, and give open source a way to pay for itself."
    >
      <ul className="benefits">
        {incentiveScene.benefits.map((benefit) => {
          const Icon = benefit.icon
          return (
            <li key={benefit.id} className="benefit">
              <span className="benefit__rule" />
              <span className="benefit__icon">
                <Icon aria-hidden="true" />
              </span>
              <span className="benefit__label">{benefit.label}</span>
              <p className="benefit__body">{benefit.body}</p>
            </li>
          )
        })}
      </ul>
    </Scene>
  )
}

export default TheIncentive
