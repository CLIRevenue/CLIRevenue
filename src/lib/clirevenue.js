/* =============================================================
   CLIRevenue — publisher initialization boundary
   -------------------------------------------------------------
   One module decides whether this build may talk to the ad server at
   all, and it does so from exactly two environment values:

     VITE_CLIREVENUE_PUBLISHABLE_KEY  the publisher's publishable key
     VITE_API_BASE_URL                the gateway base (shared with the
                                      rest of the app)

   One new variable, not two: the delivery gateway is the same host the
   rest of the application already talks to, so there is nothing to
   override separately and no way for the two to disagree.

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
const PUBLISHABLE_KEY_PATTERN = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/

const readEnv = (name) => {
  /* `import.meta.env` is replaced at build time; guarding keeps this
     module importable from a plain Node process (tests, tooling)
     where the object may be absent entirely. */
  const env = typeof import.meta !== 'undefined' ? import.meta.env : undefined
  const value = env ? env[name] : undefined
  return typeof value === 'string' ? value.trim() : ''
}

const rawKey = readEnv('VITE_CLIREVENUE_PUBLISHABLE_KEY')
const rawBase = readEnv('VITE_API_BASE_URL')

export const publisherKey = rawKey
export const baseUrl = (rawBase || DEFAULT_BASE_URL).replace(/\/+$/, '')

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
