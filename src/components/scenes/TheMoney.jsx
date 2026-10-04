import RevenueFlow from '../RevenueFlow.jsx'
import Scene from '../Scene.jsx'
import { ecosystem } from '../../data/demo.js'

function TheMoney() {
  return (
    <Scene
      id="money"
      label={ecosystem.eyebrow}
      title="One ecosystem, four participants."
      body="An advertiser runs a campaign and pays CLIRevenue. CLIRevenue operates the ad network and delivers the campaign to the developer who integrated it into their app or site, which serves the advertisement to the user."
    >
      <RevenueFlow />
    </Scene>
  )
}

export default TheMoney
