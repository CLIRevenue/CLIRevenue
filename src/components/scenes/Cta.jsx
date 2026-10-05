import Scene from '../Scene.jsx'
import { brand, ctaScene, arrowGlyph } from '../../data/demo.js'

const Arrow = arrowGlyph

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

          {/* The film asks a question in its last line, so it owes the
              reader somewhere to answer it. These reuse the site's own
              button language and point at the public onboarding pages —
              the closing frame should not be the one place a visitor has
              to create an account to find out whether they want to. */}
          <nav className="closing__actions" aria-label="Get started">
            {ctaScene.actions.map((action) => (
              <a
                key={action.id}
                className="closing__action"
                href={action.href}
              >
                <span className="closing__action-copy">
                  <span className="closing__action-label">{action.label}</span>
                  <span className="closing__action-note">{action.note}</span>
                </span>
                <Arrow className="closing__action-arrow" aria-hidden="true" />
              </a>
            ))}
          </nav>
        </div>
      </div>
    </Scene>
  )
}

export default Cta
