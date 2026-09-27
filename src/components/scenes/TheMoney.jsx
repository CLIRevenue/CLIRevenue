import RevenueFlow from '../RevenueFlow.jsx'
import Scene from '../Scene.jsx'
import { ecosystem } from '../../data/demo.js'

function TheMoney() {
  return (
    <Scene
      id="money"
      label={ecosystem.eyebrow}
      title="One ecosystem, four participants."
      body="The platform provides the infrastructure and takes a service fee. A share flows back to the users and developers who built the terminal experience."
    >
      <RevenueFlow />
    </Scene>
  )
}

export default TheMoney
