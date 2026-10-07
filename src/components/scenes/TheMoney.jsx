import RevenueFlow from '../RevenueFlow.jsx'
import Scene from '../Scene.jsx'
import { PromoAd } from '../PromoAd.jsx'
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

      {/* The split is the point of this chapter, so the split's own
          mechanism card sits under the diagram it explains. */}
      <PromoAd index={5} variant="compact" />
    </Scene>
  )
}

export default TheMoney
