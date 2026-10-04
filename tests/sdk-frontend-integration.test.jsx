/**
 * CLIRevenue — the frontend ⇄ SDK boundary.
 *
 * These suites cover the seam this repo owns: how a publishable key becomes a
 * client, how a placement key becomes a request, how the six delivery states
 * become markup, and what the client is *not* allowed to do.
 *
 * Node environment on purpose (see vitest.config.js). Components are rendered
 * with react-dom/server, so assertions are about markup and module contracts
 * rather than mounted effects. The SDK's own viewability, retry and destroy
 * behaviour is covered in packages/sdk/tests.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import SponsoredSlot from '../src/components/console/SponsoredSlot.jsx'
import PLACEMENTS, {
  DELIVERED_PLACEMENTS,
  DELIVERED_PLACEMENT_KEYS,
} from '../src/data/placements.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const KEY = `pk_test_${'a'.repeat(32)}`
const OTHER_KEY = `pk_live_${'b'.repeat(32)}`

const SERVED = {
  requestId: '11111111-1111-4111-8111-111111111111',
  impressionToken: 'tok_impression_value',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  ad: {
    id: 'cmp_real',
    name: 'Northwind',
    headline: 'Ship faster',
    description: 'A real served description.',
    cta: 'Try it',
    audience: 'engineering',
    landingUrl: 'https://northwind.example/landing',
  },
}

/* ---------------------------------------------------------------- helpers */

function readSource(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const SRC_FILES = walk(join(ROOT, 'src'))
  .concat(walk(join(ROOT, 'packages/sdk/src')))
  .map((full) => ({ full, rel: relative(ROOT, full), text: readFileSync(full, 'utf8') }))

/** A 60-second offline-event buffer, so impression tests never touch disk. */
function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  }
}

async function loadBoundary(env = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_CLIREVENUE_PUBLISHABLE_KEY', '')
  vi.stubEnv('VITE_API_BASE_URL', '')
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  const mod = await import('../src/lib/clirevenue.js')
  return { ...mod, clirevenue: mod.default }
}

function okJson(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function noContent() {
  return { ok: true, status: 204, json: async () => null, text: async () => '' }
}

/* ------------------------------------------------- 1. publisher boundary */

describe('publisher initialization boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('creates a client when a valid publishable key is present', async () => {
    const { getClient, clirevenue } = await loadBoundary({
      VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY,
      VITE_API_BASE_URL: 'https://gateway.example/functions/v1',
    })

    expect(clirevenue.configured).toBe(true)
    expect(clirevenue.publisherKeyConfigured).toBe(true)
    expect(clirevenue.baseUrl).toBe('https://gateway.example/functions/v1')
    expect(clirevenue.sdkVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(clirevenue.publisherKeyHint()).toBe(`${KEY.slice(0, 8)}…${KEY.slice(-4)}`)

    const client = getClient()
    expect(client).toBeTruthy()
    expect(typeof client.getAd).toBe('function')
    expect(typeof client.recordClick).toBe('function')
    expect(typeof client.watchViewability).toBe('function')

    // The hint never leaks the whole key.
    expect(clirevenue.publisherKeyHint()).not.toContain(KEY)
  })

  it('reports a malformed key instead of throwing at import time', async () => {
    const { getClient, clirevenue } = await loadBoundary({
      VITE_CLIREVENUE_PUBLISHABLE_KEY: 'service-role-not-a-publisher-key',
    })

    expect(clirevenue.configured).toBe(false)
    expect(clirevenue.publisherKeyConfigured).toBe(false)
    expect(clirevenue.reason).toBe('malformed-publisher-key')
    expect(getClient()).toBeNull()
  })

  it('reports an absent key as unconfigured, and still renders a surface', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getClient, clirevenue } = await loadBoundary({})

    expect(clirevenue.configured).toBe(false)
    expect(clirevenue.reason).toBe('missing-publisher-key')
    expect(getClient()).toBeNull()
    // The warning is emitted once, not on every render.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('falls back to the SDK default base URL', async () => {
    const { clirevenue } = await loadBoundary({ VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY })
    expect(clirevenue.baseUrl).toBe('https://api.clirevenue.in')
  })

  it('accepts live keys as well as test keys', async () => {
    const { clirevenue } = await loadBoundary({ VITE_CLIREVENUE_PUBLISHABLE_KEY: OTHER_KEY })
    expect(clirevenue.configured).toBe(true)
  })

  it('disposes the client and hands back a fresh one', async () => {
    const { getClient, disposeClient } = await loadBoundary({
      VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY,
    })
    const first = getClient()
    disposeClient()
    disposeClient() // idempotent
    const second = getClient()
    expect(second).not.toBe(first)
    expect(getClient()).toBe(second) // memoised again
  })

  it('declares which capabilities exist and which do not', async () => {
    const { clirevenue } = await loadBoundary({ VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY })
    expect(clirevenue.capabilities).toMatchObject({
      requestAd: true,
      recordImpression: true,
      recordClick: true,
      createPublisher: false,
      issueOrRevokeKey: false,
      createPlacement: false,
      readPerformance: false,
      completeConversion: false,
    })
  })
})

/* ------------------------------------------------- 2. real SDK boundary */

describe('delivery through the real SDK', () => {
  let sdk

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('sessionStorage', memoryStorage())
    sdk = await import('@clirevenue/sdk')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('sends the valid key and placement key, and nothing else', async () => {
    const client = sdk.init(KEY)
    const fetchMock = globalThis.fetch
    fetchMock.mockResolvedValueOnce(okJson(SERVED))

    const served = await client.getAd('console-workbench')

    expect(served).toMatchObject({ ad: { landingUrl: SERVED.ad.landingUrl } })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/ads/deliver')
    expect(init.headers[sdk.SDK_VERSION_HEADER]).toBe(sdk.SDK_VERSION)

    const body = JSON.parse(init.body)
    expect(Object.keys(body).sort()).toEqual([
      'placementKey',
      'publisherKey',
      'referrer',
      'requestId',
      'url',
    ])
    expect(body.publisherKey).toBe(KEY)
    expect(body.placementKey).toBe('console-workbench')
    // The client cannot invent attribution.
    expect(body.campaignId).toBeUndefined()
    expect(body.advertiserId).toBeUndefined()
    expect(body.reward).toBeUndefined()
  })

  it('treats 204 as no-fill, not as an error', async () => {
    const client = sdk.init(KEY)
    globalThis.fetch.mockResolvedValueOnce(noContent())

    await expect(client.getAd('console-workbench')).resolves.toBeNull()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('fails loudly on a 401 and does not retry it', async () => {
    const client = sdk.init(KEY)
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'INVALID_PUBLISHER_KEY' }),
      text: async () => '{"error":"INVALID_PUBLISHER_KEY"}',
    })

    await expect(client.getAd('console-workbench')).rejects.toMatchObject({
      name: 'CLIRevenueHttpError',
      status: 401,
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('retries a 5xx and then reports the failure', async () => {
    const client = sdk.init(KEY, { maxRetries: 2, retryBaseMs: 1, retryMaxMs: 2 })
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'AD_TOKEN_SECRET missing' }),
      text: async () => '{}',
    })

    await expect(client.getAd('console-workbench')).rejects.toMatchObject({
      name: 'CLIRevenueHttpError',
      status: 503,
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(3) // 1 attempt + 2 retries

    // Same serve, same idempotency key across every retry.
    const keys = globalThis.fetch.mock.calls.map(
      (call) => JSON.parse(call[1].body).requestId,
    )
    expect(new Set(keys).size).toBe(1)
  })

  it('reports an unreachable gateway as a network error', async () => {
    const client = sdk.init(KEY, { maxRetries: 0 })
    globalThis.fetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(client.getAd('console-workbench')).rejects.toMatchObject({
      name: 'CLIRevenueNetworkError',
    })
  })

  it('reports a click without ever naming a campaign, advertiser or reward', async () => {
    const client = sdk.init(KEY)
    const fetchMock = globalThis.fetch
    fetchMock.mockResolvedValueOnce(okJson({ status: 'recorded' }))

    await client.recordClick(SERVED)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/ads/click')
    const body = JSON.parse(init.body)
    expect(Object.keys(body).sort()).toEqual([
      'idempotencyKey',
      'impressionToken',
      'publisherKey',
      'requestId',
    ])
    const serialised = JSON.stringify(body)
    expect(serialised).not.toMatch(/campaign|advertiser|publisherId|reward|amount/i)
  })

  it('caches a serve for 60 seconds instead of asking again', async () => {
    const client = sdk.init(KEY)
    globalThis.fetch.mockResolvedValueOnce(okJson(SERVED))

    await client.getAd('console-workbench')
    await client.getAd('console-workbench')

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------- 3. placement registry */

describe('placement registry', () => {
  it('delivers four surfaces, each by a readable key', () => {
    expect(DELIVERED_PLACEMENT_KEYS).toEqual(['console-workbench', 'film-ad', 'film-experience', 'console-drum'])
    expect(DELIVERED_PLACEMENTS).toHaveLength(4)
  })

  it('describes the workbench slot, its dimensions and every non-happy state', () => {
    const placement = PLACEMENTS.consoleWorkbench
    expect(placement.key).toBe('console-workbench')
    expect(placement.surface).toBeTruthy()
    expect(placement.selector).toBeTruthy()
    expect(placement.owner).toBeTruthy()
    expect(placement.viewability).toMatchObject({ threshold: 0.5, dwellMs: 1000 })
    for (const field of ['loading', 'noFill', 'error', 'offline', 'disabled']) {
      expect(typeof placement[field].headline).toBe('string')
      expect(placement[field].headline.length).toBeGreaterThan(0)
      expect(typeof placement[field].support).toBe('string')
      expect(placement[field].support.length).toBeGreaterThan(0)
    }
  })

  it('describes the film scene slots, each with a real key and full state copy', () => {
    for (const id of ['filmAd', 'filmExperience']) {
      const placement = PLACEMENTS[id]
      expect(placement).toBeDefined()
      expect(placement.key).toMatch(/^[a-z0-9][a-z0-9-]{2,47}$/)
      expect(placement.delivery).not.toBe(false)
      expect(placement.owner).toMatch(/scenes\/The(Ad|Experience)\.jsx$/)
      for (const field of ['loading', 'noFill', 'error', 'offline', 'disabled']) {
        expect(typeof placement[field].headline).toBe('string')
        expect(placement[field].headline.length).toBeGreaterThan(0)
        expect(typeof placement[field].support).toBe('string')
        expect(placement[field].support.length).toBeGreaterThan(0)
      }
    }
  })

  it('marks the narrative film slot documentation as non-delivery', () => {
    const film = PLACEMENTS.filmSlot
    expect(film.key).toBeNull()
    expect(film.delivery).toBe(false)
    expect(film.reason).toMatch(/narrative/i)
    expect(DELIVERED_PLACEMENT_KEYS).not.toContain(film.key)
  })

  it('never invents an opaque or uuid-shaped placement key', () => {
    for (const placement of Object.values(PLACEMENTS)) {
      if (!placement.key) continue
      expect(placement.key).toMatch(/^[a-z0-9][a-z0-9-]{2,47}$/)
      expect(placement.key).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i)
    }
  })

  it('keeps placement keys unique', () => {
    const keys = Object.values(PLACEMENTS)
      .map((p) => p.key)
      .filter(Boolean)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

/* ------------------------------------------------- 4. the visual contract */

describe('sponsored slot renders every delivery state', () => {
  const placement = PLACEMENTS.consoleWorkbench

  const copy = (state) => placement[state] ?? placement.loading

  const render = (props) =>
    renderToStaticMarkup(
      <SponsoredSlot
        state={props.state}
        served={props.served ?? null}
        campaign={props.campaign ?? null}
        headline={props.headline ?? copy(props.state).headline}
        support={props.support ?? copy(props.state).support}
        placementKey={placement.key}
        ctaHref={props.ctaHref ?? ''}
      />,
    )

  it('renders the delivered ad as a real link to the served destination', () => {
    const html = render({ state: 'ready', served: SERVED, ctaHref: SERVED.ad.landingUrl })

    expect(html).toContain(`href="${SERVED.ad.landingUrl}"`)
    expect(html).toContain(SERVED.ad.headline)
    expect(html).toContain(SERVED.ad.description)
    expect(html).toContain(SERVED.ad.cta)
    expect(html).toContain('data-ad-state="ready"')
    expect(html).toContain('Sponsored')
  })

  it('never shows an ugly failure for a legitimate no-fill', () => {
    const html = render({ state: 'nofill' })

    expect(html).toContain(copy('nofill').headline)
    expect(html).toContain('data-ad-state="nofill"')
    expect(html).not.toMatch(/error|fail|unable|sad/i)
    expect(html).not.toMatch(/\$\d/)
  })

  it('keeps its frame while loading, with no dead control', () => {
    const html = render({ state: 'loading' })
    expect(html).toContain('data-ad-state="loading"')
    expect(html).toContain('adslot')
    expect(html).not.toContain('<button')
  })

  it('offers exactly one useful action when a request failed or the device is offline', () => {
    for (const state of ['error', 'offline']) {
      const html = render({ state })
      expect(html).toContain('Try again')
      expect(html).toContain('data-ad-state')
    }
  })

  it('says so plainly when the surface is not configured for delivery', () => {
    const html = render({ state: 'disabled' })
    expect(html).toContain('data-ad-state="disabled"')
  })

  it('never renders simulated money outside the advertiser creative preview', () => {
    const delivered = render({ state: 'ready', served: SERVED, ctaHref: SERVED.ad.landingUrl })
    for (const state of ['loading', 'nofill', 'error', 'offline', 'disabled']) {
      const html = render({ state })
      expect(html).not.toContain('Interaction recorded')
      expect(html).not.toMatch(/pending · demo/)
    }
    expect(delivered).not.toContain('Interaction recorded')
  })

  it('labels the advertiser console creative as a preview, not as delivery', () => {
    const html = renderToStaticMarkup(
      <SponsoredSlot
        campaign={{
          id: 'cmp_atlas',
          name: 'Atlas',
          advertiser: 'Atlas',
          brand: 'Atlas',
          headline: 'Demo creative',
          description: 'Never delivered.',
          cta: 'Preview',
          category: 'Developer tools',
          disclosure: 'Demo',
        }}
      />,
    )
    expect(html).toContain('data-ad-state="preview"')
    expect(html).toContain('Demo')
  })

  it('keeps the established class contract for the stylesheet', () => {
    const html = render({ state: 'ready', served: SERVED, ctaHref: SERVED.ad.landingUrl })
    for (const className of [
      'adslot',
      'adslot--workbench',
      'adslot__plate',
      'adslot__rail',
      'adslot__label',
      'adslot__dot',
      'adslot__publisher',
      'adslot__mark',
      'adslot__disclosure',
      'adslot__body',
      'adslot__logo',
      'adslot__copy',
      'adslot__brand',
      'adslot__headline',
      'adslot__support',
      'adslot__meta',
      'adslot__cta',
    ]) {
      expect(html).toContain(className)
    }
  })

  it('does not suppress the browser navigation on a delivered click', () => {
    const source = readSource('src/components/console/SponsoredSlot.jsx')
    expect(source).not.toContain('preventDefault')
  })
})

/* ---------------------------- 4b. a disclosure is never sold as a click */

describe('a disclosure is never reported as a click-through', () => {
  it('reports a click only when the ad has somewhere to send the visitor', async () => {
    const { activationReportsClick } = await import('../src/hooks/useServedAd.js')

    /* The normal case: a served ad with a destination really is a
       click-through, so it must be reported. */
    expect(activationReportsClick('ready', SERVED)).toBe(true)

    /* The gap this closes: `landingUrl` is nullable. With no destination
       the control is a plain button that only expands the detail panel,
       and counting that as a billed click would invent revenue out of a
       disclosure. */
    expect(activationReportsClick('ready', { ...SERVED, ad: { ...SERVED.ad, landingUrl: null } })).toBe(
      false,
    )

    /* Nothing is clickable before an ad exists, whatever the state says. */
    for (const state of ['loading', 'nofill', 'error', 'offline', 'disabled']) {
      expect(activationReportsClick(state, SERVED)).toBe(false)
      expect(activationReportsClick(state, null)).toBe(false)
    }
    expect(activationReportsClick('ready', null)).toBe(false)
  })

  it('keeps the retry path intact for a slot with nothing to click', async () => {
    const source = readSource('src/components/console/ServedAdSlot.jsx')

    /* The click guard must not swallow the retry: a failed or offline slot
       still needs its control to do something useful. */
    expect(source).toMatch(/state !== AD_STATE\.READY \|\| !served[\s\S]{0,120}retry\(\)/)
  })
})

/* ------------------------------------------------- 5. who owns accounting */

const OWNED_FILES = [
  'src/components/console/SponsoredSlot.jsx',
  'src/components/console/ServedAdSlot.jsx',
  'src/components/console/Workbench.jsx',
  'src/components/scenes/TheAd.jsx',
  'src/components/scenes/TheExperience.jsx',
  'src/hooks/useServedAd.js',
  'src/lib/clirevenue.js',
  'src/data/placements.js',
  'src/components/developer/SdkSetup.jsx',
  'src/components/developer/DeveloperApp.jsx',
]

describe('the SDK owns delivery, the UI owns rendering', () => {
  it('the delivered slot never calls the economy store', () => {
    for (const file of OWNED_FILES) {
      const source = readSource(file)
      expect(source, file).not.toMatch(/economyStore/)
      expect(source, file).not.toMatch(/recordQualifyingEvent|getActiveCampaign/)
      expect(source, file).not.toMatch(/SEED_CAMPAIGNS/)
    }
  })

  it('the delivered slot never records an impression itself', () => {
    for (const file of [
      'src/components/console/SponsoredSlot.jsx',
      'src/components/console/ServedAdSlot.jsx',
      'src/components/console/Workbench.jsx',
      'src/hooks/useServedAd.js',
    ]) {
      expect(readSource(file), file).not.toContain('recordImpression')
    }
  })

  it('the delivery hook reports impressions only through viewability', () => {
    const hook = readSource('src/hooks/useServedAd.js')
    expect(hook).toContain('watchViewability')
    expect(hook).not.toContain('recordImpression')
  })

  it('the delivery hook releases the client when the surface unmounts', () => {
    const hook = readSource('src/hooks/useServedAd.js')
    expect(hook).toMatch(/useEffect\(\(\) => \(\) => disposeClient\(\), \[\]\)/)
  })

  it('reports the click through the SDK, fire-and-forget', () => {
    const slot = readSource('src/components/console/ServedAdSlot.jsx')
    expect(slot).toContain('recordClick')
    expect(slot).toContain('.catch(')
    expect(slot).not.toContain('await ')
  })

  it('no client-side reward is computed on the delivered path', () => {
    const slot = readSource('src/components/console/ServedAdSlot.jsx')
    expect(slot).not.toMatch(/REWARD_PER_INTERACTION|formatMoney/)
  })
})

/* ------------------------------------------------- 6. what the client holds */

describe('nothing secret reaches the client', () => {
  const owned = OWNED_FILES.map(readSource)
  const ownedText = owned.join('\n')

  it('no server secret name appears in any file this integration owns', () => {
    for (const file of OWNED_FILES) {
      if (file.endsWith('SdkSetup.jsx')) continue
      const text = readSource(file)
      expect(text, file).not.toMatch(/AD_TOKEN_SECRET/)
      expect(text, file).not.toMatch(/SETTLEMENT_SECRET/)
      expect(text, file).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/)
    }
  })

  it('the onboarding page names the forbidden secrets only as documentation', () => {
    const setup = readSource('src/components/developer/SdkSetup.jsx')
    expect(setup).toContain('AD_TOKEN_SECRET')
    expect(setup).toContain('SETTLEMENT_SECRET')
    expect(setup).not.toMatch(/AD_TOKEN_SECRET\s*[:=]\s*['"`][A-Za-z0-9]/)
    expect(setup).not.toMatch(/pk_(live|test)_[A-Za-z0-9_-]{32,}/)
    expect(setup).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
  })

  it('no bearer token or JWT is hard-coded anywhere', () => {
    for (const { rel, text } of SRC_FILES) {
      expect(text, rel).not.toMatch(/Bearer\s+eyJ/)
      expect(text, rel).not.toMatch(/['"`]eyJ[A-Za-z0-9_-]{10,}\./)
    }
  })

  it('no cookie, no localStorage, no IndexedDB in the files this integration owns', () => {
    expect(ownedText).not.toMatch(/document\.cookie/)
    expect(ownedText).not.toMatch(/\blocalStorage\b/)
    expect(ownedText).not.toMatch(/indexedDB/i)
  })

  it('no third-party analytics or tracking pixel was introduced', () => {
    for (const { rel, text } of SRC_FILES) {
      expect(text, rel).not.toMatch(/googletagmanager|google-analytics|gtag\(|fbq\(|hotjar|segment\.io|mixpanel/i)
      expect(text, rel).not.toMatch(/<img[^>]+src=["']https?:/i)
    }
  })

  it('the browser reads only allow-listed environment variables', () => {
    const allowed = new Set([
      'VITE_API_BASE_URL',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_CLIREVENUE_PUBLISHABLE_KEY',
    ])
    const seen = new Set()
    for (const { rel, text } of SRC_FILES) {
      for (const match of text.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
        seen.add(match[1])
        expect(allowed.has(match[1]), `${rel} reads ${match[1]}`).toBe(true)
      }
    }
    expect(seen.has('VITE_CLIREVENUE_PUBLISHABLE_KEY')).toBe(true)
  })

  it('the SDK talks to one host and sends no PII', () => {
    const sdk = SRC_FILES.filter((f) => f.rel.startsWith('packages/sdk/src'))
    for (const { rel, text } of sdk) {
      expect(text, rel).not.toMatch(/https?:\/\/(?!api\.clirevenue\.in)[a-z0-9.-]+\.[a-z]{2,}/i)
      expect(text, rel).not.toMatch(/['"]?(email|userId|fingerprint)['"]?\s*:/)
    }
  })
})

/* ------------------------------------- 7. offline, and what it looks like */

describe('an unreachable gateway is an offline slot, not a broken one', () => {
  it('maps a failure to a state without pretending to know more than it does', async () => {
    const { AD_STATE, classifyAdFailure, describeAdFailure } = await import(
      '../src/hooks/useServedAd.js'
    )

    expect(classifyAdFailure({ name: 'CLIRevenueNetworkError' }, true)).toBe(AD_STATE.OFFLINE)
    expect(classifyAdFailure({ name: 'CLIRevenueHttpError' }, true)).toBe(AD_STATE.ERROR)
    expect(classifyAdFailure({ name: 'CLIRevenueHttpError' }, false)).toBe(AD_STATE.OFFLINE)
    expect(classifyAdFailure(null, true)).toBe(AD_STATE.ERROR)

    expect(describeAdFailure(null)).toBeNull()
    const described = describeAdFailure(new Error('boom'))
    expect(described).toMatchObject({ name: 'Error', message: 'boom' })
    expect(described.message.length).toBeLessThanOrEqual(240)
  })

  it('queues an impression made while offline and sends it on flush', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    vi.stubGlobal('sessionStorage', memoryStorage())
    const sdk = await import('@clirevenue/sdk')
    const client = sdk.init(KEY, { maxRetries: 0 })

    await expect(client.recordImpression(SERVED)).resolves.toBeUndefined()
    expect(client.pendingEvents).toBe(1)

    globalThis.fetch.mockResolvedValue(okJson({ status: 'recorded' }))
    await expect(client.flush()).resolves.toMatchObject({ sent: 1, failed: 0 })
    expect(client.pendingEvents).toBe(0)
    expect(String(globalThis.fetch.mock.calls.at(-1)[0])).toContain('/ads/impression')

    client.destroy()
    vi.unstubAllGlobals()
  })

  it('reuses one serve for a repeated impression, never a second serve', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ status: 'recorded' })))
    vi.stubGlobal('sessionStorage', memoryStorage())
    const sdk = await import('@clirevenue/sdk')
    const client = sdk.init(KEY)

    const served = { ...SERVED, requestId: crypto.randomUUID() }
    await client.recordImpression(served)
    await client.recordImpression(served)

    // Two posts, one serve. The gateway is the authority on how many
    // impressions count; the client only repeats what it was given.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    const bodies = globalThis.fetch.mock.calls.map((call) => JSON.parse(call[1].body))
    for (const body of bodies) {
      expect(body.requestId).toBe(served.requestId)
      expect(body.impressionToken).toBe(served.impressionToken)
      expect(body.publisherKey).toBe(KEY)
    }
    // The payload is a fixed set of serve facts. There is no field in
    // which a client-side count, total or amount could even be smuggled.
    expect(Object.keys(bodies[0]).sort()).toEqual([
      'cliIntegration',
      'idempotencyKey',
      'impressionToken',
      'publisherKey',
      'requestId',
      'sessionId',
    ])

    client.destroy()
    vi.unstubAllGlobals()
  })
})

/* ----------------------------------------- 8. the onboarding UI tells the truth */

describe('the SDK setup page tells the truth about what exists', () => {
  it('walks a developer through all ten steps, and no further', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_CLIREVENUE_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_API_BASE_URL', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { default: SdkSetup } = await import('../src/components/developer/SdkSetup.jsx')
    const html = renderToStaticMarkup(<SdkSetup />)

    // One publisher, one key, one placement — then the code, then no-fill,
    // impressions, testing and performance. Exactly ten, in order.
    const steps = [...html.matchAll(/data-step="(\d+)"/g)].map((m) => Number(m[1]))
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    for (const topic of [
      'create a publisher',
      'publishable publisher key',
      'create a placement',
      'install the sdk',
      'init(',
      'getad(',
      'no-fill',
      'impression',
      'self-test',
      'performance',
    ]) {
      expect(html.toLowerCase(), topic).toContain(topic)
    }

    warn.mockRestore()
    vi.unstubAllEnvs()
  })

  it('admits it is unconfigured instead of inventing a key or a result', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_CLIREVENUE_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_API_BASE_URL', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { default: SdkSetup } = await import('../src/components/developer/SdkSetup.jsx')
    const html = renderToStaticMarkup(<SdkSetup />)

    expect(html).toContain('not configured')
    expect(html).toContain('data-ok="no"')
    // No usable key literal anywhere. (`pk_live_…` appears only as prose
    // describing the key *format*, which is documentation, not a credential.)
    expect(html).not.toMatch(/pk_(live|test)_[A-Za-z0-9_-]{32,}/)
    // The self-test states up front that it reports rather than asserts, and
    // offers no client reset until there is a client to reset.
    expect(html.toLowerCase()).toContain('does not assert success')
    expect(html).not.toContain('Reset client')
    expect(html).toContain('Run delivery test')

    // The honest empty state for performance, with its reason stated.
    expect(html).toContain('No performance data is shown here')
    expect(html).toContain('ad_serve_log')

    warn.mockRestore()
    vi.unstubAllEnvs()
  })

  it('lists what the browser may hold next to what it may never hold', async () => {
    const setup = readSource('src/components/developer/SdkSetup.jsx')
    expect(setup).toContain('AD_TOKEN_SECRET')
    expect(setup).toContain('SETTLEMENT_SECRET')
    // Nothing in the never-list is ever handed to the client factory.
    const boundary = readSource('src/lib/clirevenue.js')
    expect(boundary).not.toMatch(/AD_TOKEN_SECRET|SETTLEMENT_SECRET|SERVICE_ROLE/)
  })
})
