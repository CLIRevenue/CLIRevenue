import {
  ArrowUpRight,
  Code2,
  Megaphone,
  Network,
  Users,
} from 'lucide-react'

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
   restatement of the same fact, in the same mono as the rail. */
export const adSlot = {
  label: 'Sponsored',
  publisher: 'Developer Platform',
  headline: 'Build faster. Deploy smarter.',
  action: 'Learn More',
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
  eyebrow: '04 — The experience',
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
   advertiser pays → platform provides infrastructure
   platform shares revenue → user and developer
   ------------------------------------------------------------- */

export const ecosystem = {
  eyebrow: '03 — The money',
  nodes: {
    advertiser: {
      id: 'advertiser',
      label: 'Advertiser',
      icon: Megaphone,
      blurb: 'Reach technical users.',
    },
    platform: {
      id: 'platform',
      label: 'Platform',
      icon: Network,
      blurb: 'Provides the infrastructure.',
    },
    user: {
      id: 'user',
      label: 'User',
      icon: Users,
      blurb: 'Can earn rewards.',
    },
    developer: {
      id: 'developer',
      label: 'Developer',
      icon: Code2,
      blurb: 'Monetize their CLI tools.',
    },
  },
  order: ['advertiser', 'platform', 'user', 'developer'],
  flows: [
    { id: 'pay', from: 'advertiser', to: 'platform', label: 'pays' },
    { id: 'user-share', from: 'platform', to: 'user', label: 'share' },
    { id: 'dev-share', from: 'platform', to: 'developer', label: 'share' },
  ],
}

export const incentiveScene = {
  eyebrow: '05 — The incentive',
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
  eyebrow: '06',
}

/* Shared arrow glyph for inline call-to-action affordances. */
export const arrowGlyph = ArrowUpRight
