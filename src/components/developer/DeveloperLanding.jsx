/* =============================================================
   CLIRevenue — public developer landing / SDK onboarding
   -------------------------------------------------------------
   A developer who lands here should be able to answer, in order:

     1. What CLIRevenue is.
     2. What the SDK does.
     3. How to install it.
     4. How to get a publishable key.
     5. How placements work.
     6. How an ad is rendered.
     7. How impressions and clicks work.
     8. How sizing/positioning works.
     9. Where the documentation lives.
    10. Where to download/install the SDK.

   This is intentionally a public page: it is reachable without an
   account, because install does not require one. It is NOT the
   role-gated `DeveloperApp` dashboard (`/app/developer`), which owns
   account earnings and delivery status. Keep those two pages separate.

   The SDK surface is OpenCode's track: this page reflects the API that
   exists in the repository, the complete and final layout config object,
   size limits, the nine anchors, offset clamping and terminal
   containment. It never invents a method or a field.

   Structure of this revision:
     - the stylesheet is imported HERE. It was previously imported
       nowhere, so none of the `sdk-*` rules loaded and the page fell
       back to the shared page classes alone.
     - a masthead (the page previously had no way back to the site), an
       asymmetric hero built around a real integration plate, and a
       sticky section rail.
     - the sections alternate between three layout families — numbered
       rail, specimen table, code-led flow — instead of repeating one
       bordered card eleven times.
     - the section copy carries two inline markers, <code>…</code> and
       `…`, because it is authored as data. `Rich` renders them; a
       literal `<code>` used to reach the reader as visible text.
   ============================================================= */

import { navigateApp } from '../../hooks/useAppRoute.js'

import { Panel } from '../console/ui.jsx'
import CopyButton from '../CopyButton.jsx'
import clirevenue from '../../lib/clirevenue.js'
import './DeveloperLanding.css'

/* ------------------------------------------------------------------
   Copy-pasteable install block, with a single source of truth for the
   package name and the published version.
   ------------------------------------------------------------------ */

const PACKAGE_NAME = '@clirevenue/sdk'

/* Read the version from the SDK rather than repeating it here. The comment
   above promises a single source of truth, and a literal in this file is
   exactly the thing that would drift out of step with the package. */
const SDK_VERSION = clirevenue.sdkVersion

/* On this page. The rail is the one navigational affordance this page can
   honestly offer: it needs no hosted documentation site, and it is what
   lets a reader move between eleven sections without scrolling blind. */
const SECTIONS = [
  { id: 'install', n: '01', label: 'Install' },
  { id: 'publishable-key', n: '02', label: 'Key' },
  { id: 'placements', n: '03', label: 'Placements' },
  { id: 'download', n: '04', label: 'Distribution' },
  { id: 'render', n: '05', label: 'Rendering' },
  { id: 'sizing', n: '06', label: 'Sizing' },
  { id: 'lifecycle', n: '07', label: 'Lifecycle' },
  { id: 'faq', n: '08', label: 'FAQ' },
  { id: 'documentation', n: '09', label: 'Docs' },
]

/* ------------------------------------------------------------------
   Inline technical markup.
   -------------------------------------------------------------
   The section copy is authored as data, so a code reference inside a
   sentence is written <code>console-workbench</code> or `destroy()`.
   React escapes strings, so rendering a string directly printed the
   markup itself. This reader understands exactly those two markers and
   nothing else: no HTML parsing, no dangerouslySetInnerHTML.
   ------------------------------------------------------------------ */

/* The backtick is written as \u0060 rather than literally: this file's
   template literals are counted by scripts/check-jsx-templates.mjs, and an
   odd literal backtick inside a regex would read as an unclosed template. */
const INLINE_MARKUP = /(<code>[\s\S]*?<\/code>|\u0060[^\u0060]*\u0060)/

function Rich({ children }) {
  const text = String(children ?? '')
  return text.split(INLINE_MARKUP).map((chunk, i) => {
    if (!chunk) return null
    if (chunk.startsWith('<code>') && chunk.endsWith('</code>')) {
      return (
        <code className="sdk-inline" key={i}>
          {chunk.slice(6, -7)}
        </code>
      )
    }
    if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 1) {
      return (
        <code className="sdk-inline" key={i}>
          {chunk.slice(1, -1)}
        </code>
      )
    }
    return chunk
  })
}

/* ------------------------------------------------------------------
   A code plate: one hairline frame, a mono tag, an optional action in
   the bar, and the code itself. The copy control lives in the bar
   rather than inside the <pre>, where it used to sit in a flex row
   nested inside the code block itself.
   ------------------------------------------------------------------ */

function CodeBlock({ children, label = 'js', action = null }) {
  return (
    <figure className="sdk-code">
      <figcaption className="sdk-code__bar">
        <span className="sdk-code__tag">{label}</span>
        {action}
      </figcaption>
      <pre className="sdk-code__pre">
        <code>{children}</code>
      </pre>
    </figure>
  )
}

/* ------------------------------------------------------------------
   Copy-to-clipboard button. The behavior lives in the shared
   CopyButton module so /developer and /advertiser cannot drift apart;
   it still renders as a real <button> in the plate's bar — never
   inside the <pre> — with an accessible label and a visible focus
   ring. Success is cosmetic and never asserts anything about the
   network or the account. The `sdk-copy` base is this page's styling
   hook in DeveloperLanding.css.
   ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
   Distribution. The section deliberately does NOT invent a URL: the SDK
   is distributed through npm, so the artifact is the install command and
   the plate carries it. "Download SDK" stays visible and points at the
   documentation until a release asset or packed tarball exists — the gap
   flagged in docs/AI_HANDOFF.md, stated next to the link rather than in
   a paragraph above it.
   ------------------------------------------------------------------ */

const DOWNLOAD_FACTS = [
  { label: 'Package', value: PACKAGE_NAME },
  { label: 'Version', value: SDK_VERSION },
  { label: 'Format', value: 'ESM only' },
  { label: 'Dependencies', value: 'None (runtime)' },
]

function DownloadSection() {
  return (
    <div className="sdk-split">
      <div className="sdk-split__main">
        <p className="sdk-version">
          <span className="sdk-version__mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 1.5v13M1.5 8h13"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <circle cx="8" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </span>
          <span className="sdk-version__label">Latest version</span>
          <span className="sdk-version__value">{SDK_VERSION}</span>
        </p>

        <p className="sdk-p">
          The SDK ships as an ESM-only npm package with its own type
          declarations and no runtime dependencies. npm is the canonical
          distribution source; install it with the command below.
        </p>

        <CodeBlock
          label="shell"
          action={
            <CopyButton text={`npm install ${PACKAGE_NAME}`} label="npm install command" />
          }
        >
          {`npm install ${PACKAGE_NAME}`}
        </CodeBlock>

        <div className="sdk-actions">
          <a className="btn btn--ghost" href="#documentation">
            Download SDK
          </a>
        </div>

        <p className="sdk-note">
          There is no private artifact server in this repository, so the
          download button links to this page's documentation section
          rather than a made-up URL. When a release asset or packed
          tarball is published, that URL will be wired here instead.
        </p>
      </div>

      <dl className="sdk-spec sdk-spec--card">
        {DOWNLOAD_FACTS.map((fact) => (
          <div className="sdk-spec__row" key={fact.label}>
            <dt className="sdk-spec__key">{fact.label}</dt>
            <dd className="sdk-spec__value">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
/* ------------------------------------------------------------------
   The quickstart is short enough to sit above the fold: the five things
   a developer has to do, in order. Every API symbol here exists today
   in the repository; nothing is invented.
   ------------------------------------------------------------------ */

const QUICKSTART_STEPS = [
  {
    n: '1',
    lang: 'shell',
    title: 'Install the SDK',
    code: `npm install ${PACKAGE_NAME}`,
  },
  {
    n: '2',
    lang: 'js',
    title: 'Create / get a publishable key',
    code: `// The key lives in your build environment, not in this file.\nconst key = import.meta.env.VITE_CLIREVENUE_PUBLISHABLE_KEY`,
  },
  {
    n: '3',
    lang: 'js',
    title: 'Initialize CLIRevenue',
    code: `import { init } from '${PACKAGE_NAME}'\n\nconst cli = init(key, {\n  baseUrl: import.meta.env.VITE_API_BASE_URL,\n})`,
  },
  {
    n: '4',
    lang: 'js',
    title: 'Select a placement',
    code: `const PLACEMENT = 'console-workbench'`,
  },
  {
    n: '5',
    lang: 'js',
    title: 'Render an ad',
    code: `const { served, dispose } = await cli.render(PLACEMENT, '#ad-region')\nif (!served) {\n  // No fill: render your own fallback instead.\n}\n\n// When the slot unmounts, stop watching for viewability.\ndispose()`,
  },
]

function Quickstart() {
  return (
    <div className="sdk-qs">
      <header className="sdk-head sdk-head--lg">
        <h3 className="sdk-head__title" id="quickstart">
          Quickstart
        </h3>
      </header>
      <ol className="sdk-qs__steps">
        {QUICKSTART_STEPS.map((step) => (
          <li className="sdk-qs__step" key={step.n}>
            <span className="sdk-qs__n" aria-hidden="true">
              {step.n}
            </span>
            <div className="sdk-qs__body">
              <h4 className="sdk-qs__title">{step.title}</h4>
              <CodeBlock
                label={step.lang}
                action={
                  <CopyButton
                    text={step.code}
                    label={step.lang === 'shell' ? 'shell command' : 'code snippet'}
                  />
                }
              >
                {step.code}
              </CodeBlock>
            </div>
          </li>
        ))}
      </ol>
      <p className="sdk-note">
        <Rich>The CLIRevenue instance is created once per page and shared by every placement. Call `destroy()` when the owner surface is removed, for example in a React effect cleanup.</Rich>
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------
   Publishable key
   ------------------------------------------------------------------ */

const KEY_FACTS = [
  {
    label: 'Safe in the browser',
    body: 'VITE_CLIREVENUE_PUBLISHABLE_KEY · VITE_API_BASE_URL.',
  },
  {
    label: 'Unsafe in the browser',
    body: 'The Supabase service-role key, AD_TOKEN_SECRET, SETTLEMENT_SECRET, or any private signing material.',
  },
  {
    label: 'Where it comes from',
    body: 'Created by an operator and issued to the developer as pk_test_… or pk_live_…. Only a SHA-256 hash is stored on the server.',
  },
]

function PublishableKey() {
  return (
    <Panel className="sdk-panel">
      <header className="sdk-head">
        <h3 className="sdk-head__title" id="publishable-key">
          Publishable key
        </h3>
      </header>
      <p className="sdk-p">
        A publishable key is an identifier. It is what the browser uses
        to ask the gateway for an ad, and it is safe to ship in your
        JavaScript bundle because it authorises delivery only — it cannot
        create a publisher, issue or revoke a key, create a placement or
        read a balance.
      </p>
      <dl className="sdk-spec">
        {KEY_FACTS.map((fact) => (
          <div className="sdk-spec__row" key={fact.label}>
            <dt className="sdk-spec__key">{fact.label}</dt>
            <dd className="sdk-spec__value">
              <Rich>{fact.body}</Rich>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
/* ------------------------------------------------------------------
   Lifecycle states. Six states, one grid. The live state carries the red
   dot because red is what this system uses to name a live thing; every
   other state is idle and takes a white one.
   ------------------------------------------------------------------ */

const LIFECYCLE_STATES = [
  { id: 'loading', label: 'Loading', body: 'The placement has been requested and the gateway has not answered yet.' },
  { id: 'ready', label: 'Ready', body: 'An ad was served and is being watched for viewability.' },
  { id: 'nofill', label: 'No fill', body: 'The gateway answered 204: nothing eligible. A normal outcome, not an error.' },
  { id: 'error', label: 'Error', body: 'The request failed. Show a fallback and offer to retry.' },
  { id: 'offline', label: 'Offline', body: 'Events are queued and replayed when the connection returns.' },
  { id: 'disabled', label: 'Disabled', body: 'The placement is not configured. No ad is requested.' },
]

function Lifecycle() {
  return (
    <Panel className="sdk-panel">
      <header className="sdk-head">
        <h3 className="sdk-head__title" id="lifecycle">
          Lifecycle
        </h3>
      </header>
      <ul className="sdk-states">
        {LIFECYCLE_STATES.map((state) => (
          <li
            className={`sdk-states__cell${state.id === 'ready' ? ' sdk-states__cell--live' : ''}`}
            key={state.id}
          >
            <span className="sdk-states__id">
              <span className="sdk-states__dot" aria-hidden="true" />
              {state.id}
            </span>
            <span className="sdk-states__label">{state.label}</span>
            <p className="sdk-states__body">{state.body}</p>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/* ------------------------------------------------------------------
   FAQ. Thirteen questions, two columns at desktop. The disclosure is a
   native <details>, so it works with the keyboard and without
   JavaScript; only the marker is restyled, from the browser triangle to
   a mono sign that flips on the open state.
   ------------------------------------------------------------------ */

const FAQ_ITEMS = [
  {
    q: 'What is CLIRevenue?',
    a: 'An advertising slot that lives above a CLI’s command line, with the revenue shared back to the developer. It is a working prototype of that concept.',
  },
  {
    q: 'What does the SDK do?',
    a: 'It asks the CLIRevenue gateway for an ad, hands you something to render, and counts the impression once the ad is genuinely visible. It reports events; it assigns meaning.',
  },
  {
    q: 'Is the SDK free to install?',
    a: 'Yes. It is an npm package with no runtime dependencies. There is no install fee; commercial terms are not fixed and this page makes none.',
  },
  {
    q: 'What is a publishable key?',
    a: 'A public identifier, shaped like <code>pk_test_…</code> or <code>pk_live_…</code>, that authorises an integration to request delivery and report events. It is not a credential.',
  },
  {
    q: 'Is a secret API key required in the browser?',
    a: 'No. A publishable key is safe in the bundle by design. Secrets — the Supabase service-role key, AD_TOKEN_SECRET, SETTLEMENT_SECRET — live server-side only.',
  },
  {
    q: 'What is a placement?',
    a: 'A named advertising surface chosen by the publisher when a placement is created on the server. You render ads per placement key, which is your own readable slug.',
  },
  {
    q: 'Can I resize the ad?',
    a: 'Yes. The SDK owns the geometry and keeps the ad contained by its host. Size is clamped to the band, the offset to ±512 px, and the final box always stays inside the host container. Use the layout object on render() to choose the size and anchor.',
  },
  {
    q: 'Can I move the ad?',
    a: 'Only through the placement’s position configuration; the SDK resolves the final box against the host and refuses overflow.',
  },
  {
    q: 'Can the ad leave my terminal container?',
    a: 'No. The resolved box is intersected with the host element’s box, so an ad cannot overflow its container.',
  },
  {
    q: 'What happens when there are no ads?',
    a: 'getAd() returns null. That is a normal, successful outcome and is never retried. Render your own fallback.',
  },
  {
    q: 'What happens when the network is unavailable?',
    a: 'getAd() rejects with a network error and you show your fallback. Ad requests are not queued; impressions and clicks are queued and replayed, and the SDK flushes them when it comes back online.',
  },
  {
    q: 'How are impressions recorded?',
    a: 'Once per served ad, after at least 50% of the element has been on screen for one second. The browser watches viewability; the server is authoritative.',
  },
  {
    q: 'How are clicks recorded?',
    a: 'recordClick(served) reports the click with the serve’s requestId and impressionToken. It is fire-and-forget so it cannot block navigation.',
  },
]

function Faq() {
  return (
    <>
      <header className="sdk-head">
        <h3 className="sdk-head__title" id="faq-title">
          Frequently asked questions
        </h3>
      </header>
      <div className="sdk-faq">
        {FAQ_ITEMS.map((item) => (
          <details className="sdk-faq__item" key={item.q}>
            <summary className="sdk-faq__q">
              <span>{item.q}</span>
              <span className="sdk-faq__sign" aria-hidden="true" />
            </summary>
            <p className="sdk-faq__a">
              <Rich>{item.a}</Rich>
            </p>
          </details>
        ))}
      </div>
    </>
  )
}


/* ------------------------------------------------------------------
   Main page.
   -------------------------------------------------------------
   The public site header is not mounted on this route, so the page
   carries its own masthead: a way back to the site, the two jumps that
   still exist once the rail is hidden, and the one account action. The
   hero is asymmetric — the statement on the left, a real integration
   plate on the right — and the sections below it alternate between a
   numbered rail, specimen tables and code-led flows.
   ------------------------------------------------------------------ */

/* The hero plate's snippet, hoisted so the copy control and the <pre>
   cannot disagree about the raw text — one source for both. */
const HERO_SNIPPET = `import { init } from '${PACKAGE_NAME}'

const PLACEMENT = 'console-workbench'
const cli = init(key, { baseUrl })

const { served } = await cli.render(
  PLACEMENT,
  '#ad-region',
)`

export default function DeveloperLanding() {
  return (
    <section className="sdk-page" aria-label="CLIRevenue SDK">
      <header className="sdk-top">
        <button
          type="button"
          className="sdk-top__brand"
          onClick={() => navigateApp('/')}
        >
          CLI<em>Revenue</em>
        </button>
        <span className="sitehead__nav-link sdk-top__path">/developer</span>
        <nav className="sdk-top__nav" aria-label="Developer page">
          <a className="sdk-top__link" href="#install">
            Install
          </a>
          <a className="sdk-top__link" href="#documentation">
            Docs
          </a>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigateApp('/login')}
          >
            Log in
          </button>
        </nav>
      </header>

      <div className="sdk-page__inner">
        <div className="sdk-hero">
          <div className="sdk-hero__lede">
            <p className="eyebrow eyebrow--plain">01 — CLIRevenue SDK</p>
            <h1 className="sdk-hero__title">
              Monetize your terminal application
              <span className="sdk-hero__accent"> with native advertising.</span>
            </h1>
            <p className="sdk-hero__body">
              The CLIRevenue SDK asks the CLIRevenue gateway for an ad,
              renders it in a reserved region of your interface, and
              counts the impression once the ad is genuinely visible. It
              never touches your terminal output.
            </p>
            <div className="sdk-hero__actions">
              <a className="btn btn--primary" href="#install">
                Install with npm
              </a>
              <a className="btn btn--ghost" href="#documentation">
                Documentation
              </a>
            </div>
          </div>

          <div className="sdk-plate">
            <div className="sdk-code__bar">
              <span className="sdk-code__tag">integration</span>
              <span className="sdk-plate__meta">{PACKAGE_NAME}</span>
              <CopyButton text={HERO_SNIPPET} label="integration snippet" />
            </div>
            <pre className="sdk-code__pre">
              <code>{HERO_SNIPPET}</code>
            </pre>
          </div>
        </div>

        <div className="sdk-body">
          <nav className="sdk-rail" aria-label="On this page">
            <p className="sdk-rail__label">On this page</p>
            <ol className="sdk-rail__list">
              {SECTIONS.map((section) => (
                <li className="sdk-rail__item" key={section.id}>
                  <a className="sdk-rail__link" href={`#${section.id}`}>
                    <span className="sdk-rail__n">{section.n}</span>
                    {section.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="sdk-main">
            <section className="sdk-block" id="install">
              <Quickstart />
            </section>

            <div className="sdk-row sdk-row--a">
              <section className="sdk-block">
                <PublishableKey />
              </section>
              <section className="sdk-block">
                <Placements />
              </section>
            </div>

            <section className="sdk-block" id="download">
              <header className="sdk-head">
                <h3 className="sdk-head__title" id="distribution">
                  Distribution
                </h3>
                <p className="sdk-head__sub">Where the SDK comes from.</p>
              </header>
              <DownloadSection />
            </section>

            <section className="sdk-block">
              <Delivery />
            </section>

            <div className="sdk-row sdk-row--b">
              <section className="sdk-block">
                <Sizing />
              </section>
              <section className="sdk-block">
                <Analytics />
              </section>
            </div>

            <section className="sdk-block">
              <Lifecycle />
            </section>

            <section className="sdk-block" id="faq" aria-labelledby="faq-title">
              <Faq />
            </section>

            <section className="sdk-block">
              <Panel className="sdk-panel">
                <header className="sdk-head">
                  <h3 className="sdk-head__title" id="documentation">
                    Where the documentation lives
                  </h3>
                </header>
                {/* The topic list used to be an anchor whose onClick called
                    navigateApp('/developer') — the page this link is already
                    on. It looked clickable and did nothing, which is worse
                    than not offering it: a reader who clicked it concluded the
                    documentation was missing. The reference lives in the
                    repository, not on the site, so the sentence is prose and
                    says exactly where to look. */}
                <p className="sdk-p">
                  The full reference is grouped under{' '}
                  <code className="sdk-inline">docs/developer/</code> in this
                  repository — getting-started, installation, sdk, placements,
                  ad-slots, configuration, analytics, troubleshooting. Those
                  files are the current, website-side reference; the SDK package
                  itself lives in <code className="sdk-inline">packages/sdk</code>{' '}
                  and is versioned there a separate workstream.
                </p>
              </Panel>
            </section>
          </div>
        </div>

      </div>
    </section>
  )
}

/* ------------------------------------------------------------------
   Placements
   ------------------------------------------------------------------ */

const PLACEMENT_FACTS = [
  {
    label: 'Placement key',
    body: 'Your own readable slug, e.g. <code>console-workbench</code>.',
  },
  {
    label: 'Unique',
    body: 'One key per publisher; the server owns the mapping from key to a placement row.',
  },
  {
    label: 'Stable',
    body: 'Pick it once and keep it stable across deploys; it is part of your configuration, not a generated identifier.',
  },
]

function Placements() {
  return (
    <Panel className="sdk-panel">
      <header className="sdk-head">
        <h3 className="sdk-head__title" id="placements">
          Placements
        </h3>
      </header>
      <p className="sdk-p">
        A placement is a named advertising surface. When you render an ad
        you do it for a placement key, and the key is chosen by the
        publisher when the placement is created on the server. It is your
        own readable slug — for example{' '}
        <code className="sdk-inline">console-workbench</code> — because
        you will type it into your own configuration.
      </p>
      <p className="sdk-p">
        A placement must already exist before any ad can be served for it.
        If a delivery request is made for a placement that does not exist,
        the gateway rejects it as{' '}
        <code className="sdk-inline">INVALID_PLACEMENT</code>. If the
        placement exists but is disabled, it answers as disabled rather
        than as an ad.
      </p>
      <dl className="sdk-spec">
        {PLACEMENT_FACTS.map((fact) => (
          <div className="sdk-spec__row" key={fact.label}>
            <dt className="sdk-spec__key">{fact.label}</dt>
            <dd className="sdk-spec__value">
              <Rich>{fact.body}</Rich>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

/* ------------------------------------------------------------------
   Rendering, impressions and clicks
   ------------------------------------------------------------------ */

const DELIVERY_STEPS = [
  {
    label: 'Render',
    code: `const { served, dispose } = await cli.render('console-workbench', '#ad-region')\nif (!served) {\n  renderFallback()\n}`,
    body: 'Ad delivered: the SDK appends an anchor to the selector and begins watching it for viewability.',
  },
  {
    label: 'No fill',
    code: `if (served === null) renderFallback()`,
    body: 'The gateway answered 204. That is a successful outcome, not an error, and it is never retried.',
  },
  {
    label: 'Impression',
    code: `const stopWatching = cli.watchViewability(served, element)\n// later\nstopWatching()`,
    body: 'An impression is recorded once at least 50% of the element has been on screen for one second, once per served ad.',
  },
  {
    label: 'Click',
    code: `link.addEventListener('click', () => void cli.recordClick(served).catch(() => {}))`,
    body: 'The click is reported to the gateway with the serve’s requestId and impressionToken. Fire and forget.',
  },
  {
    label: 'Conversion',
    code: `// Do NOT call trackConversion() from the browser.\n// Serve it server-side only.\n// await cli.trackConversion(requestId)`,
    body: 'A conversion is money. It is reported server-side where credentials are held. `trackConversion()` exists on the SDK for completeness.',
  },
]

function Delivery() {
  return (
    <Panel className="sdk-panel">
      <header className="sdk-head sdk-head--lg">
        <h3 className="sdk-head__title" id="render">
          Rendering an ad, and recording the events that matter
        </h3>
      </header>
      <p className="sdk-p">
        Request the ad for a placement, then render it. The cleanest way
        is <code className="sdk-inline">render()</code>, which builds an
        anchor to the served destination, wires the click and starts the
        viewability watch. Retry a failed request; do not retry a no-fill.
      </p>
      <ul className="sdk-flow">
        {DELIVERY_STEPS.map((step) => (
          <li className="sdk-flow__row" key={step.label}>
            <span className="sdk-flow__n">{step.label}</span>
            <div className="sdk-flow__body">
              <p className="sdk-flow__text">
                <Rich>{step.body}</Rich>
              </p>
              <CodeBlock label="js" action={<CopyButton text={step.code} label="code snippet" />}>
                {step.code}
              </CodeBlock>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/* ------------------------------------------------------------------
   Sizing and positioning. The nine anchors are the one idea on this page
   that a paragraph explains badly and a diagram explains instantly, so
   the diagram carries it. Only the three anchors the copy already names
   are labelled; the other six cells stay empty rather than inventing
   names that are not in AD_ANCHORS.
   ------------------------------------------------------------------ */

const ANCHOR_CELLS = ['top-left', '', '', '', 'center', '', '', '', 'bottom-right']

const SIZING_FACTS = [
  {
    label: 'Bounded dimensions',
    body: 'An ad is clamped to a minimum and maximum size. Below a minimum it is unreadable and is refused; above a maximum it is a page rather than an ad.',
  },
  {
    label: 'Anchor-based position',
    body: 'A placement places an ad with an anchor — for example <code>top-left</code>, <code>center</code>, <code>bottom-right</code> — plus a small pixel offset. There is no viewport coordinate vocabulary.',
  },
  {
    label: 'Contained by its host',
    body: 'The resolved size and position are intersected with the host element’s box, so no offset can push the ad outside it. This is the responsiveness: a small host shrinks the ad rather than letting it overflow.',
  },
  {
    label: 'Responsive behaviour',
    body: 'The SDK keeps the ad inside its container, so the same placement works in a wide terminal pane and a narrow one without any JavaScript from the publisher.',
  },
]

function Sizing() {
  return (
    <Panel className="sdk-panel">
      <header className="sdk-head">
        <h3 className="sdk-head__title" id="sizing">
          Sizing and positioning
        </h3>
      </header>
      <p className="sdk-p">
        Ad sizing and positioning are handled by the SDK, not by the page,
        so a publisher can ask for a natural size and the ad can never
        break out of the container it was asked to live in.
      </p>

      <div className="sdk-geometry">
        <div className="sdk-anchors">
          <div
            className="sdk-anchors__grid"
            role="img"
            aria-label="The nine anchors of a placement box. Three are named here: top-left, center and bottom-right."
          >
            {ANCHOR_CELLS.map((name, i) => (
              <span
                className={`sdk-anchors__cell${name === 'center' ? ' sdk-anchors__cell--flag' : ''}`}
                key={i}
              >
                {name ? <span className="sdk-anchors__name">{name}</span> : null}
              </span>
            ))}
          </div>
          <p className="sdk-anchors__legend">
            nine anchors · offset ±512 px · host-contained
          </p>
        </div>

        <dl className="sdk-spec">
          {SIZING_FACTS.map((fact) => (
            <div className="sdk-spec__row" key={fact.label}>
              <dt className="sdk-spec__key">{fact.label}</dt>
              <dd className="sdk-spec__value">
                <Rich>{fact.body}</Rich>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="sdk-note">
        The SDK owns the geometry: a size is clamped to the band below,
        an offset is clamped to ±512 px, and the final box is always
        intersected with the host so the ad cannot overflow its
        container. Nine anchors anchor the box; a ResizeObserver
        re-contains the ad when the host changes size.
      </p>
    </Panel>
  )
}

/* ------------------------------------------------------------------
   Analytics
   ------------------------------------------------------------------ */

const ANALYTICS_FACTS = [
  { label: 'Impressions', body: 'Recorded once per served ad, after 50% viewability for one second.' },
  { label: 'Clicks', body: 'Reported when the user follows the served destination.' },
  { label: 'Conversions', body: 'Server-side only: a conversion cannot be smuggled in as a click.' },
]

function Analytics() {
  return (
    <Panel className="sdk-panel">
      <header className="sdk-head">
        <h3 className="sdk-head__title" id="analytics">
          Analytics
        </h3>
      </header>
      <p className="sdk-p">
        The SDK reports — it assigns meaning. Impressions and clicks are
        recorded to the gateway, which is authoritative; the browser
        cannot manufacture an impression. Attribution, ranking, delivery
        counts and revenue assignment live on the server.
      </p>
      <dl className="sdk-spec">
        {ANALYTICS_FACTS.map((fact) => (
          <div className="sdk-spec__row" key={fact.label}>
            <dt className="sdk-spec__key">{fact.label}</dt>
            <dd className="sdk-spec__value">{fact.body}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
