/* =============================================================
   CLIRevenue — SDK setup
   -------------------------------------------------------------
   Provisioning first, then the path from "I want ads in my app"
   to "my app is earning", in the order things actually have to
   happen, plus a live self-test that asks the real delivery
   endpoint for an ad through the real SDK.

   Five rules this page obeys without exception:

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
   4. It never claims a shortcut it has not verified. Exactly one
      editor can bind a real keypress today, and the table below
      says so per editor rather than implying `npx clirevenue`
      put a keyboard shortcut into your terminal.
   5. It never states a blocker it can see has been fixed. The
      steps and the blocker list are both read off the shipped
      CLI and the shipped Edge Functions, not from memory.
   ============================================================= */

import { useCallback, useEffect, useState } from 'react'

import { Panel } from '../console/ui.jsx'
import { AdvEmpty, AdvPageHead } from '../advertiser/AdvertiserUI.jsx'
import CopyButton from '../CopyButton.jsx'
import clirevenue, { disposeClient, getClient } from '../../lib/clirevenue.js'
import { provisionPublisher } from '../../lib/publisherApi.js'
import { DELIVERED_PLACEMENT_KEYS } from '../../data/placements.js'
import './DeveloperConsole.css'

/* Which editor can actually launch the editor, and how.
   Read off the CLI's own target registry (packages/cli
   src/keybindings/targets.ts) rather than assumed, because the
   difference matters: a `shortcut` entry binds a real keypress,
   a `command` entry writes a slash command that the agent
   carries out, and `fallback` means the CLI wrote nothing at all
   and the developer runs `clirevenue editor` themselves.

   This is the one place in the product where a wrong entry
   would be actively harmful — a developer who presses a key that
   was never bound loses the session's confidence in the rest of
   the setup — so the "why" is shown next to every row rather
   than collapsed into a tooltip. */
const HOSTS = [
  {
    name: 'VS Code · Cursor · Windsurf · VSCodium',
    kind: 'shortcut',
    how: 'Ctrl+I',
    why: 'The only editor that can bind a real keypress. Setup writes .vscode/keybindings.json.',
  },
  {
    name: 'Claude Code',
    kind: 'command',
    how: '/clirevenue-editor',
    why: 'A slash command, not a hotkey — Claude Code has no keybinding file.',
  },
  {
    name: 'OpenCode',
    kind: 'command',
    how: '/clirevenue-editor',
    why: 'A slash command. OpenCode can only re-point a key at one of its own built-in actions.',
  },
  {
    name: 'Codex CLI',
    kind: 'command',
    how: '/prompts:clirevenue-editor',
    why: 'A prompt, not a hotkey — Codex has no keybinding mechanism.',
  },
  {
    name: 'Gemini CLI',
    kind: 'command',
    how: '/clirevenue-editor',
    why: 'A slash command. Gemini reads these from a TOML file, not a keybinding file.',
  },
  {
    name: 'Neovim',
    kind: 'command',
    how: ':ClirevenueEditor',
    why: 'Ctrl+I is Tab in Neovim, so it is left alone rather than breaking indentation.',
  },
  {
    name: 'tmux',
    kind: 'fallback',
    how: 'clirevenue editor',
    why: 'Ctrl+I reaches the pane as Tab, which would collide with tmux’s own prefix handling.',
  },
  {
    name: 'Cline',
    kind: 'fallback',
    how: 'clirevenue editor',
    why: 'Cline ships inside VS Code, so Ctrl+I would work — but the command id has to be read out of the extension you actually installed, and we will not guess it.',
  },
  {
    name: 'Kilo',
    kind: 'fallback',
    how: 'clirevenue editor',
    why: 'Kilo exposes no keybinding or command-registration mechanism at all.',
  },
  {
    name: 'Aider',
    kind: 'fallback',
    how: 'clirevenue editor',
    why: 'Aider’s config is a settings file; there is nowhere to register a command.',
  },
]

/* The order matters and it is not negotiable: a key cannot be
   created before a publisher exists, a placement cannot exist
   before a key can sign for it, and nothing can be delivered
   before a placement exists. Steps 1 and 2 happen here — no
   operator, no SQL — and so does step 3, because the CLI creates
   the placement itself now. */
const STEPS = [
  {
    phase: 'On this page',
    n: 1,
    title: 'Create a publisher',
    where: 'This page · done for you',
    body:
      'A publisher is the account the whole integration hangs off. It owns the keys, the placements and the delivery log. Signing in provisions one for you and reuses it on every later visit.',
    note: 'Provisioning is idempotent: refreshing this page will not create a second publisher, and it never takes one away.',
  },
  {
    phase: 'On this page',
    n: 2,
    title: 'Issue a publishable publisher key',
    where: 'This page · done for you',
    body:
      'You get a pk_test_… key. Only a SHA-256 hash is stored, so the plaintext exists in exactly one response — the one that minted it — and the panel above is showing you that response.',
    note: 'Reopening this page will not issue another key. Creating a replacement and revoking the old one is a deliberate action you take in Publisher Keys.',
  },
  {
    phase: 'In your project',
    n: 3,
    title: 'Install the SDK and wire up the project',
    where: 'clirevenue setup',
    body:
      'One command, run from the folder that serves your app. It detects what you are building, installs the SDK, writes your key and gateway URL into .env.local, and asks how many coding CLIs will use CLIRevenue in this project.',
    code: 'npx clirevenue setup',
    note: "It recognises Vite with React, Vue or Svelte, plain Vite, and static HTML pages. Anything else is reported rather than guessed at, and no framework is ever installed without you asking. If you would rather wire it yourself, it is just npm install @clirevenue/sdk, then init() once with your key and base URL, then getAd() and render() from any component — the CLI is a convenience, not a dependency.",
  },
  {
    phase: 'In your project',
    n: 4,
    title: 'Create a placement per CLI',
    where: 'Answered during setup',
    body:
      'Setup creates a placement for each coding CLI, so three CLIs means three keys. One CLI’s ad can then never be confused with another’s, and each still tracks its own earnings.',
    code: 'clirevenue integrations list',
    note: 'Adding a second CLI later allocates a fourth key rather than sharing one, and re-running setup never creates a second copy of anything.',
  },
  {
    phase: 'In your project',
    n: 5,
    title: 'Position the ad where you want it',
    where: 'clirevenue editor',
    body:
      'The editor opens in your browser: drag the ad to a position, drag a corner to resize it, watch the pixel readout, and save. It binds localhost only and writes one file — clirevenue.config.json — in your project.',
    code: 'npx clirevenue editor',
    note: 'A second ad on the same page is a slot on the same key, not a second placement: clirevenue add-slot vscode. Slots keep their own size and anchor, and removing one leaves its siblings alone.',
  },
  {
    phase: 'Serving',
    n: 6,
    title: 'Request and render an ad',
    where: 'Your app · any component',
    body:
      'Setup generates a component that calls render() with the geometry read from clirevenue.config.json at runtime, so moving an ad in the editor changes what ships without editing code. Doing it by hand is the same two calls: getAd() returns an ad or null, and render() takes the placement key and a selector.',
    code: `// the generated component
<CLIRevenueAd placementKey="vscode-1" slotId="slot-1" />

// or, wiring it yourself
import { init } from '@clirevenue/sdk'

const cli = init(import.meta.env.VITE_CLIREVENUE_PUBLISHABLE_KEY, {
  baseUrl: import.meta.env.VITE_API_BASE_URL,
})

const ad = await cli.getAd('console-workbench')
if (ad) cli.render('console-workbench', '#ad-region')`,
    note: 'Pass a slotId to choose one ad; leave it off and the first enabled slot is used.',
  },
  {
    phase: 'Serving',
    n: 7,
    title: 'Read no-fill correctly',
    where: 'Your app · UI layer',
    body:
      'No ad is a normal answer, not an error. It means nobody is buying this placement right now. Render your own surface instead, and never turn empty inventory into a failure state.',
  },
  {
    phase: 'Serving',
    n: 8,
    title: 'Leave impression counting to the SDK',
    where: 'Already handled',
    body:
      'An impression is recorded only after 50% of the element has been on screen for one second, and only once per served ad. The server is authoritative — the client cannot manufacture one, and a duplicate request returns "duplicate" instead of paying twice.',
  },
  {
    phase: 'Serving',
    n: 9,
    title: 'Test the integration',
    where: 'This page',
    body:
      'The self-test below performs a real delivery request through the real SDK and reports exactly what came back. It is not a mock.',
  },
  {
    phase: 'Serving',
    n: 10,
    title: 'Watch performance',
    where: 'Not available yet',
    body:
      'Delivery counts live on the server in ad_serve_log. There is no publisher-facing reporting endpoint, so this page will not show you a number until one exists.',
  },
]

/* What is genuinely still not self-serve, stated plainly rather
   than presented as UI the developer can click.

   Two entries that used to sit here no longer belong: placements
   are created by the CLI through the same API this dashboard
   uses, and keys can be issued and revoked from Publisher Keys.
   Claiming otherwise would send a developer looking for an
   operator who does not exist. */
const BLOCKERS = [
  'No publisher-facing delivery reporting endpoint, so step 10 cannot be completed from this dashboard. Until one exists this page shows no impressions, no fill rate and no revenue breakdown rather than a row of zeros that would read as measurements.',
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
              : `The full key was shown once, when it was first issued, and only its SHA-256 hash is stored, so it cannot be recovered here. The fragment above is the 12-character display value the server kept. Issue a replacement from Publisher Keys if you need one.`}
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
    <>
      <li className="setup__phase">
        <span className="setup__phase-label">{step.phase}</span>
      </li>
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
    </>
  )
}

/* The editor-compatibility table.

   It exists because the failure this page keeps having to avoid
   is a developer pressing a key that was never bound and
   concluding the whole integration is broken. Every row states
   what to actually press, and why the editors without a real
   shortcut do not have one. `Shortcut` is the only column with
   the accent in it, so the one working answer is findable at a
   glance. */
function Hosts() {
  return (
    <Panel className="adv-panel">
      <h4 className="adv-panel__title">How to open the editor</h4>
      <p className="adv-panel__sub">
        Only the VS Code family can bind a real keypress today. Installing the CLI does not
        add a keyboard shortcut to your terminal — it writes a project-local file for the
        editors that have a place to put one, and for the rest it tells you what to run.
      </p>
      <div className="adv-tablewrap">
        <table className="adv-table">
          <thead>
            <tr>
              <th>Editor</th>
              <th>To press</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {HOSTS.map((host) => (
              <tr key={host.name}>
                <td data-label="Editor">{host.name}</td>
                <td data-label="To press">
                  <span className="setup__how" data-kind={host.kind}>
                    {host.how}
                  </span>
                </td>
                <td data-label="Why" className="setup__why">
                  {host.why}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="setup__note">
        <code className="mono">clirevenue editor</code> works in all of them. It opens a
        local editor in your browser and writes only <code className="mono">clirevenue.config.json</code>.
      </p>
    </Panel>
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
        body="Your publisher account and a test key first, then the steps in order, with the only place each one can happen. Every step below was read off the released CLI and the released edge functions, not from memory."
      />

      <Provisioning />

      <ol className="setup__steps">
        {STEPS.map((step) => (
          <Step key={step.n} step={step} />
        ))}
      </ol>

      <Hosts />

      <SelfTest />

      <Panel className="adv-panel">
        <h4 className="adv-panel__title">One key per CLI, slots shared within it</h4>
        <p className="adv-panel__sub">
          The rule behind the whole setup. Getting it wrong is what makes two editors fight
          over the same ad, so it is worth stating rather than leaving to the config file.
        </p>
        <ul className="adv-activity">
          <li className="adv-activity__row">
            <span className="adv-activity__label">One placement key per CLI integration</span>
            <span className="adv-activity__detail">
              Three CLIs means three keys, so each tracks its own earnings. Two integrations
              can never share one, and the CLI refuses rather than quietly reassigning it.
            </span>
          </li>
          <li className="adv-activity__row">
            <span className="adv-activity__label">Many slots per key</span>
            <span className="adv-activity__detail">
              A second ad on the same page is a new slot on the same key, with its own size,
              anchor and offset. Adding one never asks the server for another placement.
            </span>
          </li>
          <li className="adv-activity__row">
            <span className="adv-activity__label">Geometry lives in your project</span>
            <span className="adv-activity__detail">
              Positions are saved to clirevenue.config.json, not to the server. That file is
              yours to read, diff and commit, and it never contains a key.
            </span>
          </li>
          <li className="adv-activity__row">
            <span className="adv-activity__label">Removing is local</span>
            <span className="adv-activity__detail">
              Deleting a slot or an integration edits the config only. The placement stays on
              your account, so a mistake is recoverable and nothing disappears from the server
              because a local command ran.
            </span>
          </li>
        </ul>
      </Panel>

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
        <p className="adv-panel__sub">What still needs work, stated rather than hidden.</p>
        <ul className="adv-activity">
          {BLOCKERS.map((b) => (
            <li key={b} className="adv-activity__row">
              <span className="adv-activity__label">{b}</span>
            </li>
          ))}
        </ul>
        <AdvEmpty
          title="No performance data is shown here"
          body="Delivery counts exist on the server. Until a publisher-facing endpoint exists, showing zeros would look like a measurement and read as a fact, so this page shows nothing instead."
        />
      </Panel>
    </div>
  )
}