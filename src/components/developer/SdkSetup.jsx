/* =============================================================
   CLIRevenue — SDK setup
   -------------------------------------------------------------
   The ten steps between "I want ads in my app" and "my app is
   earning", in the order they actually have to happen, plus a live
   self-test that asks the real delivery endpoint for an ad through
   the real SDK.

   Two rules this page obeys without exception:

   1. It never prints a publisher key. Not the full value, not a
      longer prefix than the hint, never in a copyable block. The
      key lives in the build environment and this page only reports
      whether one is present.
   2. It never invents a number. There is no impression count, no
      revenue figure, no fill rate on this page. Where the backend
      has no endpoint yet, it says so instead of showing a zero
      that reads like a real measurement.
   ============================================================= */

import { useCallback, useState } from 'react'

import { Panel } from '../console/ui.jsx'
import { AdvEmpty, AdvPageHead } from '../advertiser/AdvertiserUI.jsx'
import clirevenue, { disposeClient, getClient } from '../../lib/clirevenue.js'
import { DELIVERED_PLACEMENT_KEYS } from '../../data/placements.js'

/* The order matters and it is not negotiable: a key cannot be
   created before a publisher exists, a placement cannot exist
   before a key can sign for it, and nothing can be delivered before
   a placement exists. Each step names the only place that step can
   happen, so a reader who is looking for the answer in a UI finds
   out that there is no UI for it yet. */
const STEPS = [
  {
    n: 1,
    title: 'Create a publisher',
    where: 'CLIRevenue operations · service-role SQL',
    body:
      'A publisher is the account the whole integration hangs off. It owns the keys, the placements and the delivery log.',
    note: 'No self-service route exists yet. See the blockers below.',
  },
  {
    n: 2,
    title: 'Issue a publishable publisher key',
    where: 'CLIRevenue operations · service-role SQL',
    body:
      'You get pk_live_… or pk_test_…. Only a SHA-256 hash is stored; the plaintext is shown once at issue time. Revoke it and issue a new one whenever a machine changes hands.',
    code: 'INSERT INTO publisher_keys (publisher_id, key_hash, key_prefix) VALUES (…);',
    note: 'There is no issue or revoke API. A key cannot currently be rotated without an operator.',
  },
  {
    n: 3,
    title: 'Create a placement',
    where: 'CLIRevenue operations · service-role SQL',
    body:
      'A placement is a placement key plus the host surface it belongs to. The key is your own readable slug — "console-workbench" — not a generated identifier, because you will type it into your own config.',
    code: "INSERT INTO placements (publisher_id, placement_key, enabled) VALUES (…, 'console-workbench', true);",
    note: 'A delivery request for a placement that does not exist is rejected with INVALID_PLACEMENT.',
  },
  {
    n: 4,
    title: 'Install the SDK',
    where: 'Your project · package.json',
    body: 'Zero runtime dependencies, ESM only, ~14 kB packed.',
    code: 'npm install @clirevenue/sdk',
  },
  {
    n: 5,
    title: 'Initialise it once',
    where: 'Your app · startup',
    body:
      'Pass the publishable key and the gateway base URL. The SDK throws before any network call if the key does not look like a publisher key, so a misconfiguration is loud rather than silent.',
    code: `import { init } from '@clirevenue/sdk'

const cli = init(import.meta.env.VITE_CLIREVENUE_PUBLISHABLE_KEY, {
  baseUrl: import.meta.env.VITE_API_BASE_URL,
})`,
    note: 'In this app the same boundary lives in src/lib/clirevenue.js. The key is read from VITE_CLIREVENUE_PUBLISHABLE_KEY and never written down.',
  },
  {
    n: 6,
    title: 'Request and render an ad',
    where: 'Your app · any component',
    body:
      'getAd() returns an ad or null. null is a legitimate, expected answer — it means nobody is buying this placement right now, and it is not an error.',
    code: `const ad = await cli.getAd('console-workbench')
if (ad) cli.render('console-workbench', '#ad-region')`,
  },
  {
    n: 7,
    title: 'Read no-fill correctly',
    where: 'Your app · UI layer',
    body:
      'A 204 is a normal outcome. Show the placement as empty, or fall back to your own surface. Never render a failure state because the inventory was empty.',
  },
  {
    n: 8,
    title: 'Leave impression counting to the SDK',
    where: 'Already handled',
    body:
      'An impression is recorded only after 50% of the element has been on screen for one second, and only once per served ad. The server is authoritative — the client cannot manufacture one, and a duplicate request returns "duplicate" instead of paying twice.',
  },
  {
    n: 9,
    title: 'Test the integration',
    where: 'This page',
    body:
      'The self-test below performs a real delivery request through the real SDK and reports exactly what came back. It is not a mock.',
  },
  {
    n: 10,
    title: 'Watch performance',
    where: 'Not available yet',
    body:
      'Delivery counts live in ad_serve_log on the server. There is no publisher-facing reporting endpoint, so this page will not show you a number until one exists.',
  },
]

/* Steps that currently require a human with database access. Stated
   plainly rather than presented as UI the developer can click. */
const BLOCKERS = [
  'No API to create a publisher, issue or revoke a publisher key, or create a placement — all four are service-role SQL today.',
  'No publisher-facing delivery reporting endpoint, so steps 1, 2, 3 and 10 cannot be completed from this dashboard.',
]

/* Status vocabulary mirrors src/hooks/useServedAd.js. Keeping the
   words identical is the point: a developer who reads them here
   recognises them in their own catch block. */
const OUTCOME = {
  idle: null,
  running: { tone: 'busy', label: 'Requesting' },
  ready: { tone: 'ok', label: 'Ad delivered' },
  nofill: { tone: 'idle', label: 'No fill — normal' },
  failed: { tone: 'warn', label: 'Request failed' },
}

function Step({ step }) {
  return (
    <li className="setup__step" data-step={step.n}>
      <span className="setup__n">{String(step.n).padStart(2, '0')}</span>
      <div className="setup__body">
        <h5 className="setup__step-title">{step.title}</h5>
        <p className="setup__where">{step.where}</p>
        <p className="setup__text">{step.body}</p>
        {step.code ? <pre className="setup__code">{step.code}</pre> : null}
        {step.note ? <p className="setup__note">{step.note}</p> : null}
      </div>
    </li>
  )
}

function SelfTest() {
  const [state, setState] = useState('idle')
  const [result, setResult] = useState(null)

  const run = useCallback(async () => {
    if (!clirevenue.configured) {
      setState('failed')
      setResult({
        headline: 'Publisher key is not configured',
        detail:
          'VITE_CLIREVENUE_PUBLISHABLE_KEY is not set in this build, so there is no publisher to request an ad for. Nothing was sent.',
      })
      return
    }
    setState('running')
    setResult(null)
    const client = getClient()
    const key = DELIVERED_PLACEMENT_KEYS[0]
    try {
      const served = await client.getAd(key)
      if (!served) {
        setState('nofill')
        setResult({
          headline: 'The placement returned no ad',
          detail:
            'That is a normal answer, not a failure: the request reached the server and nobody is currently buying this placement. Render your fallback and move on.',
        })
        return
      }
      setState('ready')
      setResult({
        headline: served.ad.headline,
        detail: `Advertiser "${served.ad.name}". Impression is recorded only once 50% of the rendered element has been visible for one second.`,
        token: served.impressionToken,
      })
    } catch (error) {
      setState('failed')
      setResult({
        headline: error?.name || 'Request failed',
        detail: error?.message || 'The delivery request did not complete.',
      })
    }
  }, [])

  const status = OUTCOME[state]
  const configured = clirevenue.configured

  return (
    <section className="panel adv-panel" aria-label="SDK self-test">
      <h4 className="adv-panel__title">Integration self-test</h4>
      <p className="adv-panel__sub">
        One real delivery request, issued by the packaged SDK against the configured
        gateway. It reports what came back — it does not assert success.
      </p>

      <ul className="setup__facts">
        <li className="setup__fact">
          <span className="setup__fact-label">Publisher key</span>
          <span className="setup__fact-value" data-ok={configured ? 'yes' : 'no'}>
            {configured ? `present · ${clirevenue.publisherKeyHint()}` : 'not configured'}
          </span>
        </li>
        <li className="setup__fact">
          <span className="setup__fact-label">SDK</span>
          <span className="setup__fact-value">@clirevenue/sdk {clirevenue.sdkVersion}</span>
        </li>
        <li className="setup__fact">
          <span className="setup__fact-label">Gateway</span>
          <span className="setup__fact-value">{clirevenue.baseUrl}</span>
        </li>
        <li className="setup__fact">
          <span className="setup__fact-label">Placement</span>
          <span className="setup__fact-value">{DELIVERED_PLACEMENT_KEYS[0]}</span>
        </li>
      </ul>

      <div className="setup__actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={run} disabled={state === 'running'}>
          {state === 'running' ? 'Requesting…' : 'Run delivery test'}
        </button>
        {configured ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              disposeClient()
              setState('idle')
              setResult(null)
            }}
          >
            Reset client
          </button>
        ) : null}
      </div>

      {status ? (
        <p className="setup__status" data-tone={status.tone} aria-live="polite">
          <span className="setup__status-label">{status.label}</span>
          <span className="setup__status-headline">{result?.headline}</span>
          {result?.detail ? <span className="setup__status-detail">{result.detail}</span> : null}
          {result?.token ? (
            <span className="setup__status-detail">
              Impression token returned — length {result.token.length}, value withheld.
            </span>
          ) : null}
        </p>
      ) : null}
    </section>
  )
}

export default function SdkSetup() {
  return (
    <div className="setup">
      <AdvPageHead
        index="D2"
        label="SDK"
        title="Ad delivery, end to end."
        body="Ten steps, in order, with the only place each one can happen. Four of them still need an operator with database access; that is stated rather than hidden behind a button that would fail."
      />

      <ol className="setup__steps">
        {STEPS.map((step) => (
          <Step key={step.n} step={step} />
        ))}
      </ol>

      <SelfTest />

      <Panel className="adv-panel">
        <h4 className="adv-panel__title">What the browser is allowed to hold</h4>
        <p className="adv-panel__sub">
          The publishable key is an identifier, not a credential. It authorises delivery
          for one publisher and nothing else — it cannot create a publisher, issue a key,
          or move money.
        </p>
        <ul className="adv-activity">
          <li className="adv-activity__row">
            <span className="adv-activity__label">Safe in the bundle</span>
            <span className="adv-activity__detail">
              VITE_CLIREVENUE_PUBLISHABLE_KEY · VITE_API_BASE_URL · the Supabase anon key.
            </span>
          </li>
          <li className="adv-activity__row">
            <span className="adv-activity__label">Never in the bundle</span>
            <span className="adv-activity__detail">
              The Supabase service-role key, AD_TOKEN_SECRET, SETTLEMENT_SECRET, or any
              private signing material. A VITE_ variable is inlined into the client bundle
              at build time, so putting a secret in one publishes it to every visitor.
            </span>
          </li>
          <li className="adv-activity__row">
            <span className="adv-activity__label">Conversions</span>
            <span className="adv-activity__detail">
              Server-side only. The browser SDK does not call the conversion endpoint, and
              a conversion cannot be smuggled in as a click.
            </span>
          </li>
        </ul>
      </Panel>

      <Panel className="adv-panel">
        <h4 className="adv-panel__title">Blockers</h4>
        <p className="adv-panel__sub">
          What stops steps 1, 2, 3 and 10 being done from this dashboard today.
        </p>
        <ul className="adv-activity">
          {BLOCKERS.map((b) => (
            <li key={b} className="adv-activity__row">
              <span className="adv-activity__label">{b}</span>
            </li>
          ))}
        </ul>
        <AdvEmpty
          title="No performance data is shown here"
          body="Delivery counts exist on the server in ad_serve_log. Until a publisher-facing endpoint exists, showing zeros would look like a measurement and read as a fact, so this page shows nothing instead."
        />
      </Panel>
    </div>
  )
}
