import Scene from '../Scene.jsx'
import { brand, ctaScene } from '../../data/demo.js'

function wordmark() {
  const [head, tail] = brand.name.split('Revenue')
  return (
    <>
      {head}
      <em>Revenue</em>
      {tail}
    </>
  )
}

function Cta() {
  return (
    <Scene id="cta" labelledBy="cta-headline">
      <div className="closing">
        <h2 className="closing__headline" id="cta-headline">
          <span>{brand.headline[0]} </span>
          <span>{brand.headline[1]}</span>
        </h2>

        <p className="closing__verbs">
          {brand.verbs.map((verb, i) => (
            <span key={verb}>
              {i > 0 && ' '}
              {verb}
            </span>
          ))}
        </p>

        <div className="closing__mark">
          <span className="closing__wordmark">{wordmark()}</span>
          <span className="closing__status">{brand.status}</span>
          <p className="closing__ask">{brand.ask}</p>
          <span className="eyebrow eyebrow--plain">{ctaScene.eyebrow}</span>
        </div>
      </div>
    </Scene>
  )
}

export default Cta
