/* =============================================================
   CLIRevenue — SDK setup
   -------------------------------------------------------------
   Provisioning first, then the ten steps between "I want ads in
   my app" and "my app is earning", in the order they actually
   have to happen, plus a live self-test that asks the real
   delivery endpoint for an ad through the real SDK.

   Three rules this page obeys without exception:

   1. It never prints a publisher key it did not receive. The key
      below is shown only because this page asked the
      provision_publisher Edge Function for it and that request
      genuinely minted it. Every other view of a key is the
      12-character fragment the server chose to keep, and the
      self-test keeps reporting the build-time key instead.
   2. It says the key is shown once, because it is. Only the
      SHA-256 hash is stored, so a key cannot be re-derived from
      the database and this page will not pretend otherwise.
   3. It never invents a number. There is no impression count, no
      revenue figure, no fill rate on this page. Where the backend
      has no endpoint yet, it says so instead of showing a zero
      that reads like a real measurement.
   ============================================================= */

import { useCallback, useEffect, useState } from 'react'

import { Panel } from '../console/ui.jsx'
import { AdvEmpty, AdvPageHead } from '../advertiser/AdvertiserUI.jsx'
import CopyButton from '../CopyButton.jsx'
import clirevenue, { disposeClient, getClient } from '../../lib/clirevenue.js'
import { provisionPublisher } from '../../lib/publisherApi.js'
import { DELIVERED_PLACEMENT_KEYS } from '../../data/placements.js'

/* The order matters and it is not negotiable: a key cannot be
   created before a publisher exists, a placement cannot exist
   before a key can sign for it, and nothing can be delivered before
   a placement exists. Each step names the only place that step can
   happen. Steps 1 and 2 now happen here — no operator, no SQL —
   and step 3 still does not, which the step itself says. */
const STEPS = [
  {
    n: 1,
    title: 'Create a publisher',
    where: 'This page · done for you',
    body:
      'A publisher is the account the whole integration hangs off. It owns the keys, the placements and the delivery log. Signing in provisions one for you and reuses it on every later visit.',
    note: 'Provisioning is idempotent: refreshing this page will not create a second publisher, and it never takes one away.',
  },
  {
    n: 2,
    title: 'Issue a publishable publisher key',
    where: 'This page · done for you',
    body:
      'You get a pk_test_… key. Only a SHA-256 hash is stored, so the plaintext exists in exactly one response — the one that minted it — and the panel above is showing you that response.',
    note: 'Reopening this page will not issue another key. Rotation is a deliberate separate action and is not wired up yet.',
  },
  {
    n: 3,
    title: 'Create a placement',
    where: 'CLIRevenue operations · one row per surface',
    body:
      'A placement is a placement key plus the host surface it belongs to. The key is your own readable slug — "console-workbench" — not a generated identifier, because you will type it into your own config.',
    note: `A delivery request for a placement that does not exist is rejected with INVALID_PLACEMENT. This app's own surfaces are already registered: ${DELIVERED_PLACEMENT_KEYS.join(', ')}.`,
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

/* What is still not self-serve. Steps 1 and 2 came off this list
   when provisioning landed; what remains is stated plainly rather
   than presented as UI the developer can click. */
const BLOCKERS = [
  'No API to revoke or rotate a publisher key. Provisioning will not do it for you: minting a second key instead of replacing the first would leave a live capability nobody is tracking.',
  'No self-service placement management, so step 3 still needs an operator with database access.',
  'No publisher-facing delivery reporting endpoint, so step 10 cannot be completed from this dashboard.',
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

const MASK = '•'.repeat(16)

/**
 * Ask for the publisher account without touching React state, so the mount
 * effect and the retry button can share one request path.
 */
async function readProvisioning() {
  try {
    return { ok: true, result: await provisionPublisher() }
  } catch (error) {
    return {
      ok: false,
      message: error?.message || 'The publisher account could not be read.',
    }
  }
}

/* The publisher account, requested on mount. Deliberately not cached
   across reloads: the raw key cannot be re-derived, and pretending a
   second request would bring it back would be a lie about the
   storage model. A reload therefore re-checks and reports the
   fragment, which is all the server kept. */
function Provisioning() {
  const [state, setState] = useState('checking')
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState(null)
  const [revealed, setRevealed] = useState(false)

  const settle = useCallback((outcome) => {
    if (!outcome.ok) {
      setState('error')
      setMessage(outcome.message)
      return
    }
    setResult(outcome.result)
    setRevealed(false)
    setState('ready')
  }, [])

  // The first render already reads "checking", so the effect has nothing to
  // set synchronously: the request resolves first, then the outcome lands.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const outcome = await readProvisioning()
      if (cancelled) return
      settle(outcome)
    })()
    return () => {
      cancelled = true
    }
  }, [settle])

  const retry = useCallback(() => {
    setState('checking')
    setMessage(null)
    void (async () => {
      settle(await readProvisioning())
    })()
  }, [settle])

  const raw = result?.key?.publishableKey || null
  const fragment = result?.key?.prefix || null
  const display = raw
    ? revealed
      ? raw
      : `${raw.slice(0, 8)}${MASK}`
    : `${fragment || 'pk_test_'}${MASK}`

  return (
    <section className="panel adv-panel" aria-label="Publisher provisioning">
      <h4 className="adv-panel__title">SDK setup</h4>
      <p className="adv-panel__sub">
        Your publisher account and a test publishable key, requested from the server the
        first time you open this page. No operator, no SQL, no approval queue.
      </p>

      <p className="setup__status" data-tone={state === 'error' ? 'warn' : 'ok'} aria-live="polite">
        <span className="setup__status-label">
          {state === 'checking' ? 'Checking' : state === 'error' ? 'Unavailable' : 'Ready'}
        </span>
        <span className="setup__status-headline">
          {state === 'checking'
            ? 'Checking your publisher account…'
            : state === 'error'
              ? 'Provisioning is unavailable'
              : 'Your publisher account is ready.'}
        </span>
        {state === 'error' ? <span className="setup__status-detail">{message}</span> : null}
        {state === 'ready' ? (
          <span className="setup__status-detail">
            {result.publisher.created
              ? `Created ${result.publisher.name} just now.`
              : `Reusing ${result.publisher.name}, which already existed.`}{' '}
            Test key {result.key.created ? 'issued just now' : 'already in use'},{' '}
            {result.key.env === 'live' ? 'live' : 'test'} environment.
          </span>
        ) : null}
      </p>

      {state === 'ready' ? (
        <div className="setup__keyplate">
          <span className="setup__fact-label">Publishable key</span>
          <div className="setup__keyrow">
            <code className="setup__keyvalue" data-masked={raw && !revealed ? 'yes' : 'no'}>
              {display}
            </code>
            {raw ? (
              <span className="setup__keyactions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setRevealed((v) => !v)}
                  aria-expanded={revealed}
                >
                  {revealed ? 'Hide key' : 'Reveal key'}
                </button>
                <CopyButton text={raw} label="key" baseClass="setup__copy" />
              </span>
            ) : null}
          </div>
          <p className="setup__note">
            {raw
              ? 'Copy it now. Only the SHA-256 hash is stored, so this is the one time the full value exists outside your browser — a reload of this page will bring back the fragment, not the key.'
              : `The full key was shown once, when it was first issued, and only its SHA-256 hash is stored, so it cannot be recovered here. The fragment above is the 12-character display value the server kept. Issuing a replacement is a deliberate action that does not exist yet.`}
          </p>
        </div>
      ) : null}

      {state === 'error' ? (
        <div className="setup__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={retry}>
            Try again
          </button>
        </div>
      ) : null}
    </section>
  )
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
          'VITE_CLIREVENUE_PUBLISHABLE_KEY is not set in this build, so there is no publisher to request an ad for. Nothing was sent. The key provisioned above is a different key: this test reads the one baked into the bundle at build time.',
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
        body="Your publisher account and a test key first, then the ten steps, in order, with the only place each one can happen. The two steps that used to need an operator with database access now happen on this page; the two that still do say so."
      />

      <Provisioning />

      <ol className="setup__steps">
        {STEPS.map((step) => (
          <Step key={step.n} step={step} />
        ))}
      </ol>

      <SelfTest />

      <Panel className="adv-panel">
        <h4 className="adv-panel__title">What the browser is allowed to hold</h4>
        <p className="adv-panel__sub">
          The publishable key is an identifier, not a credential. It authorises delivery for
          one publisher and nothing else — it cannot create a publisher, issue a key, or
          move money. Provisioning is the exception that proves the rule: the account is
          created behind the server's own bearer check, from the session token and never
          from a field the browser can set.
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
        <p className="adv-panel__sub">What still needs an operator, stated rather than hidden.</p>
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