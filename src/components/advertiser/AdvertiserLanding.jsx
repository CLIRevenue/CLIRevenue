/* =============================================================
   CLIRevenue — public advertiser landing / campaign onboarding
   -------------------------------------------------------------
   The advertiser counterpart to /developer. The relationship should
   read instantly: /developer is how you build and integrate with
   CLIRevenue; /advertiser is how you create campaigns, reach
   audiences, and measure what delivery actually did.

   A visitor should be able to answer, in order:

      1. What CLIRevenue provides an advertiser.
      2. How a campaign moves from brief to measured delivery.
      3. What the campaign lifecycle is, and which moves are legal.
      4. What can be targeted, and where an ad can run.
      5. What creative is provided, and where the destination lives.
      6. Which metrics exist — in the console's own terminology.
      7. What the server checks before anything serves.
      8. The practical questions, answered against real behavior.

   This page is intentionally public: understanding the product must
   not require an account. It is NOT the role-gated AdvertiserApp
   dashboard (/app/advertiser), which owns the real campaign writes.

   Fidelity rules for this file — the page describes the product that
   exists, not an imagined ad platform:
     - audiences, statuses and transitions come from the same modules
       the console imports (advertiserApi / campaignRules), so this
       page can never drift from the implementation;
     - budgets, validation limits, eligibility, billing state, and the
       destination-field gap are stated exactly as the code behaves —
       anything the build does not do is named as not doing it;
     - the shell grammar (masthead, hero spread, plate, panels,
       hairlines, buttons) is the /developer page's design system, but
       the body leans on the advertiser console's own vocabulary —
       spec tables, status pills, lattice grids — so the two pages
       share a system without sharing an information architecture.
   ============================================================= */

import { navigateApp } from '../../hooks/useAppRoute.js'

import { Panel } from '../console/ui.jsx'
import CopyButton from '../CopyButton.jsx'
import { ADVERTISER_AUDIENCES } from '../../lib/advertiserApi.js'
import { CAMPAIGN_STATUSES, TRANSITIONS } from '../../lib/campaignRules.js'
import './AdvertiserLanding.css'

/* On this page. The masthead carries the same jumps the developer
   masthead does, so a reader can move without scrolling blind — and
   a sticky rail never has to exist. */
const JUMPS = [
  { href: '#workflow', label: 'Workflow' },
  { href: '#measurement', label: 'Measurement' },
  { href: '#faq', label: 'FAQ' },
]

/* The hero artifact: the exact body the console posts when a campaign
   is created — every field here is accepted by the campaigns endpoint,
   with no invented keys and no status, because creation is always a
   draft. */
const BRIEF_SNIPPET = `{
  "name": "Launch week",
  "headline": "Ship faster with Acme Cloud",
  "description": "Native delivery inside developer CLIs.",
  "cta": "Learn more",
  "audience_id": "backend",
  "budget_cents": 150000
}`
/* ------------------------------------------------------------------
   How it works — five steps, straight from the real console flow.
   ------------------------------------------------------------------ */

const FLOW_STEPS = [
  {
    n: '01',
    title: 'Write the brief',
    body: 'Name, headline, description, and the call to action. A new campaign saves as a draft — nothing serves yet.',
  },
  {
    n: '02',
    title: 'Choose an audience',
    body: 'One of five developer audiences, chosen per campaign. It is the only targeting this build has.',
  },
  {
    n: '03',
    title: 'Set the budget',
    body: 'A budget in USD. It must be greater than $0, and this build caps a campaign at $100,000.',
  },
  {
    n: '04',
    title: 'Activate',
    body: 'Move the status draft → active. Delivery only ever considers active campaigns, and activation is always an explicit step.',
  },
  {
    n: '05',
    title: 'Measure delivery',
    body: 'Impressions, clicks, conversions, CTR, and spend arrive in Overview, Analytics, and Billing as the server records them.',
  },
]

/* ------------------------------------------------------------------
   Campaign workflow — the five real states and the transitions the
   rules allow. Meanings are authored here; the state list and the
   allowed-next column come straight from campaignRules, the same
   module the console's status select reads.
   ------------------------------------------------------------------ */

const STATUS_MEANING = {
  draft: 'Just created. Nothing serves while a campaign is a draft.',
  active: 'Eligible for delivery while inside its schedule and under budget.',
  paused: 'On hold. No delivery until you resume it.',
  completed: 'Delivery finished. Nothing serves again.',
  archived: 'Terminal. History and accounting are kept.',
}

/* ------------------------------------------------------------------
   Audiences — ids and labels are imported from the console's own
   module; the notes are the descriptions seeded alongside them.
   ------------------------------------------------------------------ */

const AUDIENCE_NOTES = {
  backend: 'Node, Go, Rust, Postgres',
  data: 'Pipelines, notebooks, model ops',
  devops: 'CI, Kubernetes, observability',
  frontend: 'React, TypeScript, CSS',
  oss: 'Public repos, 1k+ stars',
}
/* ------------------------------------------------------------------
   Creative — the fields a brief actually consists of, under the
   console's labels with the wire names beside them.
   ------------------------------------------------------------------ */

const BRIEF_FIELDS = [
  { key: 'name', label: 'Campaign name', rule: 'Required. Your internal label for the campaign.' },
  { key: 'headline', label: 'Headline', rule: 'Required. The line the slot shows your audience.' },
  { key: 'description', label: 'Description', rule: 'Optional. Supporting copy under the headline.' },
  { key: 'cta', label: 'Call to action', rule: 'Defaults to “Learn more”. The label on the slot’s action.' },
  { key: 'audience_id', label: 'Audience', rule: 'Required. One of the five developer audiences.' },
  { key: 'budget_cents', label: 'Budget (USD)', rule: 'Greater than $0; $100,000 or less in this build. Entered in dollars, sent in cents.' },
]

/* ------------------------------------------------------------------
   Measurement — the metrics the console reports, in its own terms.
   ------------------------------------------------------------------ */

const METRICS = [
  {
    name: 'Impressions',
    formula: 'once per served ad',
    body: 'Counted after the slot is at least 50% visible for one continuous second. Existing on screen is never enough.',
  },
  {
    name: 'Clicks',
    formula: 'follows the destination',
    body: 'Reported when a visitor follows the served destination. Clicks are not billed.',
  },
  {
    name: 'Conversions',
    formula: 'server-side only',
    body: 'Recorded by the server that owns the campaign. A browser cannot post one.',
  },
  {
    name: 'CTR',
    formula: 'clicks ÷ impressions × 100',
    body: 'Shown per campaign and as an account total on Overview and Analytics, to two decimals.',
  },
  {
    name: 'Conversion rate',
    formula: 'conversions ÷ clicks × 100',
    body: 'Conversions as a share of recorded clicks.',
  },
  {
    name: 'Spend',
    formula: 'impressions ÷ 1,000 × CPM',
    body: 'Each recorded impression adds the campaign’s CPM — cost per thousand impressions — to spend. Remaining budget is budget minus spend.',
  },
]
/* ------------------------------------------------------------------
   FAQ — practical questions, every answer true of the current build.
   ------------------------------------------------------------------ */

const FAQ_ITEMS = [
  {
    q: 'Do I need to install anything?',
    a: 'No. The SDK belongs to the publisher’s side of delivery. Advertisers need an account and a browser — the console is the whole toolchain.',
  },
  {
    q: 'How do I start advertising?',
    a: 'Sign up, choose Advertiser, and confirm your email. The console opens at Overview; the Campaigns tab holds the create form, and a new campaign starts as a draft.',
  },
  {
    q: 'What can I target?',
    a: 'One of five developer audiences per campaign: Backend & API, Data & ML, DevOps & Platform, Frontend & Web, and OSS maintainers. Geography, device, keyword, and time-of-day targeting do not exist in this build, and there is no auction.',
  },
  {
    q: 'When does a campaign serve?',
    a: 'When its status is active, it is inside its schedule window (when one is set), its budget is not exhausted, and a placement asks for an ad whose audience matches. Anything else answers as no fill — a normal outcome, not an error.',
  },
  {
    q: 'What happens when the budget runs out?',
    a: 'The next impression is refused as BUDGET_EXCEEDED and delivery stops. Raise the budget and delivery can resume — the campaign keeps its history rather than being recreated.',
  },
  {
    q: 'How much does an impression cost?',
    a: 'Spend accrues per recorded impression at the campaign’s CPM — cost per thousand impressions — computed on the server in integer cents. Clicks and conversions are not billed.',
  },
  {
    q: 'Can I stop a campaign mid-flight?',
    a: 'Yes. Active → paused stops delivery immediately, and paused → active resumes it. Completion and archiving are one-way, and archiving keeps the record.',
  },
  {
    q: 'What counts as an impression?',
    a: 'The slot must be at least half visible for one continuous second, once per served ad. Impressions are measured by the SDK and confirmed by the server, never inferred from the page.',
  },
  {
    q: 'Are conversions tracked from the browser?',
    a: 'No. Conversions are recorded server-side only — a click cannot smuggle one in, and a click is only accepted after its impression exists.',
  },
  {
    q: 'Where is the destination URL set?',
    a: 'Delivery hands the SDK a landingUrl from your campaign record, but the console form does not expose the destination field yet. Without a destination the slot’s action expands the detail panel instead of navigating — a disclosure, not a click-through.',
  },
  {
    q: 'Are payments connected?',
    a: 'No. The Billing tab reports spend derived from your campaigns; payment methods and invoices are disabled stubs, no card is stored, and nothing is charged in this build.',
  },
  {
    q: 'Which numbers are real?',
    a: 'Every figure in Overview, Analytics, and Billing is computed from your campaign’s delivery records. With no delivery yet, the charts stay empty rather than guessing.',
  },
]

/* ------------------------------------------------------------------
   Small local head — h2 for sections, the same head rhythm the
   developer page's heads use, nothing decorative above it (the design
   system bans a decorative eyebrow above every block).
   ------------------------------------------------------------------ */

function Head({ id, title, sub, big = false }) {
  return (
    <header className={`advx-head${big ? ' advx-head--lg' : ''}`}>
      <h2 className="advx-head__title" id={id}>
        {title}
      </h2>
      {sub ? <p className="advx-head__sub">{sub}</p> : null}
    </header>
  )
}
/* ------------------------------------------------------------------
   Sections. Each section owns its own layout family so the body
   never repeats the same bordered card — ladder, ledger table,
   lattice, split panels, metric rows, disclosure columns.
   ------------------------------------------------------------------ */

function HowItWorks() {
  return (
    <section className="advx-block" id="flow" aria-labelledby="flow-title">
      <Head
        id="flow-title"
        title="How it works"
        sub="Five steps from blank brief to measured delivery — every one of them the real console flow, described exactly as it behaves today."
        big
      />
      <ol className="advx-ladder">
        {FLOW_STEPS.map((step) => (
          <li className="advx-ladder__cell" key={step.n}>
            <span className="advx-ladder__n" aria-hidden="true">
              {step.n}
            </span>
            <h3 className="advx-ladder__title">{step.title}</h3>
            <p className="advx-ladder__body">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="advx-note">
        Advertisers never install anything. A browser and an account are the whole
        toolchain — the SDK, the placements, and the viewability watch all belong to the
        publisher’s side of the exchange.
      </p>
    </section>
  )
}

function Workflow() {
  return (
    <section className="advx-block" id="workflow" aria-labelledby="workflow-title">
      <Head
        id="workflow-title"
        title="Campaign workflow"
        sub="Five states, and only the transitions the rules allow. The console offers the legal moves from wherever a campaign is now; every other move is rejected outright."
        big
      />

      <ul className="advx-statusline">
        {CAMPAIGN_STATUSES.map((state) => (
          <li className="advx-statusline__item" key={state} data-live={state === 'active'}>
            <span className="advx-statusline__dot" aria-hidden="true" />
            {state}
          </li>
        ))}
      </ul>

      <div className="adv-tablewrap">
        <table className="adv-table">
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">What it means</th>
              <th scope="col">Allowed next states</th>
            </tr>
          </thead>
          <tbody>
            {CAMPAIGN_STATUSES.map((state) => (
              <tr key={state}>
                <td data-label="State">
                  <span className="adv-pill">{state}</span>
                </td>
                <td data-label="What it means">{STATUS_MEANING[state]}</td>
                <td data-label="Allowed next states">
                  {TRANSITIONS[state].length ? (
                    TRANSITIONS[state].map((next) => (
                      <span className="advx-next" key={next}>
                        → {next}
                      </span>
                    ))
                  ) : (
                    <span className="advx-next advx-next--end">terminal</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="advx-note">
        Activation is always explicit — nothing serves while a campaign is a draft.
        Archiving is one-way, and it keeps the record: an archived campaign retains its
        spend and delivery figures.
      </p>
    </section>
  )
}
function Targeting() {
  return (
    <section className="advx-block" id="targeting" aria-labelledby="targeting-title">
      <Head
        id="targeting-title"
        title="Targeting and placements"
        sub="Targeting here is exactly one developer audience per campaign, matched against the placement that asks for an ad."
        big
      />

      <ul className="advx-audiences">
        {ADVERTISER_AUDIENCES.map((audience) => (
          <li className="advx-audiences__cell" key={audience.id}>
            <span className="advx-audiences__id">{audience.id}</span>
            <span className="advx-audiences__label">{audience.label}</span>
            <span className="advx-audiences__note">{AUDIENCE_NOTES[audience.id]}</span>
          </li>
        ))}
      </ul>

      <div className="advx-split">
        <Panel className="advx-panel">
          <h3 className="advx-panel__title">How a match is made</h3>
          <ul className="advx-checks">
            <li>
              Your campaign carries one audience — <code className="advx-inline">audience_id</code>.
              One campaign, one tag.
            </li>
            <li>
              A placement may declare an allowed audience. When it does, only campaigns for
              that audience can be served into it.
            </li>
            <li>
              A placement with no allowed audience takes any active campaign that passes its
              checks.
            </li>
            <li>
              Nothing else exists: no geography, device, keyword, or time-of-day segments, and
              no bidding or rotation policy — eligible campaigns are considered oldest first.
            </li>
          </ul>
        </Panel>

        <Panel className="advx-panel">
          <h3 className="advx-panel__title">Where your ad runs</h3>
          <ul className="advx-checks">
            <li>
              A placement is a named slot on a publisher’s surface. Its key is chosen by the
              publisher, unique on that surface, and must already exist — an unknown key
              answers <code className="advx-inline">INVALID_PLACEMENT</code>.
            </li>
            <li>A disabled placement serves nothing at all.</li>
            <li>
              The live example today is the console workbench slot:{' '}
              <code className="advx-inline">console-workbench</code>.
            </li>
            <li>
              Delivery requests are rate-limited per publisher key, so burst traffic cannot
              pull a campaign’s budget down on its own.
            </li>
          </ul>
        </Panel>
      </div>
    </section>
  )
}

function Creative() {
  return (
    <section className="advx-block" id="creative" aria-labelledby="creative-title">
      <Head
        id="creative-title"
        title="Creative and destination"
        sub="What you provide for a campaign, and where a visitor lands when they follow it."
        big
      />

      <div className="advx-split advx-split--brief">
        <div>
          <dl className="advx-spec">
            {BRIEF_FIELDS.map((field) => (
              <div className="advx-spec__row" key={field.key}>
                <dt className="advx-spec__key">{field.label}</dt>
                <dd className="advx-spec__value">
                  <code className="advx-inline">{field.key}</code> — {field.rule}
                </dd>
              </div>
            ))}
          </dl>
          <p className="advx-note">
            Creative in this build is text: name, headline, description, and the call to
            action. There is no image or logo upload — the slot renders the words you give it.
          </p>
        </div>

        <Panel className="advx-panel">
          <h3 className="advx-panel__title">The destination</h3>
          <p className="advx-p">
            Delivery hands the SDK a <code className="advx-inline">landingUrl</code> from your
            campaign record. That is where a visitor goes when they follow the call to action,
            and the click is recorded against the serve it belongs to.
          </p>
          <p className="advx-p">
            The field is nullable. With no destination set, the slot’s action only expands the
            detail panel — a disclosure, not a click-through — so no click is ever claimed for it.
          </p>
          <p className="advx-note">
            The console form collects your creative text today; it does not expose the
            destination field yet. Headline, description, and call to action stay editable
            whenever you change the brief.
          </p>
        </Panel>
      </div>
    </section>
  )
}
function Measurement() {
  return (
    <section className="advx-block" id="measurement" aria-labelledby="measurement-title">
      <Head
        id="measurement-title"
        title="Measurement"
        sub="The metrics the console reports, in the console’s own terms — each one derived from delivery records, never estimated."
        big
      />

      <ul className="advx-metrics">
        {METRICS.map((metric) => (
          <li className="advx-metric" key={metric.name}>
            <span className="advx-metric__name">{metric.name}</span>
            <span className="advx-metric__formula">{metric.formula}</span>
            <p className="advx-metric__body">{metric.body}</p>
          </li>
        ))}
      </ul>

      <p className="advx-note">
        With no delivery yet, the charts stay empty rather than guessing. The trend view is
        impressions in creation order — time-series history has no backend in this build —
        and every other figure is a straight total across your campaigns.
      </p>
    </section>
  )
}

function Safety() {
  return (
    <section className="advx-block" id="delivery" aria-labelledby="delivery-title">
      <Head
        id="delivery-title"
        title="Safety and delivery"
        sub="What is checked before your campaign is served, and what no client is ever allowed to write."
        big
      />

      <div className="advx-split">
        <Panel className="advx-panel">
          <h3 className="advx-panel__title">Checked before every serve</h3>
          <ul className="advx-checks">
            <li>
              <strong>Active only.</strong> Draft, paused, completed, and archived campaigns
              answer no fill.
            </li>
            <li>
              <strong>Schedule.</strong> A campaign outside its window is refused; an open-ended
              schedule means always in window. The console does not edit schedule fields yet.
            </li>
            <li>
              <strong>Budget.</strong> Spend is checked against budget on every impression, and
              an exhausted budget refuses the next one as{' '}
              <code className="advx-inline">BUDGET_EXCEEDED</code>.
            </li>
            <li>
              <strong>Placement and key.</strong> The key must exist and be enabled, requests
              are rate-limited, and each serve is valid for 30 minutes.
            </li>
            <li>
              <strong>Once only.</strong> At most one impression per serve — enforced, not
              trusted — and a click is only accepted after its impression exists.
            </li>
            <li>
              <strong>Conversions.</strong> Recorded server-side only, never posted from a
              browser.
            </li>
          </ul>
        </Panel>

        <Panel className="advx-panel">
          <h3 className="advx-panel__title">What no client can write</h3>
          <ul className="advx-checks">
            <li>
              Spend, impressions, clicks, and conversions are refused on every update — only
              delivery ever writes them.
            </li>
            <li>
              Ownership is checked on every read and write: one advertiser cannot touch another
              advertiser’s campaigns.
            </li>
            <li>
              An impression cannot be manufactured: the SDK measures 50% visibility for one
              second before the server will count it.
            </li>
            <li>
              No card is taken. Payments are not connected in this build — Billing reports
              spend derived from your campaigns, and nothing is charged.
            </li>
          </ul>
        </Panel>
      </div>
    </section>
  )
}
/* ------------------------------------------------------------------
   FAQ — native <details> disclosure: keyboard- and script-free, with
   only the marker restyled to the mono +/− sign the product uses.
   ------------------------------------------------------------------ */

function Faq() {
  return (
    <section className="advx-block" id="faq" aria-labelledby="faq-title">
      <Head id="faq-title" title="Questions advertisers ask" big />
      <div className="advx-faq">
        {FAQ_ITEMS.map((item) => (
          <details className="advx-faq__item" key={item.q}>
            <summary className="advx-faq__q">
              <span>{item.q}</span>
              <span className="advx-faq__sign" aria-hidden="true" />
            </summary>
            <p className="advx-faq__a">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------
   Final CTA — the one place the page asks, plainly, for the account,
   plus the cross-link that makes the /developer relationship obvious.
   ------------------------------------------------------------------ */

function FinalCta() {
  return (
    <section className="advx-cta" aria-labelledby="cta-title">
      <p className="eyebrow eyebrow--plain">Start here</p>
      <h2 className="advx-cta__title" id="cta-title">
        Start advertising.
      </h2>
      <p className="advx-cta__body">
        Create the advertiser account, write the brief, set the budget, and activate when you
        are ready. Nothing serves while a campaign is a draft — and this prototype does not
        take payments.
      </p>
      <div className="advx-cta__actions">
        <button type="button" className="btn btn--primary" onClick={() => navigateApp('/signup')}>
          Start advertising
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigateApp('/login')}>
          Log in
        </button>
      </div>
      <p className="advx-cta__aside">
        Building the tool side instead?{' '}
        <a className="adv-link" href="/developer">
          The developer page
        </a>{' '}
        documents the SDK, placements, and rendering.
      </p>
    </section>
  )
}

/* ------------------------------------------------------------------
   Main page. The public site header is not mounted on this route, so
   the page carries its own masthead — the same shape as the developer
   masthead, with this page's jumps and the one account action.
   ------------------------------------------------------------------ */

export default function AdvertiserLanding() {
  return (
    <section className="advx-page" aria-label="CLIRevenue for advertisers">
      <header className="advx-top">
        <button type="button" className="advx-top__brand" onClick={() => navigateApp('/')}>
          CLI<em>Revenue</em>
        </button>
        <span className="sitehead__nav-link advx-top__path">/advertiser</span>
        <nav className="advx-top__nav" aria-label="Advertiser page">
          {JUMPS.map((jump) => (
            <a className="advx-top__link" href={jump.href} key={jump.href}>
              {jump.label}
            </a>
          ))}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigateApp('/login')}
          >
            Log in
          </button>
        </nav>
      </header>

      <div className="advx-page__inner">
        <div className="advx-hero">
          <div className="advx-hero__lede">
            <p className="eyebrow eyebrow--plain">01 — CLIRevenue Advertiser</p>
            <h1 className="advx-hero__title">
              Reach developers inside
              <span className="advx-hero__accent"> the tools they already use.</span>
            </h1>
            <p className="advx-hero__body">
              CLIRevenue sells one sponsored slot inside real developer tools. You write the
              brief, choose one of five developer audiences, set a budget in dollars, and
              activate. Delivery serves your campaign only while it is eligible, counts an
              impression only when the slot is genuinely seen, and reports spend, clicks, and
              conversions back to your console.
            </p>
            <div className="advx-hero__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => navigateApp('/signup')}
              >
                Start advertising
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => navigateApp('/login')}
              >
                Log in
              </button>
            </div>
          </div>

          <div className="advx-plate">
            <div className="advx-code__bar">
              <span className="advx-code__tag">campaign brief</span>
              <span className="advx-plate__meta">created as draft</span>
              <CopyButton
                text={BRIEF_SNIPPET}
                label="campaign brief JSON"
                baseClass="advx-copy"
              />
            </div>
            <pre className="advx-code__pre">
              <code>{BRIEF_SNIPPET}</code>
            </pre>
          </div>
        </div>

        <div className="advx-main">
          <HowItWorks />
          <Workflow />
          <Targeting />
          <Creative />
          <Measurement />
          <Safety />
          <Faq />
          <FinalCta />
        </div>
      </div>
    </section>
  )
}