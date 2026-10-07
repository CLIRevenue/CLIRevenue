/* =============================================================
   CLIRevenue — publisher initialization boundary
   -------------------------------------------------------------
   One module decides whether this build may talk to the ad server at
   all, and it does so from three environment values:

     VITE_CLIREVENUE_PUBLISHABLE_KEY  the publisher's publishable key
     VITE_AD_GATEWAY_URL              the public ad gateway
     VITE_API_BASE_URL                the internal backend

   WHY THE AD GATEWAY IS NOT VITE_API_BASE_URL
   ------------------------------------------
   These two were originally the same variable, on the reasoning that
   "the delivery gateway is the same host the rest of the application
   already talks to, so there is nothing to override separately and no
   way for the two to disagree." Production disagreed.

   VITE_API_BASE_URL is the *internal* backend: the Supabase-hosted
   functions this app calls with a user JWT for campaigns, rewards,
   payouts and the contact inbox. The ad gateway is the *public*
   edge: api.clirevenue.in, the host a third-party publisher's page
   is meant to talk to, with its own TLS, its own CORS layer and its
   own routing. In production they are different hosts, and by reusing
   the internal base the SDK was pointed straight past the gateway at
   the Supabase project ref.

   That is not cosmetic. It put browser delivery and telemetry traffic
   on a different origin than the one the platform publishes, so the
   gateway stopped seeing it, and telemetry 404'd because that endpoint
   was never routed there.

   The gateway base therefore has its own variable and its own default,
   the SDK's own DEFAULT_BASE_URL. A build that sets neither still
   talks to the intended public gateway; a local build opts into the
   local backend by setting VITE_AD_GATEWAY_URL in .env.local, which
   is gitignored and never shipped.

   The publishable key is safe in a browser bundle: it is the same
   credential a page has to present to be allowed to ask for an ad,
   the server hashes it on arrival, and it authorises nothing but
   delivery for its own publisher. It cannot mint impressions, cannot
   read a placement list, cannot touch an advertiser balance, and
   cannot complete a conversion.

   Everything that *can* move money or forge an event stays on the
   server and is never read here. If you find yourself wanting to add
   such a value to this file, the answer is a server-side call, not a
   new environment variable.

   With no key present this module reports `configured: false` and
   `getClient()` returns null. Nothing throws, nothing retries, and the
   interface says plainly that the slot is not configured — a site with
   no advertiser is still a site.
   ============================================================= */

import { DEFAULT_BASE_URL, SDK_VERSION, init } from '@clirevenue/sdk'

/* Same shape the SDK enforces before it opens a socket. Repeating it
   here means a typo in a deploy variable produces a truthful
   "misconfigured" state in the interface instead of an exception on
   first paint. */
export const PUBLISHABLE_KEY_PATTERN = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/

const readEnv = (name) => {
  /* `import.meta.env` is replaced at build time; guarding keeps this
     module importable from a plain Node process (tests, tooling)
     where the object may be absent entirely. */
  const env = typeof import.meta !== 'undefined' ? import.meta.env : undefined
  const value = env ? env[name] : undefined
  return typeof value === 'string' ? value.trim() : ''
}

const rawKey = readEnv('VITE_CLIREVENUE_PUBLISHABLE_KEY')
const rawGateway = readEnv('VITE_AD_GATEWAY_URL')

export const publisherKey = rawKey

/* The public ad gateway, never the internal backend. Falls back to the SDK's
   own default so a build that configures nothing still addresses the
   published gateway rather than guessing from an unrelated variable. */
export const baseUrl = (rawGateway || DEFAULT_BASE_URL).replace(/\/+$/, '')

/* Why the build cannot deliver, in words the interface can show. */
export const configReason = (() => {
  if (!publisherKey) return 'missing-publisher-key'
  if (!PUBLISHABLE_KEY_PATTERN.test(publisherKey)) return 'malformed-publisher-key'
  if (!baseUrl) return 'missing-base-url'
  return null
})()

export const publisherKeyConfigured = configReason === null

/* The key is publishable, but there is no reason to print it in full in
   a screenshot. Only the prefix the server also stores, plus the last
   four characters, which is enough to tell two keys apart. */
export function publisherKeyHint(key = publisherKey) {
  if (!key) return null
  if (key.length <= 12) return `${key.slice(0, 3)}…`
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}

export const clirevenueConfig = {
  configured: publisherKeyConfigured,
  reason: configReason,
  baseUrl,
  publisherKeyConfigured,
  publisherKeyHint,
  sdkVersion: SDK_VERSION,
  /* What the browser is allowed to do, stated once so the interface
     does not have to imply it. */
  capabilities: {
    requestAd: true,
    recordImpression: true,
    recordClick: true,
    createPublisher: false,
    issueOrRevokeKey: false,
    createPlacement: false,
    readPerformance: false,
    completeConversion: false,
  },
}

if (!publisherKeyConfigured) {
  console.warn(
    `[clirevenue] Ad delivery is off in this build (${configReason}). ` +
      'Set VITE_CLIREVENUE_PUBLISHABLE_KEY to a publishable key to enable it.',
  )
}

/* One client per page. Delivery, viewability and the offline queue all
   live on the instance, so two instances would mean two queues and two
   chances to double-count a dwell. */
let client = null

export function getClient() {
  if (!publisherKeyConfigured) return null
  if (!client) {
    client = init(publisherKey, { baseUrl })
  }
  return client
}

/* Called when the owning surface unmounts. The instance releases its
   observers and its `online` listener; the next `getClient()` builds a
   fresh one, so this is safe to call at any time and more than once. */
export function disposeClient() {
  if (!client) return
  client.destroy()
  client = null
}

/* The config object is the default export, so a component that only needs
   to know what is possible can write `import clirevenue from …` and never
   touch the key itself. The client factory stays a named export. */
export default clirevenueConfig
