import { useEffect, useRef } from 'react'
import './landing.css'
import { landingFx } from './landing.js'
import HeartFooter from './HeartFooter.jsx'
import { spaNav } from '../../hooks/useAppRoute.js'

const STEPS = [
  {
    n: '1',
    title: 'Register on the website',
    body:
      'Register and we issue you a unique publisher key — that key is what authorises your ad serving. One key maps to exactly one CLI, and that CLI can carry as many ad slots as you need. Want slots in a second CLI? Request a second key.',
    pre: [
      ['c', '$ clirevenue keys'],
      ['', 'clv_7f2a91c0  claude-code   3 slots'],
      ['', 'clv_b4e08d3a  aider          1 slot'],
    ],
  },
  {
    n: '2',
    title: 'Install and run the setup command',
    body:
      'Install the SDK, run the setup command, and paste your key when it asks. It verifies the key, then writes clirevenue.json next to your project.',
    pre: [
      ['c', '$ npm install @clirevenue/sdk'],
      ['c', '$ npx clirevenue sdk'],
      ['y', '? paste your key › clv_7f2a91c0'],
      ['g', '✓ verified · clirevenue.json'],
    ],
  },
  {
    n: '3',
    title: 'Configure your slots, then leave it alone',
    body:
      'Open whichever CLI you build for and set where each ad slot sits and how big it is. Once a slot is configured, ads are delivered into it automatically — no per-impression work on your side.',
    pre: [
      ['c', '$ claude-code'],
      ['b', '// /slots'],
      ['', 'status-bar     inline    60x1'],
      ['', 'sidebar-foot   stacked   280x24'],
      ['g', '✓ 2 slots live · automatic'],
    ],
  },
]

const PLATFORM = [
  ['Serve', 'The SDK owns the render path. One call places a slot; the network decides what fills it.'],
  ['Gate', 'An impression only counts once the slot is on screen and viewable for long enough to read.'],
  ['Queue', 'Fills are delivered offline and replayed, so a missed window is not a missed impression.'],
  ['Dedupe', 'Every impression is keyed by user, slot and time, so no surface is ever paid twice.'],
  ['Settle', 'Revenue accrues per qualified impression and settles on a monthly cycle.'],
  ['Withdraw', 'Any publisher key can request payouts once the review window has cleared.'],
]

const TRUST = [
  ['Nothing is read', 'No prompt, no file, no stdout. The SDK writes to a region of the terminal it was given.'],
  ['Nothing is uploaded', 'Identifiers are hashed at the edge and aggregated before they reach the network.'],
  ['Every slot is yours', 'You choose the placement, the size, the host and the frequency. Opt out of any of them.'],
]

const ASSURE = [
  'One SDK dependency, no build step',
  'Works offline; fills replay on reconnect',
  'A key can be revoked from the dashboard',
]

const ROLES = [
  {
    k: 'For developers',
    h: 'Put a slot where your users already look',
    p:
      'Publishers keep a share of every qualified impression. Register, paste your key, size your slots — the network handles the rest.',
    a: 'Start earning — free',
  },
  {
    k: 'For advertisers',
    h: 'Buy attention inside the tools people already use',
    p:
      'Target the exact command someone is running, not a demographic. Campaigns are priced per viewable impression, reviewed before delivery.',
    a: 'Start a campaign',
  },
]

export default function Landing() {
  const root = useRef(null)

  useEffect(() => {
    const el = root.current
    if (!el) return undefined
    return landingFx(el)
  }, [])

  return (
    <div className="landing" ref={root}>
      <header className="nav">
        <div className="nav-in">
          <a href="#top" className="brand-text brand-text-landing" aria-label="CLIRevenue — back to top">
            <span className="brand-cli">CLI</span>
            <span className="brand-revenue">Revenue</span>
          </a>

          <nav className="nav-links" aria-label="Landing Navigation">
            <a href="#preview">Product</a>
            <a href="#how">How it works</a>
            <a href="#platform">Platform</a>
            <a href="#trust">Trust</a>
            <a href="#advertisers">Advertisers</a>
            <a href="#qsFace">Get started</a>
          </nav>

          <div className="nav-cta">
            <a className="lbtn lbtn--ghost lbtn--sm" href="/developer" onClick={spaNav}>For developers</a>
            <a className="lbtn lbtn--ghost lbtn--sm" href="/advertiser" onClick={spaNav}>For advertisers</a>
            <a className="lbtn lbtn--ghost lbtn--sm" href="/login" onClick={spaNav}>Sign in</a>
            <a className="lbtn lbtn--primary lbtn--sm" href="/signup" onClick={spaNav}>Sign up</a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="cube-face cube-face--hero" id="heroFace">
          <div className="axis" aria-hidden="true">
            <i className="axis-x" />
            <i className="axis-y" />
            <b className="axis-cross" />
            <b className="axis-tag axis-tag--x">x 0000</b>
            <b className="axis-tag axis-tag--y">y 0000</b>
          </div>

          <span className="face-label" aria-hidden="true">CLIRevenue — axis 0000</span>

          <div className="marquee" id="marquee" aria-hidden="true" />
          <div className="marquee-hint" aria-hidden="true">
            Drag a box anywhere on this page to leave a note. It stays until you clear it.
          </div>
          <div className="note" id="note" hidden>
            <span className="note-title">Note</span>
            <textarea
              className="note-input"
              id="noteInput"
              rows={3}
              spellCheck={false}
              placeholder="Write a note… it stays until you clear it."
            />
            <div className="note-bar">
              <span className="note-warn" id="noteWarn" role="status" />
              <span className="note-saved" id="noteSaved" hidden>kept in this browser</span>
              <button type="button" className="note-btn" id="noteClean" hidden>Clean</button>
              <button type="button" className="note-btn" id="noteClose">Delete</button>
            </div>
          </div>
          <div className="lhero wrap" data-mood="aura">
            <span className="leyebrow" data-reveal><span className="dot" />Sponsor network for the terminal</span>
            <h1 className="pickable" data-reveal style={{ '--d': '60ms' }}>
              <span data-pick>Sponsors in the tools developers<span className="muted"> already live in.</span></span>
            </h1>
            <p className="lede" data-reveal style={{ '--d': '120ms' }}>
              CLIRevenue buys attention in the command line. Publishers place a slot, get a key, and keep a share
              of every qualified impression — without reading a single prompt.
            </p>
            <div className="lhero-actions" data-reveal style={{ '--d': '180ms' }}>
              <a className="lbtn lbtn--primary magnetic" href="#start">Start earning — free</a>
              <a className="lbtn lbtn--ghost" href="#advertisers">Put your ad on CLIRevenue</a>
            </div>
            <p className="lhero-note" data-reveal style={{ '--d': '220ms' }}>
              Zero SDK dependencies · 60-character sponsor budget · one command to revert
            </p>
          </div>
        </section>

        <section className="cube-face cube-face--qs" id="qsFace">
          <div className="wrap quickstart">
            <span className="sec-kicker" data-n="01" data-reveal>Get started</span>
            <h2 className="pickable" id="qs-title" data-reveal>
              <span data-pick>Two commands to your first sponsor line.</span>
            </h2>
            <p className="lede" data-reveal>
              Install the SDK, register your publisher key, and the first slot is live.
            </p>

            <ol className="qs-list">
              <li className="qs-step" data-reveal style={{ '--d': '180ms' }}>
                <span className="qs-n" aria-hidden="true">1</span>
                <div className="qs-body">
                  <h3 className="qs-title">Install the SDK</h3>
                  <p className="qs-note">Add it to the package that renders your terminal UI.</p>
                  <div className="cmd">
                    <code className="cmd-line"><span className="p">$</span> npm install @clirevenue/sdk</code>
                    <button className="cmd-copy" type="button" data-copy="npm install @clirevenue/sdk" aria-label="Copy npm install command">Copy</button>
                  </div>
                </div>
              </li>

              <li className="qs-step" data-reveal style={{ '--d': '280ms' }}>
                <span className="qs-n" aria-hidden="true">2</span>
                <div className="qs-body">
                  <h3 className="qs-title">Configure and go live</h3>
                  <p className="qs-note">
                    Registers the plugin, writes <code className="qs-inline">clirevenue.json</code>, and prints a revert command.
                  </p>
                  <div className="cmd">
                    <code className="cmd-line"><span className="p">$</span> npx clirevenue sdk</code>
                    <button className="cmd-copy" type="button" data-copy="npx clirevenue sdk" aria-label="Copy setup command">Copy</button>
                  </div>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section id="preview" className="wrap sec">
          <canvas className="liquid" id="liquid" aria-hidden="true" />
          <div className="sec-head">
            <span className="sec-kicker" data-n="02" data-reveal>The product</span>
            <h2 className="pickable" data-reveal>
              <span data-pick>One line, in the status bar.</span>
            </h2>
            <p className="sec-sub" data-reveal>
              A sponsor appears once, in a region you sized, for a budget you capped.
            </p>
          </div>
          <div className="ba">
            <div className="ba-side">
              <div className="term">
                <div className="term-bar"><i /><i /><i /></div>
                <div className="term-body">
                  <div><span className="p">$</span> npm run dev</div>
                  <div><span className="p">$</span> claude-code</div>
                  <div>&nbsp;</div>
                  <div><span className="p">&gt;</span> <span className="b">vite</span> ready in 412 ms</div>
                </div>
              </div>
              <p className="ba-cap">Without a slot, the tool is only yours.</p>
            </div>
            <div className="ba-side">
              <div className="term">
                <div className="term-bar"><i /><i /><i /></div>
                <div className="term-body">
                  <div><span className="p">$</span> claude-code</div>
                  <div>&nbsp;</div>
                  <div><span className="p">&gt;</span> <span className="b">vite</span> ready in 412 ms</div>
                  <div>&nbsp;</div>
                  <div><span className="p">sponsor</span> <span className="g">jetbrains</span> — save 20% on a team licence</div>
                </div>
              </div>
              <p className="ba-cap">With one, the same session carries a sponsor.</p>
            </div>
          </div>
        </section>

        <section id="how" className="wrap sec">
          <div className="sec-head">
            <span className="sec-kicker" data-n="03" data-reveal>How it works</span>
            <h2 className="pickable" data-reveal>
              <span data-pick>Register, paste your key, size your slots.</span>
            </h2>
            <p className="sec-sub" data-reveal>
              After that the network picks the campaign, gates the impression on viewability, queues it offline,
              deduplicates it, and settles monthly.
            </p>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <article className="step" key={s.n} data-reveal style={{ '--d': `${i * 80}ms` }}>
                <div className="n">{s.n}</div>
                <h4>{s.title}</h4>
                <p className="p">{s.body}</p>
                <pre className="pre">
                  {s.pre.map(([cls, line], k) => (
                    <span className={cls ? `l-${cls}` : 'l-p'} key={k}>{line}{'\n'}</span>
                  ))}
                </pre>
              </article>
            ))}
          </div>
        </section>

        <section id="platform" className="wrap sec">
          <div className="sec-head">
            <span className="sec-kicker" data-n="04" data-reveal>Platform</span>
            <h2 className="pickable" data-reveal>
              <span data-pick>Six things that have to be true.</span>
            </h2>
            <p className="sec-sub" data-reveal>
              Any one of them missing and the network is just an ad server with a nicer logo.
            </p>
          </div>
          <div className="bento bento--platform">
            {PLATFORM.map(([h, p], i) => (
              <article className="cell" key={h} data-reveal data-spot style={{ '--d': `${i * 50}ms` }}>
                <h3>{h}</h3>
                <p>{p}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="trust" className="wrap sec sec--tint">
          <div className="sec-head">
            <span className="sec-kicker" data-n="05" data-reveal>Trust is the product</span>
            <h2 className="pickable" data-reveal>
              <span data-pick>We do not read your terminal.</span>
            </h2>
            <p className="sec-sub" data-reveal>
              A developer tool that reads the terminal is not a developer tool.
            </p>
          </div>
          <div className="trust">
            {TRUST.map(([h, p], i) => (
              <article className="tcell" key={h} data-reveal style={{ '--d': `${i * 70}ms` }}>
                <h3>{h}</h3>
                <p>{p}</p>
              </article>
            ))}
          </div>
          <ul className="assure">
            {ASSURE.map((a) => <li key={a} data-reveal>{a}</li>)}
          </ul>
        </section>

        <section id="advertisers" className="wrap sec sec--tint">
          <div className="sec-head">
            <span className="sec-kicker" data-n="06" data-reveal>Two sides, one network</span>
            <h2 className="pickable" data-reveal>
              <span data-pick>Whoever runs the terminal, both sides get a deal.</span>
            </h2>
          </div>
          <div className="roles">
            {ROLES.map((r, i) => (
              <article className="role" key={r.k} data-reveal style={{ '--d': `${i * 80}ms` }}>
                <p className="k">{r.k}</p>
                <h3>{r.h}</h3>
                <p>{r.p}</p>
                <a className="lbtn lbtn--primary" href={i === 0 ? '#start' : '/advertiser'}>{r.a}</a>
              </article>
            ))}
          </div>
        </section>

        <section id="start" className="wrap sec">
          <div className="cta-band" data-reveal>
            <div className="cta-band__copy">
              <h2 className="pickable"><span data-pick>Put a sponsor line in your terminal.</span></h2>
              <p>Run the setup against a clean project, keep the settings backup, and see your first qualified impression before you decide anything.</p>
            </div>
            <a className="lbtn lbtn--primary" href="/signup">Start earning — free</a>
          </div>
        </section>
      </main>

      <footer className="foot">
        <HeartFooter />
        <p className="foot-brand"><span className="brand-cli">CLI</span><span className="brand-revenue">Revenue</span></p>
        <div className="foot-cols">
          <div className="foot-col">
            <h5>Network</h5>
            <a href="#platform">Platform</a>
            <a href="#trust">Trust</a>
            <a href="#advertisers">Advertisers</a>
          </div>
          <div className="foot-col">
            <h5>Product</h5>
            <a href="#how">How it works</a>
            <a href="#preview">Preview</a>
            <a href="/developer">Developer docs</a>
          </div>
          <div className="foot-col">
            <h5>Account</h5>
            <a href="/login">Log in</a>
            <a href="/signup">Sign up</a>
          </div>
        </div>
        <p className="foot-base">
          <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms &amp; Conditions</a>
        </p>
        <p className="foot-base">© {new Date().getFullYear()} CLIRevenue</p>
      </footer>
    </div>
  )
}