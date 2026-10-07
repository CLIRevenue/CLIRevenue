import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Public surface -- exactly what a consumer may import.
import {
  CLIRevenue,
  init,
  CLIRevenueConfigError,
  CLIRevenueHttpError,
  CLIRevenueTimeoutError,
  CLIRevenueNetworkError,
  SDK_VERSION_HEADER,
  SDK_VERSION,
} from '../src/index.ts'

// Internals -- imported from their own modules, not via the public barrel.
// This is the point of the narrow barrel: these are testable but not public.
import { MAX_QUEUE_SIZE, createEventQueue } from '../src/queue.ts'
import { CACHE_TTL_MS, createPlacementCache } from '../src/cache.ts'
import { VIEWABILITY_MIN_MS, createViewabilityGate } from '../src/viewability.ts'
import { backoffDelay, isRetryableStatus } from '../src/http.ts'


const KEY = 'pk_test_' + 'a'.repeat(32)
const BASE = 'https://api.test'

/** Build a fetch stub from a queue of per-call handlers.
 *
 * `calls` is the ad pipeline only: /telemetry traffic is recorded separately in
 * `telemetryCalls`. The SDK opens a telemetry session the first time a
 * publisher actually uses it, so mixing the two into one list would make every
 * assertion about "the first call the SDK makes" depend on an unrelated
 * lifecycle. The telemetry assertions live in their own suite below and read
 * `telemetryCalls`.
 */
function stubFetch(handlers, telemetryHandlers) {
  const calls = []
  const telemetryCalls = []
  const impl = async (url, init = {}) => {
    const isTelemetry = String(url).includes('/telemetry')
    if (isTelemetry) {
      telemetryCalls.push({ url, init })
      const handler = telemetryHandlers?.[telemetryCalls.length - 1] ?? { status: 200, json: async () => ({ success: true }), text: async () => '{}' }
      if (typeof handler === 'function') return handler(init, url)
      return handler
    }
    calls.push({ url, init })
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)]
    if (typeof handler === 'function') return handler(init, url)
    return handler
  }
  impl.calls = calls
  impl.telemetryCalls = telemetryCalls
  return impl
}

function jsonResponse(status, body) {
  return { status, json: async () => body, text: async () => JSON.stringify(body) }
}

function servedAd(requestId = 'req-1') {
  return {
    requestId,
    ad: {
      id: 'ad-1',
      name: null,
      headline: 'Headline',
      description: null,
      cta: null,
      audience: 'cli-revenue',
      landingUrl: null,
    },
    impressionToken: 'tok-1',
    expiresAt: '2099-01-01T00:00:00Z',
  }
}

function makeClient(fetchImpl, extra = {}) {
  return init(KEY, {
    baseUrl: BASE,
    fetchImpl,
    // No backoff waiting in tests; the backoff maths is asserted directly.
    sleep: async () => {},
    random: () => 0.5,
    storage: null,
    ...extra,
  })
}

/* ------------------------------------------------------------------ */
/* configuration                                                       */
/* ------------------------------------------------------------------ */

describe('init', () => {
  it.each([
    ['missing prefix', 'secret_live_'.padEnd(40, 'a')],
    ['too short', 'pk_test_short'],
    ['service role key', 'sb_secret_'.padEnd(40, 'b')],
    ['empty', ''],
    ['non string', 12345],
  ])('rejects a %s publisher key locally', (_label, value) => {
    expect(() => init(value)).toThrow(CLIRevenueConfigError)
  })

  it('accepts a well formed test key', () => {
    expect(() => init(KEY)).not.toThrow()
  })

  it('throws before making any network call', () => {
    const fetchImpl = vi.fn()
    expect(() => init('nope', { fetchImpl })).toThrow(CLIRevenueConfigError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* delivery                                                            */
/* ------------------------------------------------------------------ */

describe('getAd', () => {
  it('returns the served ad', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await expect(client.getAd('cli-landing')).resolves.toMatchObject({ requestId: 'req-1' })
    expect(fetchImpl.calls[0].url).toBe(`${BASE}/ads/deliver`)
  })

  it('returns null on 204 no-fill and does not throw', async () => {
    const fetchImpl = stubFetch([{ status: 204, json: async () => { throw new Error('no body') } }])
    const client = makeClient(fetchImpl)
    await expect(client.getAd('cli-landing')).resolves.toBeNull()
  })

  it('serves subsequent calls from cache within the TTL', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await client.getAd('cli-landing')
    await client.getAd('cli-landing')
    await client.getAd('cli-landing')
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('caches the no-fill too, so a 204 is not re-requested on every scroll', async () => {
    const fetchImpl = stubFetch([{ status: 204, json: async () => null }])
    const client = makeClient(fetchImpl)
    await client.getAd('cli-landing')
    await client.getAd('cli-landing')
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('refetches once the 60s TTL expires', async () => {
    let now = 1_000
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl, { now: () => now })
    await client.getAd('cli-landing')
    now += CACHE_TTL_MS - 1
    await client.getAd('cli-landing')
    expect(fetchImpl.calls).toHaveLength(1)
    now += 2
    await client.getAd('cli-landing')
    expect(fetchImpl.calls).toHaveLength(2)
  })

  it('caches per placement, not globally', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await client.getAd('cli-landing')
    await client.getAd('cli-sidebar')
    expect(fetchImpl.calls).toHaveLength(2)
  })

  it('rejects an empty placement key without a request', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await expect(client.getAd('  ')).rejects.toThrow(CLIRevenueConfigError)
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it('identifies the SDK version on every request', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    await makeClient(fetchImpl).getAd('cli-landing')
    expect(fetchImpl.calls[0].init.headers[SDK_VERSION_HEADER]).toBe(SDK_VERSION)
  })
})

/* ------------------------------------------------------------------ */
/* privacy invariants                                                  */
/* ------------------------------------------------------------------ */

describe('privacy invariants', () => {
  it('sends no cookie and no credentials', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    await makeClient(fetchImpl).getAd('cli-landing')
    const { headers, body } = fetchImpl.calls[0].init
    const headerNames = Object.keys(headers).map((h) => h.toLowerCase())
    expect(headerNames).not.toContain('cookie')
    expect(headerNames).not.toContain('authorization')
    expect(JSON.stringify(body)).not.toMatch(/fp|deviceId|visitorId|fingerprint/i)
  })

  it('carries no PII in the delivery payload', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    await makeClient(fetchImpl).getAd('cli-landing')
    const body = JSON.parse(fetchImpl.calls[0].init.body)
    // Only the publisher key, the placement, page context, and the in-memory
    // session id. The session id is minted per page load and never persisted or
    // transmitted to another origin, so it names a page rather than a person --
    // and it is what lets the server tie this delivery's lifecycle events to the
    // rest of the page load.
    expect(Object.keys(body).sort()).toEqual([
      'placementKey',
      'publisherKey',
      'referrer',
      'requestId',
      'sessionId',
      'url',
    ])
  })

  it('never references a server-only secret in code', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const dir = new URL('../src/', import.meta.url)
    for (const name of readdirSync(dir)) {
      const src = readFileSync(new URL(name, dir), 'utf8')
      // Strip comments first: the privacy notes name the secret precisely to
      // document that it must never appear. Scan executable code, not prose.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role/i)
      // Nor a supabase admin/session key smuggled in under another name.
      expect(code).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/) // JWT-shaped literal
    }
  })
})

/* ------------------------------------------------------------------ */
/* retry policy                                                        */
/* ------------------------------------------------------------------ */

describe('retry policy', () => {
  it('retries a 5xx then succeeds', async () => {
    const fetchImpl = stubFetch([
      jsonResponse(503, { error: { code: 'unavailable', message: 'down' } }),
      jsonResponse(200, servedAd()),
    ])
    const client = makeClient(fetchImpl)
    await expect(client.getAd('cli-landing')).resolves.toMatchObject({ requestId: 'req-1' })
    expect(fetchImpl.calls).toHaveLength(2)
  })

  it('never retries a 4xx and surfaces the real reason', async () => {
    const fetchImpl = stubFetch([
      jsonResponse(401, { error: { code: 'invalid_key', message: 'Unknown publisher key.' } }),
    ])
    const client = makeClient(fetchImpl)
    const err = await client.getAd('cli-landing').catch((e) => e)
    expect(err).toBeInstanceOf(CLIRevenueHttpError)
    expect(err.status).toBe(401)
    expect(err.code).toBe('invalid_key')
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('honours maxRetries as a total attempt count', async () => {
    const fetchImpl = stubFetch([jsonResponse(500, { error: { message: 'boom' } })])
    const client = makeClient(fetchImpl, { maxRetries: 2 })
    await expect(client.getAd('cli-landing')).rejects.toBeInstanceOf(CLIRevenueHttpError)
    expect(fetchImpl.calls).toHaveLength(3)
  })

  it('retries a transport failure', async () => {
    let n = 0
    const fetchImpl = async (url) => {
      // Count the delivery attempts only. The SDK also opens a telemetry
      // session on first use, and that traffic is on its own retry lifecycle.
      if (String(url).includes('/telemetry')) return jsonResponse(200, { ok: true })
      n++
      if (n === 1) throw new TypeError('Failed to fetch')
      return jsonResponse(200, servedAd())
    }
    const client = makeClient(fetchImpl)
    await expect(client.getAd('cli-landing')).resolves.not.toBeNull()
    expect(n).toBe(2)
  })

  it('raises a network error when every attempt fails at transport level', async () => {
    const fetchImpl = async () => { throw new TypeError('offline') }
    await expect(makeClient(fetchImpl).getAd('cli-landing')).rejects.toBeInstanceOf(CLIRevenueNetworkError)
  })
})

describe('idempotency', () => {
  it('reuses one key across every retry of a logical event', async () => {
    const fetchImpl = stubFetch([
      jsonResponse(500, { error: { message: 'boom' } }),
      jsonResponse(500, { error: { message: 'boom' } }),
      jsonResponse(200, servedAd()),
    ])
    await makeClient(fetchImpl).getAd('cli-landing')
    const keys = fetchImpl.calls.map((c) => c.init.headers['x-idempotency-key'])
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toMatch(/\S/)
  })

  it('gives distinct logical requests distinct keys', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await client.getAd('cli-landing')
    await client.getAd('cli-sidebar')
    const keys = fetchImpl.calls.map((c) => c.init.headers['x-idempotency-key'])
    expect(new Set(keys).size).toBe(2)
  })
})

describe('timeouts', () => {
  it('aborts the in-flight request and raises CLIRevenueTimeoutError', async () => {
    const fetchImpl = (url, init = {}) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const client = makeClient(fetchImpl, { timeoutMs: 30, maxRetries: 0 })
    await expect(client.getAd('cli-landing')).rejects.toBeInstanceOf(CLIRevenueTimeoutError)
  })

  it('retries a timeout within the budget', async () => {
    let n = 0
    const fetchImpl = (url, init = {}) => {
      n++
      if (n === 1) {
        return new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))
      }
      return Promise.resolve(jsonResponse(200, servedAd()))
    }
    const client = makeClient(fetchImpl, { timeoutMs: 30 })
    await expect(client.getAd('cli-landing')).resolves.not.toBeNull()
    expect(n).toBe(2)
  })

  it('leaves a fast request un-aborted', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    await expect(makeClient(fetchImpl, { timeoutMs: 5_000 }).getAd('cli-landing')).resolves.not.toBeNull()
  })
})

describe('backoff', () => {
  it('treats 5xx and network failures as retryable, 4xx as not', () => {
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(401)).toBe(false)
    expect(isRetryableStatus(429)).toBe(false)
  })

  it('applies full jitter within a growing, capped ceiling', () => {
    expect(backoffDelay(0, () => 0)).toBe(0)
    expect(backoffDelay(0, () => 0.999)).toBeLessThanOrEqual(250)
    const d1 = backoffDelay(1, () => 1)
    const d2 = backoffDelay(2, () => 1)
    expect(d2).toBeGreaterThan(d1) // ceiling widens with attempt
    expect(backoffDelay(20, () => 1)).toBe(30_000) // capped
  })
})

/* ------------------------------------------------------------------ */
/* viewability                                                         */
/* ------------------------------------------------------------------ */

function fakeObserverFactory() {
  const instances = []
  const Impl = class {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      instances.push(this)
    }
    observe() {}
    disconnect() { this.disconnected = true }
    emit(entries) { this.callback(entries) }
  }
  return { Impl, instances }
}

const full = { isIntersecting: true, intersectionRatio: 1 }
const partial = { isIntersecting: true, intersectionRatio: 0.4 }

describe('viewability gate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires only after 50% visibility is held for a full second', () => {
    const { Impl, instances } = fakeObserverFactory()
    const onViewable = vi.fn()
    createViewabilityGate({ ObserverImpl: Impl })({} as Element, onViewable)

    instances[0].emit([full])
    vi.advanceTimersByTime(VIEWABILITY_MIN_MS - 1)
    expect(onViewable).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onViewable).toHaveBeenCalledTimes(1)
  })

  it('does not fire on a brief full pass', () => {
    const { Impl, instances } = fakeObserverFactory()
    const onViewable = vi.fn()
    createViewabilityGate({ ObserverImpl: Impl })({} as Element, onViewable)

    instances[0].emit([full])
    vi.advanceTimersByTime(500)
    instances[0].emit([partial]) // dropped below the bar
    vi.advanceTimersByTime(5_000)
    expect(onViewable).not.toHaveBeenCalled()
  })

  it('restarts the dwell clock after dropping below the threshold', () => {
    const { Impl, instances } = fakeObserverFactory()
    const onViewable = vi.fn()
    createViewabilityGate({ ObserverImpl: Impl })({} as Element, onViewable)

    instances[0].emit([full])
    vi.advanceTimersByTime(900)
    instances[0].emit([partial])
    instances[0].emit([full]) // back above: clock restarts
    vi.advanceTimersByTime(900)
    expect(onViewable).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onViewable).toHaveBeenCalledTimes(1)
  })

  it('ignores a non-intersecting entry entirely', () => {
    const { Impl, instances } = fakeObserverFactory()
    const onViewable = vi.fn()
    createViewabilityGate({ ObserverImpl: Impl })({} as Element, onViewable)

    instances[0].emit([{ isIntersecting: false, intersectionRatio: 0 }])
    vi.advanceTimersByTime(10_000)
    expect(onViewable).not.toHaveBeenCalled()
  })

  it('fires exactly once and disconnects itself', () => {
    const { Impl, instances } = fakeObserverFactory()
    const onViewable = vi.fn()
    createViewabilityGate({ ObserverImpl: Impl })({} as Element, onViewable)

    instances[0].emit([full])
    vi.advanceTimersByTime(VIEWABILITY_MIN_MS)
    expect(instances[0].disconnected).toBe(true)

    instances[0].emit([full])
    vi.advanceTimersByTime(VIEWABILITY_MIN_MS)
    expect(onViewable).toHaveBeenCalledTimes(1)
  })

  it('does not fire after dispose', () => {
    const { Impl, instances } = fakeObserverFactory()
    const onViewable = vi.fn()
    const dispose = createViewabilityGate({ ObserverImpl: Impl })({} as Element, onViewable)
    instances[0].emit([full])
    dispose()
    vi.advanceTimersByTime(5_000)
    expect(onViewable).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* tracking                                                            */
/* ------------------------------------------------------------------ */

describe('trackConversion', () => {
  it('throws a config error for a missing requestId', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await expect(client.trackConversion()).rejects.toThrow(CLIRevenueConfigError)
    await expect(client.trackConversion('')).rejects.toThrow(CLIRevenueConfigError)
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it('throws rather than silently dropping an unknown requestId', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await expect(client.trackConversion('never-served')).rejects.toThrow(CLIRevenueConfigError)
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it('posts a conversion for a requestId it served', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd('req-9')), jsonResponse(200, { ok: true })])
    const client = makeClient(fetchImpl)
    const served = await client.getAd('cli-landing')
    await client.trackConversion(served.requestId)
    expect(fetchImpl.calls[1].url).toBe(`${BASE}/ads/conversion`)
    expect(JSON.parse(fetchImpl.calls[1].init.body).requestId).toBe('req-9')
  })
})

/* ------------------------------------------------------------------ */
/* offline queue                                                       */
/* ------------------------------------------------------------------ */

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

describe('offline queue', () => {
  it('round-trips an event', () => {
    const q = createEventQueue({ storage: memoryStorage() })
    q.enqueue({ path: '/ads/impression', body: { a: 1 }, idempotencyKey: 'k1', queuedAt: 1 })
    expect(q.length).toBe(1)
    expect(q.drain()).toEqual([{ path: '/ads/impression', body: { a: 1 }, idempotencyKey: 'k1', queuedAt: 1 }])
    expect(q.length).toBe(0)
  })

  it('caps at 100 events, dropping the oldest', () => {
    const q = createEventQueue({ storage: memoryStorage() })
    for (let i = 0; i < MAX_QUEUE_SIZE + 25; i++) {
      q.enqueue({ path: '/ads/impression', body: { i }, idempotencyKey: `k${i}`, queuedAt: i })
    }
    expect(q.length).toBe(MAX_QUEUE_SIZE)
    expect(q.peek()[0].idempotencyKey).toBe('k25')
  })

  it('survives corrupt storage', () => {
    const q = createEventQueue({ storage: memoryStorage({ 'clirevenue:pending-events': '{not json' }) })
    expect(q.length).toBe(0)
    expect(() => q.enqueue({ path: '/p', body: {}, idempotencyKey: 'k', queuedAt: 0 })).not.toThrow()
  })

  it('drops malformed entries rather than failing to send good ones', () => {
    const storage = memoryStorage()
    storage.setItem(
      'clirevenue:pending-events',
      JSON.stringify([{ nonsense: true }, { path: '/p', idempotencyKey: 'good' }]),
    )
    const q = createEventQueue({ storage })
    expect(q.drain().map((e) => e.idempotencyKey)).toEqual(['good'])
  })

  it('degrades to a no-op when storage is unavailable', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    const q = createEventQueue({ storage: throwing })
    expect(() => q.enqueue({ path: '/p', body: {}, idempotencyKey: 'k', queuedAt: 0 })).not.toThrow()
    expect(q.length).toBe(0)
  })

  it('does not throw when storage is null (privacy mode)', () => {
    const q = createEventQueue({ storage: null })
    expect(() => q.enqueue({ path: '/p', body: {}, idempotencyKey: 'k', queuedAt: 0 })).not.toThrow()
    expect(q.length).toBe(0)
  })
})

describe('impression queueing', () => {
  it('queues an impression that fails and reuses the key when it is flushed', async () => {
    const storage = memoryStorage()
    const served = await makeClient(stubFetch([jsonResponse(200, servedAd())]), { storage })
      .getAd('cli-landing')
    expect(served).not.toBeNull()

    // Delivery is up, the impression endpoint is not.
    const failing = stubFetch([jsonResponse(500, { error: { message: 'boom' } })])
    const client = makeClient(failing, { maxRetries: 0, storage })
    await expect(client.recordImpression(served)).resolves.toBeUndefined()
    expect(client.pendingEvents).toBe(1)

    const queued = JSON.parse(storage.getItem('clirevenue:pending-events'))
    const queuedKey = queued[0].idempotencyKey

    const recovered = stubFetch([jsonResponse(200, { ok: true })])
    await expect(makeClient(recovered, { storage }).flush())
      .resolves.toEqual({ sent: 1, failed: 0 })
    // The replayed event must still be one logical event.
    expect(recovered.calls[0].init.headers['x-idempotency-key']).toBe(queuedKey)
  })

  it('does not queue a permanently rejected impression', async () => {
    const storage = memoryStorage()
    const served = await makeClient(stubFetch([jsonResponse(200, servedAd())]), { storage })
      .getAd('cli-landing')
    const rejected = stubFetch([jsonResponse(400, { error: { code: 'bad_token', message: 'no' } })])
    const client = makeClient(rejected, { maxRetries: 0, storage })
    await expect(client.recordImpression(served)).rejects.toBeInstanceOf(CLIRevenueHttpError)
    expect(client.pendingEvents).toBe(0)
  })

  it('flushes queued events and reports the tally', async () => {
    const storage = memoryStorage()
    storage.setItem(
      'clirevenue:pending-events',
      JSON.stringify([
        { path: '/ads/impression', body: { a: 1 }, idempotencyKey: 'k1', queuedAt: 1 },
        { path: '/ads/impression', body: { a: 2 }, idempotencyKey: 'k2', queuedAt: 2 },
      ]),
    )
    const fetchImpl = stubFetch([jsonResponse(200, { ok: true })])
    const client = makeClient(fetchImpl, { storage })
    await expect(client.flush()).resolves.toEqual({ sent: 2, failed: 0 })
    expect(client.pendingEvents).toBe(0)
    const keys = fetchImpl.calls.map((c) => c.init.headers['x-idempotency-key'])
    expect(keys).toEqual(['k1', 'k2'])
  })

  it('counts a permanently rejected queued event as failed without throwing', async () => {
    const storage = memoryStorage()
    storage.setItem(
      'clirevenue:pending-events',
      JSON.stringify([{ path: '/ads/impression', body: {}, idempotencyKey: 'k1', queuedAt: 1 }]),
    )
    const fetchImpl = stubFetch([jsonResponse(400, { error: { message: 'bad' } })])
    const client = makeClient(fetchImpl, { storage })
    await expect(client.flush()).resolves.toEqual({ sent: 0, failed: 1 })
  })
})

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

describe('placement cache', () => {
  it('expires on ttl and supports reverse lookup', () => {
    let now = 0
    const cache = createPlacementCache({ now: () => now })
    cache.set('a', { requestId: 'r1' })
    cache.set('b', null)
    expect(cache.get('a')).toEqual({ requestId: 'r1' })
    expect(cache.find((v) => v !== null && v.requestId === 'r1')).toEqual({ requestId: 'r1' })
    now = CACHE_TTL_MS
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(1) // lazily pruned on read
  })
})

describe('module surface', () => {
  it('exposes a class and a factory that agree', () => {
    expect(new CLIRevenue(KEY, { baseUrl: BASE, storage: null })).toBeInstanceOf(CLIRevenue)
  })

  it('exposes the custom-rendering entry points', () => {
    const client = makeClient(stubFetch([]))
    expect(typeof client.recordImpression).toBe('function')
    expect(typeof client.recordClick).toBe('function')
    expect(typeof client.watchViewability).toBe('function')
    expect(typeof client.destroy).toBe('function')
  })
})

/* ------------------------------------------------------------------ */
/* custom rendering (the frontend boundary)                            */
/* ------------------------------------------------------------------ */

describe('ambient IntersectionObserver', () => {
  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
  })

  function withAmbientObserver(run: (instances: any[]) => Promise<void> | void) {
    const { Impl, instances } = fakeObserverFactory()
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = Impl
    return run(instances)
  }

  it('uses the browser observer by default, so impressions are not silently skipped', async () => {
    vi.useFakeTimers()
    try {
      await withAmbientObserver(async (instances) => {
        const fetchImpl = stubFetch([
          jsonResponse(200, servedAd()),
          jsonResponse(200, { success: true }),
        ])
        // No ObserverImpl: exactly how a browser consumer calls init().
        const client = init(KEY, { baseUrl: BASE, fetchImpl, sleep: async () => {}, storage: null })
        const served = await client.getAd('cli-landing')
        const stop = client.watchViewability(served!, {} as Element)

        expect(instances).toHaveLength(1)
        instances[0].emit([full])
        vi.advanceTimersByTime(VIEWABILITY_MIN_MS)
        await vi.runAllTimersAsync()

        expect(fetchImpl.calls.some((c) => c.url === `${BASE}/ads/impression`)).toBe(true)
        stop()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('warns and records nothing when no observer exists at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = init(KEY, { baseUrl: BASE, fetchImpl, storage: null, ObserverImpl: undefined as never })
    // Force the "no ambient observer" branch by clearing the global.
    const served = await client.getAd('cli-landing')
    const stop = client.watchViewability(served!, {} as Element)
    stop()
    expect(fetchImpl.calls).toHaveLength(1) // delivery only, no impression
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('watchViewability', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('records the impression once the served ad is genuinely viewable', async () => {
    const { Impl, instances } = fakeObserverFactory()
    const fetchImpl = stubFetch([
      jsonResponse(200, servedAd()),
      jsonResponse(200, { success: true }),
    ])
    const client = makeClient(fetchImpl, { ObserverImpl: Impl })
    const served = await client.getAd('cli-landing')
    client.watchViewability(served!, {} as Element)

    instances[0].emit([full])
    await vi.advanceTimersByTimeAsync(VIEWABILITY_MIN_MS - 1)
    expect(fetchImpl.calls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl.calls).toHaveLength(2)
    expect(fetchImpl.calls[1].url).toBe(`${BASE}/ads/impression`)
  })

  it('does not record an impression when disposed before the dwell completes', async () => {
    const { Impl, instances } = fakeObserverFactory()
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl, { ObserverImpl: Impl })
    const served = await client.getAd('cli-landing')
    const stop = client.watchViewability(served!, {} as Element)

    instances[0].emit([full])
    vi.advanceTimersByTime(500)
    stop()
    vi.advanceTimersByTime(5_000)
    await vi.runAllTimersAsync()
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('is cancelled by destroy()', async () => {
    const { Impl, instances } = fakeObserverFactory()
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl, { ObserverImpl: Impl })
    const served = await client.getAd('cli-landing')
    client.watchViewability(served!, {} as Element)

    client.destroy()
    expect(instances[0].disconnected).toBe(true)
    instances[0].emit([full])
    vi.advanceTimersByTime(5_000)
    await vi.runAllTimersAsync()
    expect(fetchImpl.calls).toHaveLength(1)
  })
})

describe('recordClick', () => {
  it('posts the click for a served ad without inventing anything', async () => {
    const fetchImpl = stubFetch([
      jsonResponse(200, servedAd('req-click')),
      jsonResponse(200, { success: true }),
    ])
    const client = makeClient(fetchImpl)
    const served = await client.getAd('cli-landing')
    await client.recordClick(served!)

    expect(fetchImpl.calls[1].url).toBe(`${BASE}/ads/click`)
    const body = JSON.parse(fetchImpl.calls[1].init.body)
    expect(Object.keys(body).sort()).toEqual([
      'idempotencyKey',
      'impressionToken',
      'publisherKey',
      'requestId',
    ])
    expect(body.requestId).toBe('req-click')
    expect(body.impressionToken).toBe('tok-1')
    // No campaign, advertiser, publisher id or reward may be client-supplied.
    expect(JSON.stringify(body)).not.toMatch(/campaign|advertiser|reward/i)
  })

  it('does not retry a rejected click', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd()), jsonResponse(409, { error: { message: 'dup' } })])
    const client = makeClient(fetchImpl)
    const served = await client.getAd('cli-landing')
    await expect(client.recordClick(served!)).rejects.toBeInstanceOf(CLIRevenueHttpError)
    expect(fetchImpl.calls).toHaveLength(2)
  })
})

describe('destroy', () => {
  it('removes the global online listener it attached', () => {
    // The node test environment has no global addEventListener; a browser
    // does, so supply one and assert the pairing the SDK promises.
    const g = globalThis as {
      addEventListener?: unknown
      removeEventListener?: unknown
    }
    const originalAdd = g.addEventListener
    const originalRemove = g.removeEventListener
    const added: Array<{ type: string; fn: unknown }> = []
    const removed: Array<{ type: string; fn: unknown }> = []
    g.addEventListener = (type: string, fn: unknown) => {
      added.push({ type, fn })
    }
    g.removeEventListener = (type: string, fn: unknown) => {
      removed.push({ type, fn })
    }

    try {
      const client = makeClient(stubFetch([]))
      expect(added.some((e) => e.type === 'online')).toBe(true)
      client.destroy()
      const online = added.find((e) => e.type === 'online')
      expect(removed).toContainEqual({ type: 'online', fn: online!.fn })
      client.destroy() // idempotent
      expect(removed.filter((e) => e.type === 'online')).toHaveLength(1)
    } finally {
      g.addEventListener = originalAdd
      g.removeEventListener = originalRemove
    }
  })

  it('stops flushing after destroy', async () => {
    const storage = memoryStorage()
    const q = createEventQueue({ storage })
    q.enqueue({ path: '/ads/impression', body: { a: 1 }, idempotencyKey: 'k', queuedAt: 1 })

    const fetchImpl = stubFetch([])
    const client = init(KEY, { baseUrl: BASE, fetchImpl, storage })
    await client.flush()
    expect(fetchImpl.calls).toHaveLength(1)

    // Re-queue and destroy: a later `online` must not revive this client.
    client.destroy()
    expect(client.pendingEvents).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* regressions: the three SDK defects the integration audit found      */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('a request id is always canonical UUID text', () => {
  it('uses crypto.randomUUID when it exists', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, { requestId: 'r', ad: {}, impressionToken: 't', expiresAt: 'x' })])
    await makeClient(fetchImpl).getAd('home')
    expect(JSON.parse(fetchImpl.calls[0].init.body).requestId).toMatch(UUID_RE)
  })

  it('still produces dashed UUID text when crypto.randomUUID is unavailable', async () => {
    const real = globalThis.crypto
    // A plain-HTTP LAN origin has no secure context, so randomUUID is absent.
    const had = 'crypto' in globalThis
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: (a) => real.getRandomValues(a) },
    })
    try {
      const fetchImpl = stubFetch([jsonResponse(200, { requestId: 'r', ad: {}, impressionToken: 't', expiresAt: 'x' })])
      await makeClient(fetchImpl).getAd('home')
      const { requestId } = JSON.parse(fetchImpl.calls[0].init.body)
      expect(requestId).toMatch(UUID_RE)
    } finally {
      if (had) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real })
      else delete globalThis.crypto
    }
  })
})

describe('one logical event carries one idempotency key', () => {
  it('sends the same key in the header and the body on a click', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, { status: 'recorded' })])
    await makeClient(fetchImpl).recordClick(servedAd())
    const { headers, body } = fetchImpl.calls[0].init
    const sent = JSON.parse(body)
    expect(headers['x-idempotency-key']).toBe(sent.idempotencyKey)
    expect(sent.idempotencyKey).toMatch(UUID_RE)
  })

  it('sends the same key in the header and the body on a conversion', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, { requestId: 'req-1', ad: {}, impressionToken: 'tok-1', expiresAt: 'x' })])
    const client = makeClient(fetchImpl)
    await client.getAd('home')
    fetchImpl.calls.length = 0
    await client.trackConversion('req-1')
    const sent = JSON.parse(fetchImpl.calls[0].init.body)
    expect(fetchImpl.calls[0].init.headers['x-idempotency-key']).toBe(sent.idempotencyKey)
  })

  it('keeps one key across every retry of the same click', async () => {
    const fetchImpl = stubFetch([jsonResponse(500, { error: { message: 'boom' } })])
    await makeClient(fetchImpl).recordClick(servedAd()).catch(() => {})
    const keys = fetchImpl.calls.map((c) => JSON.parse(c.init.body).idempotencyKey)
    expect(keys.length).toBeGreaterThan(1)
    expect(new Set(keys).size).toBe(1)
  })
})

describe('a click survives the navigation that follows it', () => {
  it('sends the click with keepalive so unload cannot cancel it', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, { status: 'recorded' })])
    await makeClient(fetchImpl).recordClick(servedAd())
    expect(fetchImpl.calls[0].init.keepalive).toBe(true)
  })

  it('leaves the impression path and the deliver path on a normal fetch', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, { requestId: 'r', ad: {}, impressionToken: 't', expiresAt: 'x' })])
    const client = makeClient(fetchImpl)
    await client.getAd('home')
    await client.recordImpression(servedAd('r'))
    expect(fetchImpl.calls[0].init.keepalive).toBeUndefined()
    expect(fetchImpl.calls[1].init.keepalive).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* single-flight delivery                                              */
/* ------------------------------------------------------------------ */

/* A placement cache is only written once a response lands, so concurrent
   callers all see an empty cache and would each start their own POST. The
   in-flight map closes that window. */
describe('getAd is single-flight per placement', () => {
  it('two concurrent calls for one placement make exactly one delivery request', async () => {
    let release
    const held = new Promise((resolve) => { release = resolve })
    const fetchImpl = stubFetch([
      async () => { await held; return jsonResponse(200, servedAd('r1')) },
    ])
    const client = makeClient(fetchImpl)

    const a = client.getAd('slot-a')
    const b = client.getAd('slot-a')
    release()

    const [first, second] = await Promise.all([a, b])
    expect(fetchImpl.calls).toHaveLength(1)
    expect(first.requestId).toBe('r1')
    // The same resolved value, not two parses of the same response.
    expect(second).toBe(first)
  })

  it('shares one retry lifecycle between concurrent callers', async () => {
    const fetchImpl = stubFetch([
      jsonResponse(503, { error: { code: 'BUSY', message: 'later' } }),
      jsonResponse(200, servedAd('r1')),
    ])
    const client = makeClient(fetchImpl)

    const [a, b] = await Promise.all([client.getAd('slot-a'), client.getAd('slot-a')])

    /* One 503 then one 200. Without the in-flight map each caller would run
       its own retry budget and this would be four requests. */
    expect(fetchImpl.calls).toHaveLength(2)
    expect(a.requestId).toBe('r1')
    expect(b.requestId).toBe('r1')
  })

  it('shares one no-fill between concurrent callers', async () => {
    let release
    const held = new Promise((resolve) => { release = resolve })
    const fetchImpl = stubFetch([
      async () => { await held; return jsonResponse(204, null) },
    ])
    const client = makeClient(fetchImpl)

    const a = client.getAd('slot-a')
    const b = client.getAd('slot-a')
    release()

    expect(await a).toBeNull()
    expect(await b).toBeNull()
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('forgets a delivery once it has succeeded', async () => {
    let clock = 0
    const fetchImpl = stubFetch([
      jsonResponse(200, servedAd('r1')),
      jsonResponse(200, servedAd('r2')),
    ])
    const client = makeClient(fetchImpl, { now: () => clock })

    expect((await client.getAd('slot-a')).requestId).toBe('r1')

    /* Let the placement cache lapse so the next call has to go to the wire.
       If the settled entry were still held, it would answer from the stale
       delivery instead of making a request. */
    clock = CACHE_TTL_MS + 1

    expect((await client.getAd('slot-a')).requestId).toBe('r2')
    expect(fetchImpl.calls).toHaveLength(2)
  })

  it('forgets a failed delivery so a later call can try again', async () => {
    const fetchImpl = stubFetch([
      jsonResponse(500, { error: { code: 'BOOM', message: 'nope' } }),
      jsonResponse(500, { error: { code: 'BOOM', message: 'nope' } }),
      jsonResponse(500, { error: { code: 'BOOM', message: 'nope' } }),
      jsonResponse(200, servedAd('r2')),
    ])
    const client = makeClient(fetchImpl)

    /* One delivery, one retry budget: the initial attempt plus two retries. */
    await expect(client.getAd('slot-a')).rejects.toBeInstanceOf(CLIRevenueHttpError)
    expect(fetchImpl.calls).toHaveLength(3)

    /* A failure must not be cached, and must not be left in flight. */
    const served = await client.getAd('slot-a')
    expect(served.requestId).toBe('r2')
    expect(fetchImpl.calls).toHaveLength(4)
  })

  it('rejects every concurrent caller when a shared delivery fails', async () => {
    let release
    const held = new Promise((resolve) => { release = resolve })
    const fetchImpl = stubFetch([
      async () => {
        await held
        return jsonResponse(400, { error: { code: 'INVALID_PLACEMENT', message: 'no' } })
      },
    ])
    const client = makeClient(fetchImpl)

    const a = client.getAd('slot-a')
    const b = client.getAd('slot-a')
    release()

    await expect(a).rejects.toBeInstanceOf(CLIRevenueHttpError)
    await expect(b).rejects.toBeInstanceOf(CLIRevenueHttpError)
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('never shares a delivery between different placements', async () => {
    const fetchImpl = stubFetch([
      jsonResponse(200, servedAd('r1')),
      jsonResponse(200, servedAd('r2')),
    ])
    const client = makeClient(fetchImpl)

    const [a, b] = await Promise.all([client.getAd('slot-a'), client.getAd('slot-b')])

    expect(fetchImpl.calls).toHaveLength(2)
    expect(a.requestId).toBe('r1')
    expect(b.requestId).toBe('r2')
  })

  it('leaves the 60 second placement cache unchanged', async () => {
    let clock = 0
    const fetchImpl = stubFetch([jsonResponse(200, servedAd('r1'))])
    const client = makeClient(fetchImpl, { now: () => clock })

    const first = await client.getAd('slot-a')
    const second = await client.getAd('slot-a')
    expect(fetchImpl.calls).toHaveLength(1)
    expect(second).toBe(first)

    clock = CACHE_TTL_MS - 1
    await client.getAd('slot-a')
    expect(fetchImpl.calls).toHaveLength(1)

    clock = CACHE_TTL_MS
    await client.getAd('slot-a')
    expect(fetchImpl.calls).toHaveLength(2)
  })

it('still validates the placement key before sharing anything', async () => {
      const fetchImpl = stubFetch([jsonResponse(200, servedAd('r1'))])
      const client = makeClient(fetchImpl)
      await expect(client.getAd('')).rejects.toBeInstanceOf(CLIRevenueConfigError)
      await expect(client.getAd(null)).rejects.toBeInstanceOf(CLIRevenueConfigError)
      expect(fetchImpl.calls).toHaveLength(0)
    })
  })

/* ------------------------------------------------------------------ */
/* telemetry                                                           */
/* ------------------------------------------------------------------ */

describe('telemetry', () => {
  it('emits session_started and page_viewed on first getAd', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await client.getAd('placement-1')

    const telemetry = fetchImpl.telemetryCalls.map((c) => JSON.parse(c.init.body).eventType)
    // session_started and page_viewed are sent in sequence
    expect(telemetry).toContain('session_started')
    expect(telemetry).toContain('page_viewed')
    // session_started should only be sent once
    expect(telemetry.filter((t) => t === 'session_started')).toHaveLength(1)
  })

  it('emits ad_rendered after render()', async () => {
    const fetchImpl = stubFetch([
      jsonResponse(200, servedAd()),
      jsonResponse(200, { status: 'recorded' }),
    ])
    const client = makeClient(fetchImpl)

    // Minimal DOM stub for render
    const anchor = { href: '', textContent: '', setAttribute: () => {}, addEventListener: () => {}, style: {} }
    const host = {
      appendChild: () => {},
      style: { position: '' },
      clientWidth: 800,
      clientHeight: 600,
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    }
    vi.stubGlobal('document', {
      referrer: '',
      querySelector: () => host,
      createElement: () => anchor,
    })
    vi.stubGlobal('getComputedStyle', () => ({ position: 'static' }))
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })

    await client.render('placement-1', '#ad-slot')

    const telemetry = fetchImpl.telemetryCalls.map((c) => JSON.parse(c.init.body).eventType)
    expect(telemetry).toContain('session_started')
    expect(telemetry).toContain('page_viewed')
    expect(telemetry).toContain('ad_rendered')
  })

  it('includes requestId and impressionToken in ad_rendered', async () => {
    const fetchImpl = stubFetch([
      jsonResponse(200, servedAd('req-render-1')),
      jsonResponse(200, { status: 'recorded' }),
    ])
    const client = makeClient(fetchImpl)

    const anchor = { href: '', textContent: '', setAttribute: () => {}, addEventListener: () => {}, style: {} }
    const host = {
      appendChild: () => {},
      style: { position: '' },
      clientWidth: 800,
      clientHeight: 600,
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    }
    vi.stubGlobal('document', {
      referrer: '',
      querySelector: () => host,
      createElement: () => anchor,
    })
    vi.stubGlobal('getComputedStyle', () => ({ position: 'static' }))
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })

    const result = await client.render('placement-1', '#ad-slot')

    const adRenderedCall = fetchImpl.telemetryCalls.find(
      (c) => JSON.parse(c.init.body).eventType === 'ad_rendered'
    )
    expect(adRenderedCall).toBeDefined()
    const body = JSON.parse(adRenderedCall!.init.body)
    expect(body.requestId).toBe('req-render-1')
    expect(body.impressionToken).toBe('tok-1')
    expect(body.placementKey).toBe('placement-1')
    expect(body.occurredAt).toBeDefined()
  })

  it('includes sessionId in all telemetry events', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await client.getAd('placement-1')

    for (const call of fetchImpl.telemetryCalls) {
      const body = JSON.parse(call.init.body)
      expect(body.sessionId).toBeDefined()
      expect(typeof body.sessionId).toBe('string')
      expect(body.sessionId.length).toBeGreaterThan(0)
    }
  })

  it('uses unique idempotencyKey per telemetry event', async () => {
    const fetchImpl = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(fetchImpl)
    await client.getAd('placement-1')

    const keys = fetchImpl.telemetryCalls.map((c) => JSON.parse(c.init.body).idempotencyKey)
    // session_started and page_viewed should have different keys
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('queues telemetry on 5xx and retries on flush', async () => {
    const storage = memoryStorage()
    // First, succeed at delivery so telemetry session starts
    const deliveryFetch = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(deliveryFetch, { storage })
    await client.getAd('placement-1')

    // Now simulate telemetry failing with 5xx
    // We need to create a new client with failing telemetry but same storage
    const failingTelemetryFetch = async (url, init = {}) => {
      if (String(url).includes('/telemetry')) {
        return { status: 500, json: async () => ({ error: { message: 'boom' } }), text: async () => '{}' }
      }
      return jsonResponse(200, servedAd())
    }
    const client2 = makeClient(failingTelemetryFetch, { maxRetries: 0, storage })
    await client2.getAd('placement-2') // This will trigger telemetry again for new placement

    // Telemetry should be queued
    expect(client2.pendingEvents).toBeGreaterThan(0)

    // Now flush with a working endpoint
    const recoveredFetch = stubFetch([jsonResponse(200, { success: true })])
    const recoveredClient = makeClient(recoveredFetch, { storage })
    await expect(recoveredClient.flush()).resolves.toMatchObject({ sent: 2, failed: 0 }) // session_started + page_viewed
  })

  it('does not queue telemetry on 4xx', async () => {
    const storage = memoryStorage()
    // First, succeed at delivery
    const deliveryFetch = stubFetch([jsonResponse(200, servedAd())])
    const client = makeClient(deliveryFetch, { storage })
    await client.getAd('placement-1')

    // Now simulate telemetry failing with 4xx
    const failingTelemetryFetch = async (url, init = {}) => {
      if (String(url).includes('/telemetry')) {
        return { status: 400, json: async () => ({ error: { message: 'bad' } }), text: async () => '{}' }
      }
      return jsonResponse(200, servedAd())
    }
    const client2 = makeClient(failingTelemetryFetch, { maxRetries: 0, storage })
    await client2.getAd('placement-2')

    // 4xx should not be queued
    expect(client2.pendingEvents).toBe(0)
  })

  it('TelemetryEventName type is exported', () => {
    // This test ensures the type is exported from the public API
    // It compiles if the type exists, fails if not
    type TestTelemetryEventName = import('../src/index.ts').TelemetryEventName
    const _event: TestTelemetryEventName = 'session_started'
    const _event2: TestTelemetryEventName = 'page_viewed'
    const _event3: TestTelemetryEventName = 'ad_rendered'
    // @ts-expect-error - invalid event type should not compile
    const _invalid: TestTelemetryEventName = 'invalid_event'
    expect(true).toBe(true)
  })
})
