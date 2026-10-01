/**
 * Static security invariants over the shipped frontend and the delivery edge
 * function.
 *
 * These are source-level checks, not behavioural ones, and are labelled as
 * such: they catch the specific regressions below reappearing, and they are
 * cheap enough to run on every commit. They do not replace the database and
 * request-level suites, which are the ones that actually prove behaviour.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')
const FUNCTIONS = join(ROOT, 'supabase/functions')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(js|jsx|ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const srcFiles = walk(SRC)
const functionFiles = walk(FUNCTIONS)

describe('service role key never reaches the browser', () => {
  it('no frontend file references the service role key or its env var', () => {
    // Rule: SUPABASE_SERVICE_ROLE_KEY must never be used in browser code.
    // Vite inlines any VITE_-prefixed variable into the client bundle, so a
    // single reference here would publish a key that bypasses RLS.
    const offenders = srcFiles.filter((f) => {
      const src = readFileSync(f, 'utf8')
      return /SERVICE_ROLE|service_role|serviceRoleKey/.test(src)
    })
    expect(offenders.map((f) => f.replace(ROOT, ''))).toEqual([])
  })

  it('the frontend reads only allow-listed VITE_ variables', () => {
    // Vite inlines every VITE_-prefixed variable into the client bundle, so
    // this is an allow-list rather than a block-list: anything new has to be
    // added here deliberately. The Supabase anon key is deliberately public
    // and is the only key the browser is ever meant to hold.
    const ALLOWED = new Set([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_API_BASE_URL',
      // The SDK's publishable publisher key. Same category as the anon key:
      // it identifies a publisher for delivery/attribution and is meant to
      // be readable by the browser. It is not a credential — it authorises
      // no administrative action, and it cannot issue or revoke keys.
      'VITE_CLIREVENUE_PUBLISHABLE_KEY',
    ])
    const used = new Set()
    for (const f of srcFiles) {
      for (const m of readFileSync(f, 'utf8').matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
        used.add(m[1])
      }
    }
    expect([...used].filter((v) => !ALLOWED.has(v))).toEqual([])
  })

  it('any client constructed in the frontend uses the anon key, never an admin key', () => {
    // A createClient call is legitimate in the browser with the publishable
    // anon key; it is only dangerous if something else is passed to it.
    const offenders = srcFiles.filter((f) => {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/createClient\(([^)]*)\)/g)) {
        if (/SERVICE_ROLE|service_role|ADMIN/i.test(m[1])) return true
      }
      return false
    })
    expect(offenders.map((f) => f.replace(ROOT, ''))).toEqual([])
  })
})

describe('public delivery response carries no private accounting', () => {
  const delivery = readFileSync(join(FUNCTIONS, 'get_active_campaign/index.ts'), 'utf8')

  it('the delivery payload does not serialise budget, spend or counters', () => {
    // The JSON body the delivery handler returns is extracted here and
    // checked, because leaking these would let any publisher infer another
    // advertiser's spend and pacing.
    const body = delivery.slice(delivery.indexOf('const body = JSON.stringify('))
    expect(body).not.toMatch(/budget_cents/)
    expect(body).not.toMatch(/spend_milli_cents/)
    expect(body).not.toMatch(/impressions_count/)
    expect(body).not.toMatch(/clicks_count/)
    expect(body).not.toMatch(/conversions_count/)
    expect(body).not.toMatch(/advertiser_id/)
  })

  it('delivery is not cached', () => {
    // A fill decision is per-request; a cached ad would be served repeatedly
    // and desynchronise delivery from impression accounting.
    expect(delivery).toMatch(/Cache-Control.*no-store/)
  })

  it('reads accounting columns for eligibility but returns them nowhere', () => {
    // The handler legitimately SELECTs budget_cents and spend_milli_cents:
    // eligibility is decided by comparing them, and it cannot be decided
    // without reading them. The property that matters is that they are read
    // and not serialized, which the response-body assertion above enforces.
    // This test exists to stop someone "simplifying" the select list into
    // something that leaks, by pinning the intent rather than forbidding it.
    const select = delivery.slice(
      delivery.indexOf('.select('),
      delivery.indexOf('.eq("status"'),
    )
    expect(select).toMatch(/spend_milli_cents/)
    expect(select).toMatch(/budget_cents/)

    const body = delivery.slice(delivery.indexOf('const body = JSON.stringify('))
    expect(body).not.toMatch(/spend_milli_cents/)
    expect(body).not.toMatch(/budget_cents/)
  })
})

describe('error responses do not leak internals', () => {
  it('no edge function returns a raw caught error to the client', () => {
    const offenders = functionFiles.filter((f) => {
      const src = readFileSync(f, 'utf8')
      // Returning err.message / String(err) inside a response body leaks SQL
      // and internal detail. console.error is the correct sink.
      return /json\([^)]*err\.message/.test(src) || /message:\s*String\(err\)/.test(src)
    })
    expect(offenders.map((f) => f.replace(ROOT, ''))).toEqual([])
  })

  it('edge functions log caught errors server-side', () => {
    const offenders = functionFiles.filter(
      (f) => /catch\s*\(err\)/.test(readFileSync(f, 'utf8')),
    )
    for (const f of offenders) {
      const src = readFileSync(f, 'utf8')
      if (/json\(|apiError\(/.test(src)) {
        expect(src, `${f.replace(ROOT, '')} catches without logging`).toMatch(/console\.error/)
      }
    }
  })
})
