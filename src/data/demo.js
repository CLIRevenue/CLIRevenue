import {
  ArrowUpRight,
  Code2,
  Megaphone,
  Network,
  Users,
} from 'lucide-react'
import { SEED_CAMPAIGNS } from './economy.js'

/* =============================================================
   CLIRevenue — scripted demo content
   -------------------------------------------------------------
   All copy here is conceptual. No earnings figures, CPMs,
   revenue percentages, customer counts, or performance claims
   are asserted anywhere in this prototype.
   ============================================================= */

export const brand = {
  name: 'CLIRevenue',
  status: 'Early concept',
  ask: 'Looking for developers, advertisers, and CLI users.',
  headline: ['Turn terminal attention', 'into shared revenue.'],
  verbs: ['Advertise.', 'Earn.', 'Share.'],
}

/* The advertising slot is demonstrated inside a stand-in host
   application. `atlas` is not a product — it only stands in for
   any CLI or AI-CLI so the placement reads realistically. */
export const hostApp = {
  id: 'atlas',
  windowTitle: 'atlas — ~/projects/api-gateway',
}

export const placement = {
  eyebrow: 'Placement',
  statement: 'A dedicated advertising slot sits directly above the command line.',
  detail:
    'The host application output is untouched. The advertisement occupies its own reserved region of the interface.',
}

/* The slot is a real region of the interface, so it can be opened.
   The copy below is what that region says when it is — and it is a
   statement about placement, not a claim about money, reach, or
   performance. `detail` is prose; `region` is the one-line technical
   restatement of the same fact, in the same mono as the rail.

   The creative itself is not duplicated here: the film shows the
   seeded Atlas campaign, so the advertiser console and the terminal
   slot are always describing the same simulated advertiser. */
const filmCampaign = SEED_CAMPAIGNS.find((campaign) => campaign.id === 'cmp_atlas')

export const adSlot = {
  label: 'Sponsored',
  advertiser: filmCampaign.advertiser,
  brand: filmCampaign.brand,
  category: filmCampaign.category,
  disclosure: filmCampaign.disclosure,
  publisher: filmCampaign.name,
  headline: filmCampaign.headline,
  support: filmCampaign.description,
  action: filmCampaign.cta,
  detail:
    'The host application renders this region beside its output, not inside it. Opening it changes nothing above the prompt — a script reading the command still receives exactly what the tool emitted.',
  region: 'ui region · not stdout',
}

/* The opening scene is the only one that carries no eyebrow, because it
   has no heading to carry one — it is the cold open, a prompt and a
   window that grows around it. The scenes after it are numbered. */
export const waitScene = {
  ariaLabel: 'An AI coding agent at work',
  command: 'atlas',

  /* The states an agent passes through, in the order it passes through
     them. These are conceptual, and that is the point: the scene is
     about time spent producing no output, so there are deliberately no
     durations, no counts and no scores here. The moment a number
     appears on this screen it is no longer an empty screen, and the
     empty screen is the thing the next three scenes are about. The
     cycle repeating is honest — an agent loops. */
  activity: [
    { id: 'thinking', text: 'Thinking about the request', detail: 'working out what to change' },
    { id: 'reading', text: 'Reading the repository', detail: 'finding the entry point' },
    { id: 'tools', text: 'Running tools', detail: 'shell · test · lint' },
    { id: 'writing', text: 'Generating changes', detail: 'drafting a patch' },
    { id: 'waiting', text: 'Waiting on a tool result', detail: 'nothing to show you yet' },
  ],
}

export const adScene = {
  eyebrow: '02 — The ad',
  command: 'atlas analyze ./src --format report',
  output: [
    { kind: 'step', label: 'scanning 148 files', status: 'ok' },
    { kind: 'step', label: 'resolving dependencies', status: 'ok' },
    { kind: 'step', label: 'building call graph', status: 'ok' },
    { kind: 'step', label: 'detecting issues', status: 'warn', value: '12 found' },
    { kind: 'rule' },
    { kind: 'label', text: 'summary' },
    { kind: 'kv', key: 'critical', value: '3' },
    { kind: 'kv', key: 'warnings', value: '7' },
    { kind: 'kv', key: 'info', value: '2' },
    { kind: 'kv', key: 'exit', value: '0' },
  ],
}

export const experienceScene = {
  eyebrow: '05 — The experience',
  command: 'atlas query "slow functions" --json',
  output: [
    { kind: 'step', label: 'querying index', status: 'ok' },
    { kind: 'rule' },
    { kind: 'json', text: '[' },
    { kind: 'json', text: '  { "file": "src/worker/queue.ts", "ms": 412 },' },
    { kind: 'json', text: '  { "file": "src/db/pool.js", "ms": 268 },' },
    { kind: 'json', text: '  { "file": "src/http/retry.ts", "ms": 149 }' },
    { kind: 'json', text: ']' },
  ],
  annotations: [
    { label: 'Terminal output remains clean' },
    { label: 'Scripts are not contaminated' },
    { label: 'The ad has a dedicated UI region' },
    { label: 'The user can continue working normally' },
  ],
}

/* -------------------------------------------------------------
   Scene 3 — the advertising ecosystem

   One chain, read top to bottom:

     Advertiser --pays--> CLIRevenue --delivers--> Developer --serves--> User

   The advertiser funds a campaign. CLIRevenue runs the ad network and
   hands the campaign to the developer who integrated it. The app or
   site that developer ships is what puts the advertisement in front of
   the user. Every stage has exactly one successor — nothing branches,
   and CLIRevenue never reaches the user directly.
   ------------------------------------------------------------- */

export const ecosystem = {
  eyebrow: '04 — The money',
  nodes: {
    advertiser: {
      id: 'advertiser',
      label: 'Advertiser',
      icon: Megaphone,
      sub: 'Campaign',
    },
    platform: {
      id: 'platform',
      label: 'CLIRevenue',
      icon: Network,
      sub: 'Ad Network',
    },
    developer: {
      id: 'developer',
      label: 'Developer',
      icon: Code2,
      sub: 'App / Site',
    },
    user: {
      id: 'user',
      label: 'User',
      icon: Users,
      sub: 'Sees Ad',
    },
  },
  order: ['advertiser', 'platform', 'developer', 'user'],
  flows: [
    { id: 'pay', from: 'advertiser', to: 'platform', label: 'pays' },
    { id: 'deliver', from: 'platform', to: 'developer', label: 'delivers' },
    { id: 'serve', from: 'developer', to: 'user', label: 'serves' },
  ],
  // The same four stages as the diagram above, in the same order, and
  // each one pinned to the participant it belongs to. The list under
  // the flow walks these in step with the pulse, so the sentence on
  // screen always describes the stage being animated.
  stages: [
    { id: 'campaign', node: 'advertiser', label: 'Advertiser runs the campaign and pays CLIRevenue.' },
    { id: 'network', node: 'platform', label: 'CLIRevenue operates the ad network and delivers the campaign.' },
    { id: 'integrate', node: 'developer', label: 'Developer integrates CLIRevenue into their app or site.' },
    { id: 'serve', node: 'user', label: 'The app or site serves the advertisement to the user.' },
  ],
}

export const incentiveScene = {
  eyebrow: '06 — The incentive',
  benefits: [
    {
      id: 'advertisers',
      label: 'Advertisers',
      icon: Megaphone,
      body: 'Reach targeted technical audiences.',
    },
    {
      id: 'users',
      label: 'Users',
      icon: Users,
      body: 'Earn a share from advertising engagement.',
    },
    {
      id: 'developers',
      label: 'Developers',
      icon: Code2,
      body: 'Create a new revenue stream for free/open-source tools.',
    },
  ],
}

export const ctaScene = {
  eyebrow: '07',
  /* The closing frame is the only place in the film that asks for
     something, so it carries two ways to answer: the role the reader is
     most likely to be, and the other one. Both point at the public
     onboarding pages rather than at a signup form, because understanding
     the product must not require an account — the same rule the
     /developer and /advertiser routes already follow. */
  actions: [
    {
      id: 'advertiser',
      label: 'I want to advertise',
      note: 'Scope inventory, format and budget',
      href: '/advertiser',
    },
    {
      id: 'developer',
      label: 'I want to integrate',
      note: 'Install the SDK, earn on your slot',
      href: '/developer',
    },
  ],
}

/* -------------------------------------------------------------
   Advertiser demo scene — the advertiser console in action
   ------------------------------------------------------------- */
export const advertiserDemoScene = {
  eyebrow: '03 — The advertiser',
  command: 'clirevenue campaign create',
  output: [
    { kind: 'step', label: 'validating brief', status: 'ok' },
    { kind: 'step', label: 'reserving budget', status: 'ok', value: '$1,500.00' },
    { kind: 'step', label: 'registering campaign', status: 'ok', value: 'cmp_launch_week' },
    { kind: 'rule' },
    { kind: 'label', text: 'delivery' },
    { kind: 'kv', key: 'status', value: 'active' },
    { kind: 'kv', key: 'audience', value: 'Backend & API' },
    { kind: 'kv', key: 'impressions', value: '12,847' },
    { kind: 'kv', key: 'clicks', value: '342' },
    { kind: 'kv', key: 'ctr', value: '2.66%' },
    { kind: 'kv', key: 'conversions', value: '18' },
    { kind: 'kv', key: 'spend', value: '$387.42' },
  ],
  campaign: {
    id: 'cmp_launch_week',
    name: 'Launch week',
    advertiser: 'Acme Cloud',
    brand: 'ACME',
    category: 'Cloud Infrastructure',
    headline: 'Ship faster with Acme Cloud',
    description: 'Native delivery inside developer CLIs. Zero config, global edge.',
    cta: 'Learn more',
    audience: 'backend',
    audienceLabel: 'Backend & API',
    status: 'active',
    budgetCents: 150000,
  },
  metrics: {
    budget: '$1,500.00',
    spend: '$387.42',
    impressions: '12,847',
    ctr: '2.66%',
    conversions: '18',
  },
  annotations: [
    { label: 'Campaign brief', value: 'Ship faster with Acme Cloud' },
    { label: 'Audience', value: 'Backend & API developers' },
    { label: 'Status', value: 'Active — delivering' },
    { label: 'Spend', value: '$387.42 / $1,500.00' },
  ],
  campaigns: [
    {
      id: 'cmp_launch_week',
      name: 'Launch week',
      advertiser: 'Acme Cloud',
      category: 'Cloud Infrastructure',
      status: 'active',
      audienceLabel: 'Backend & API',
      spend: '$387.42',
      budget: '$1,500.00',
      impressions: '12,847',
      ctr: '2.66%',
      fill: 26,
    },
    {
      id: 'cmp_api_keys',
      name: 'API keys',
      advertiser: 'Northwind Auth',
      category: 'Developer Identity',
      status: 'active',
      audienceLabel: 'All developers',
      spend: '$214.08',
      budget: '$900.00',
      impressions: '9,412',
      ctr: '3.12%',
      fill: 24,
    },
    {
      id: 'cmp_docs_tool',
      name: 'Docs tooling',
      advertiser: 'Ledger Docs',
      category: 'Documentation',
      status: 'paused',
      audienceLabel: 'Frontend',
      spend: '$91.70',
      budget: '$600.00',
      impressions: '4,105',
      ctr: '1.84%',
      fill: 15,
    },
    {
      id: 'cmp_observability',
      name: 'Observability trial',
      advertiser: 'Kestrel Metrics',
      category: 'Monitoring',
      status: 'draft',
      audienceLabel: 'SRE & Platform',
      spend: '$0.00',
      budget: '$2,400.00',
      impressions: '0',
      ctr: '—',
      fill: 0,
    },
  ],
  activity: [
    { id: 'act_1', time: '00:04:12', event: 'impression served', campaign: 'Launch week', detail: 'session 8f21 · node us-east-2' },
    { id: 'act_2', time: '00:04:09', event: 'click recorded', campaign: 'Launch week', detail: 'CTR updated to 2.66%' },
    { id: 'act_3', time: '00:03:58', event: 'budget committed', campaign: 'API keys', detail: '$120.00 reserved' },
    { id: 'act_4', time: '00:03:41', event: 'reward accrued', campaign: 'Launch week', detail: 'developer wallet +$0.04' },
    { id: 'act_5', time: '00:03:20', event: 'campaign paused', campaign: 'Docs tooling', detail: 'budget remaining $508.30' },
  ],
  workflow: [
    { id: 'wf_brief', label: 'Brief', note: 'audience, budget, creative' },
    { id: 'wf_review', label: 'Review', note: 'brand + placement checks' },
    { id: 'wf_deliver', label: 'Deliver', note: 'auction into the slot' },
    { id: 'wf_report', label: 'Report', note: 'impressions, CTR, conversions' },
  ],
  ledger: {
    label: 'Same ledger, four readers',
    rows: [
      { party: 'Advertiser', read: 'spend + conversions', tone: 'amber' },
      { party: 'CLIRevenue', read: 'network take', tone: 'ink' },
      { party: 'Developer', read: 'accrued rewards', tone: 'ink' },
      { party: 'User', read: 'the ad itself', tone: 'ink' },
    ],
  },
}

/* Shared arrow glyph for inline call-to-action affordances. */
export const arrowGlyph = ArrowUpRight
