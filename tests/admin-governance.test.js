/**
 * The four governance surfaces: accounts, moderation, health/audit, operations.
 *
 * These screens exist because the Stitch designs promised more than the
 * backend can deliver. The risk this suite guards is not "the page renders"
 * but "the page quietly invents something". So the assertions are mostly
 * negative ones: that the fake design content never appears, that every
 * unavailable capability is labelled unavailable, that the one real write
 * lever is authorized server-side, and that nothing weakens RLS.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const FN = 'supabase/functions/admin/index.ts'
const API = 'src/lib/adminApi.js'
const PAGES = {
  accounts: 'src/components/admin/AdminAccounts.jsx',
  moderation: 'src/components/admin/AdminModeration.jsx',
  health: 'src/components/admin/AdminHealth.jsx',
  operations: 'src/components/admin/AdminOperations.jsx',
}
const MIGRATION = 'supabase/migrations/000024_admin_governance_audit.sql'

const fn = () => read(FN)
const api = () => read(API)

// Comments are stripped before scanning: the sources carry long explanatory
// comments that legitimately quote the mockup in order to forbid it, and a
// comment cannot become a rendered value.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*(\/\/|#|--).*$/gm, ' ')

// Slice a helper by its opening `async function` to the next one, so a
// refactor that moves it does not silently turn the assertions vacuous.
const sliceFn = (name) => {
  const src = fn()
  const start = src.indexOf(`async function ${name}`)
  expect(start, `missing async function ${name}`).toBeGreaterThan(-1)
  const end = src.indexOf('\nasync function', start + 10)
  return src.slice(start, end === -1 ? src.length : end)
}
const gateFn = () => sliceFn('updateAdvertiserGate')

// ---------- the fake design content must not survive -------------------

describe('no fabricated data from the design archive', () => {
  // Every string below appears verbatim in the Stitch exports as an asserted
  // value. Shipping one into a rendered path would mean shipping the
  // mockup's fiction as data. Vocabulary that only ever appears inside a
  // denial ("no Merkle tree exists") is checked separately below, because
  // naming an absent subsystem is the opposite of fabricating it.
  const FICTIONS = [
    '1,428', 'ENTITIES INDEXED', 'Neon Systems', 'KYC Tier 2',
    'NODES CONVERGED', '99.98', 'INC-4091', 'SCRUB_ACTIVE', 'WS://LIVE',
    '0x8F92', 'sha256:e3b0c4', 'Decision processed successfully',
    'Broadcast: OK', 'PII Leak Engine', 'ANSI Sanitizer',
  ]

  it('the admin Edge Function asserts none of the mockup fiction', () => {
    const src = stripComments(fn())
    expect(FICTIONS.filter((t) => src.includes(t))).toEqual([])
  })

  it('no admin page component asserts the mockup fiction', () => {
    const found = []
    for (const file of Object.values(PAGES)) {
      const src = stripComments(read(file))
      for (const t of FICTIONS) if (src.includes(t)) found.push(`${file}: ${t}`)
    }
    expect(found).toEqual([])
  })

  it('Merkle and KYC are named only to declare them absent', () => {
    // The words may appear, but never as an asserted value. Two legitimate
    // contexts: a denial sentence, and a capability-ledger row label — that
    // row renders as "Not supported" because the capability is false.
    const DENIAL = /\bno\b|\bnone\b|\bnothing\b|\bnot\b|never|absent|unsupported|exists?\b/i
    const sources = { [FN]: fn(), ...Object.fromEntries(
      Object.values(PAGES).map((path) => [path, read(path)])
    ) }
    for (const [file, raw] of Object.entries(sources)) {
      let inLabels = false
      for (const [i, line] of stripComments(raw).split('\n').entries()) {
        if (/labels=\{\{/.test(line)) inLabels = true
        else if (inLabels && /^\s*\}\}/.test(line)) inLabels = false
        if (!/\bKYC\b|\bMerkle\b/i.test(line)) continue
        expect(
          DENIAL.test(line) || inLabels,
          `${file}:${i + 1} names KYC/Merkle as a value: ${line.trim()}`
        ).toBe(true)
      }
    }
  })

  it('no page presents an uptime percentage or a node count as data', () => {
    for (const file of Object.values(PAGES)) {
      const src = stripComments(read(file))
      expect(src, file).not.toMatch(/\d+(\.\d+)?\s*%\s*uptime|uptime[^"\n]{0,12}%/i)
    }
  })
})

// ---------- every endpoint sits behind the existing admin check --------

describe('new routes inherit requireAdmin', () => {
  it('the gate route derives the actor from the verified JWT, not the body', () => {
    const src = fn()
    const gate = src.slice(src.indexOf('case "accounts"'))
    expect(gate).toMatch(/profileId:\s*user\.id/)
    expect(gate).toMatch(/email:\s*user\.email/)
    // The body is parsed, but it must never be able to name the actor.
    expect(gate).not.toMatch(/actor\s*:\s*parsed/)
    expect(gate).not.toMatch(/profileId:\s*parsed/)
    expect(gate).not.toMatch(/email:\s*parsed/)
  })

  it('updateAdvertiserGate never reads an actor field out of the request body', () => {
    const body = gateFn()
    expect(body).not.toMatch(/body\.actor/)
    expect(body).not.toMatch(/body\.actor_email/)
    // The actor argument is threaded through untouched from the verified JWT.
    expect(body).toMatch(/async function updateAdvertiserGate\([\s\S]*?actor: Actor\)/)
    expect(body).toMatch(/recordGovernanceAction\(\s*actor,/)
  })

  it('the gate write is the only mutating route added, and it is PATCH-only', () => {
    const src = fn()
    const accounts = src.slice(
      src.indexOf('case "accounts"'),
      src.indexOf('case "moderation"')
    )
    expect(accounts).toMatch(/if \(sub === "gate"\)/)
    expect(accounts).toMatch(/req\.method !== "PATCH"/)
    // POST/PUT/DELETE must not reach the gate handler.
    expect(accounts).not.toMatch(/req\.method === "POST"/)
    expect(accounts).not.toMatch(/req\.method === "DELETE"/)
  })

  it('the new read routes are GET-only', () => {
    const src = fn()
    for (const seg of ['moderation', 'health', 'audit', 'operations']) {
      const start = src.indexOf(`case "${seg}"`)
      expect(start, `missing case ${seg}`).toBeGreaterThan(-1)
      const block = src.slice(start, start + 320)
      expect(block, seg).toMatch(/req\.method !== "GET"/)
    }
  })

  it('an unknown sub-path under /accounts is a 404, not a silent success', () => {
    const src = fn()
    const accounts = src.slice(
      src.indexOf('case "accounts"'),
      src.indexOf('case "moderation"')
    )
    expect(accounts).toMatch(/apiError\("NOT_FOUND", "Not found\.", 404\)/)
  })
})

// ---------- the one real write lever is validated server-side -----------

describe('advertiser serving gate validation', () => {
  const body = () => gateFn()

  it('requires a real boolean, not a truthy value', () => {
    expect(body()).toMatch(/typeof canRunCampaigns !== "boolean"/)
  })

  it('requires a written reason, and bounds its length', () => {
    expect(body()).toMatch(/REASON_REQUIRED/)
    expect(body()).toMatch(/REASON_TOO_LONG/)
    expect(body()).toMatch(/GOVERNANCE_REASON_MAX/)
  })

  it('rejects a non-uuid advertiser id', () => {
    expect(body()).toMatch(/INVALID_ID/)
  })

  it('records the value held before the write, not the value written', () => {
    // The gate audit is only useful if it shows the transition, so the
    // previous value must be read before the update and passed through.
    const readAt = body().indexOf('.from("advertisers")')
    const writeAt = body().indexOf('.update({ can_run_campaigns')
    expect(readAt).toBeGreaterThan(-1)
    expect(writeAt).toBeGreaterThan(readAt)
    const call = body().slice(body().indexOf('recordGovernanceAction('))
    expect(call).toMatch(/String\(before\.can_run_campaigns\)/)
    expect(call).toMatch(/String\(canRunCampaigns\)/)
  })

  it('no-ops without writing when the gate already holds that value', () => {
    expect(body()).toMatch(/changed: false/)
    const guard = body().indexOf('if (before.can_run_campaigns === canRunCampaigns)')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(body().indexOf('.update({ can_run_campaigns'))
  })
})

// ---------- governance audit table is locked down ----------------------

describe('migration 000024 governance audit table', () => {
  it('exists and enables RLS', () => {
    const src = read(MIGRATION)
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_governance_actions/)
    expect(src).toMatch(/ENABLE ROW LEVEL SECURITY/)
  })

  it('is invisible to anon, authenticated and PUBLIC', () => {
    const src = read(MIGRATION)
    expect(src).toMatch(/REVOKE ALL ON public\.admin_governance_actions FROM PUBLIC;/)
    expect(src).toMatch(/REVOKE ALL ON public\.admin_governance_actions FROM anon, authenticated;/)
    expect(src).not.toMatch(/GRANT[^;]*TO anon/)
    expect(src).not.toMatch(/GRANT[^;]*TO authenticated/)
  })

  it('grants service_role only SELECT and INSERT — no UPDATE, no DELETE', () => {
    const src = read(MIGRATION)
    expect(src).toMatch(/GRANT SELECT, INSERT ON public\.admin_governance_actions TO service_role/)
    expect(src).not.toMatch(/GRANT[^;]*UPDATE[^;]*admin_governance_actions/)
    expect(src).not.toMatch(/GRANT[^;]*DELETE[^;]*admin_governance_actions/)
  })

  it('defines zero RLS policies, so no client role can read it', () => {
    const src = read(MIGRATION)
    expect(src).not.toMatch(/CREATE POLICY/i)
  })

  it('constrains the action verb and the reason length in the schema', () => {
    const src = read(MIGRATION)
    expect(src).toMatch(/SERVING_GATE_ENABLED/)
    expect(src).toMatch(/SERVING_GATE_DISABLED/)
    expect(src).toMatch(/char_length\(reason\) BETWEEN 3 AND 500/)
  })

  // The rollback note names DROP TABLE in prose. What matters is that no
  // executable statement removes anything, and that nothing outside this
  // migration's own table is altered.
  const sql = () => read(MIGRATION).replace(/--.*$/gm, '')

  it('is additive — no destructive executable statements', () => {
    const s = sql().toUpperCase()
    expect(s).not.toMatch(/\bDROP\s+TABLE\b/)
    expect(s).not.toMatch(/\bTRUNCATE\b/)
    expect(s).not.toMatch(/\bDELETE\s+FROM\b/)
    expect(s).not.toMatch(/\bALTER\s+COLUMN\b/)
    expect(s).not.toMatch(/\bDROP\s+(POLICY|COLUMN|CONSTRAINT)\b/)
  })

  it('alters no table other than the one it creates', () => {
    const altered = [...sql().matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi)]
      .map((m) => m[1].replace(/"/g, ''))
    expect(altered.length).toBeGreaterThan(0)
    expect([...new Set(altered)]).toEqual(['public.admin_governance_actions'])
  })
})

// ---------- moderation reports real blocker codes ---------------------

describe('moderation queue uses the database as its authority', () => {
  it('asks the campaign_activation_blockers RPC rather than re-deriving rules', () => {
    const src = fn()
    expect(src).toMatch(/admin\.rpc\(\s*"campaign_activation_blockers"/)
  })

  it('surfaces blocker human text from campaignRules, not invented strings', () => {
    const src = fn()
    expect(src).toMatch(/ACTIVATION_BLOCKER_MESSAGES/)
    expect(src).toMatch(/from "\.\.\/_shared\/campaignRules\.ts"/)
  })

  it('never returns the stored object key to the browser', () => {
    // The moderation list reads object_key only to report whether it exists.
    const src = fn()
    const queue = src.slice(
      src.indexOf('async function moderationQueue'),
      src.indexOf('function timedProbe')
    )
    expect(queue).toMatch(/objectKeyPresent/)
    expect(queue).not.toMatch(/object_key:\s*creative\.object_key/)
    expect(queue).not.toMatch(/objectKey:\s*/)
  })

  it('distinguishes "no blockers found" from "could not ask"', () => {
    const src = fn()
    expect(src).toMatch(/blockersAvailable/)
    expect(src).toMatch(/blockerLookupError/)
  })

  it('never returns telemetry metadata', () => {
    const src = fn()
    const audit = src.slice(
      src.indexOf('async function auditTrail'),
      src.indexOf('async function operationsOverview')
    )
    expect(audit).not.toMatch(/\bmetadata\b\s*[,:]/)
  })
})

// ---------- health does not dress up hardcoded truth ------------------

describe('health signals are measured or labelled unmeasured', () => {
  const body = () => {
    const src = fn()
    return src.slice(
      src.indexOf('async function healthSignals'),
      src.indexOf('async function auditTrail')
    )
  }

  it('probes the database instead of asserting ok: true', () => {
    expect(body()).toMatch(/timedProbe/)
    expect(body()).toMatch(/from\("profiles"\)/)
  })

  it('gives every unmeasured signal ok: null, never a passing value', () => {
    // The regression this guards: systemStatus() ships edgeFunctions.ok = true
    // and provisioning.ok = true as constants. healthSignals must not repeat it.
    expect(body()).toMatch(/kind:\s*"unverified"/)
    const unverified = body().slice(body().indexOf('kind: "unverified"'))
    expect(unverified).not.toMatch(/ok:\s*true/)
  })

  it('publishes a capability ledger naming every design feature it cannot do', () => {
    const src = body()
    for (const key of [
      'merkleProof', 'nodeMesh', 'regionalLatency',
      'droppedPackets', 'piiScrubbing', 'liveStream', 'signatures',
    ]) {
      expect(src, key).toMatch(new RegExp(`${key}:\\s*\\{\\s*supported:\\s*false`))
    }
  })
})

// ---------- operations cards are sourced or unavailable ---------------

describe('operations overview', () => {
  const body = () => {
    const src = fn()
    return src.slice(
      src.indexOf('async function operationsOverview'),
      src.indexOf('async function systemStatus')
    )
  }

  it('marks the un-instrumented design cards unavailable with a null value', () => {
    const src = body()
    for (const key of ['edgeUptime', 'regionMesh', 'settlementSync', 'openIncidents', 'slaBreaches']) {
      expect(src, key).toMatch(new RegExp(`key:\\s*"${key}"[\\s\\S]{0,220}available:\\s*false`))
      expect(src, key).toMatch(new RegExp(`key:\\s*"${key}"[\\s\\S]{0,220}value:\\s*null`))
    }
  })

  it('names a source table for every card it does report', () => {
    expect(body()).toMatch(/scope:\s*"total"/)
    expect(body()).toMatch(/scope:\s*"window"/)
  })

  it('declares that no operator actions are wired', () => {
    const src = body()
    expect(src).toMatch(/actions:\s*\{\s*supported:\s*false/)
    expect(src).toMatch(/batchOperations:\s*\{\s*supported:\s*false/)
  })
})

// ---------- frontend: no fallback, no secrets, honest empty states -----

describe('adminApi additions', () => {
  it('exports a fetcher for every new endpoint', () => {
    const src = api()
    for (const name of [
      'fetchAdminAccounts', 'fetchAdminModeration',
      'fetchAdminHealth', 'fetchAdminAudit', 'fetchAdminOperations',
    ]) {
      expect(src, name).toMatch(new RegExp(`export (async )?function ${name}\\b`))
    }
  })

  it('has no catch block that substitutes data for a failed request', () => {
    // A mock fallback here would be indistinguishable from a real answer.
    const src = api()
    expect(src).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*return\s*(\[\]|\{|mock|fallback|default)/)
    expect(src).not.toMatch(/MOCK_|mockData|fallbackData/)
  })

  it('sends only the three validated fields on a gate write', () => {
    const src = api()
    const fnBody = src.slice(src.indexOf('export async function updateAdvertiserGate'))
    expect(fnBody).toMatch(/advertiser_id/)
    expect(fnBody).toMatch(/can_run_campaigns/)
    expect(fnBody).toMatch(/reason/)
    // No way for the browser to assert who it is.
    expect(fnBody).not.toMatch(/actor/)
    expect(fnBody).not.toMatch(/email/)
    expect(fnBody).not.toMatch(/is_admin|isAdmin/)
  })

  it('references no service-role or secret material', () => {
    const src = api()
    expect(src).not.toMatch(/SERVICE_ROLE|service_role|anon.*key.*ey/i)
  })
})

describe('admin pages are wired and stateful', () => {
  const console = () => read('src/components/admin/AdminConsole.jsx')

  it('registers all four pages with distinct nav entries', () => {
    const src = console()
    for (const key of ['accounts', 'moderation', 'health', 'operations']) {
      expect(src, key).toMatch(new RegExp(`\\b${key}:`))
      expect(src, key).toMatch(new RegExp(`Admin${key[0].toUpperCase()}${key.slice(1)}`))
    }
  })

  it('imports each page component it maps', () => {
    const src = console()
    for (const f of ['AdminAccounts', 'AdminModeration', 'AdminHealth', 'AdminOperations']) {
      expect(src, f).toMatch(new RegExp(`import\\s+${f}\\s+from\\s+'\\./${f}\\.jsx'`))
    }
  })

  it('gives each page a loading, error and empty branch', () => {
    for (const [key, file] of Object.entries(PAGES)) {
      const src = read(file)
      expect(src, key).toMatch(/if \(loading\)/)
      expect(src, key).toMatch(/if \(error\)/)
      expect(src, key).toMatch(/EmptyState|adm-empty/)
    }
  })

  it('keeps the 403 message honest rather than generic', () => {
    const src = read('src/components/admin/AdminGovernanceUi.jsx')
    expect(src).toMatch(/403/)
    expect(src).toMatch(/Access denied\. Admin role required\./)
  })

  it('explains a missing endpoint instead of rendering an empty shell', () => {
    const src = read('src/components/admin/AdminGovernanceUi.jsx')
    expect(src).toMatch(/404/)
    expect(src).toMatch(/not deployed/i)
  })

  it('renders a capability ledger, not a silent omission', () => {
    const src = read('src/components/admin/AdminGovernanceUi.jsx')
    expect(src).toMatch(/Supported/)
    expect(src).toMatch(/Not supported/)
    expect(src).toMatch(/CapabilityLedger/)
    for (const file of Object.values(PAGES)) {
      expect(read(file), file).toMatch(/CapabilityLedger/)
    }
  })
})

describe('the serving gate is confirmed before it is closed', () => {
  const src = () => read(PAGES.accounts)

  it('requires a written reason of at least 3 characters', () => {
    expect(src()).toMatch(/reason\.trim\(\)\.length < 3/)
  })

  it('requires a second, explicit confirmation to close the gate', () => {
    expect(src()).toMatch(/confirming/)
    expect(src()).toMatch(/adm-gate__confirm/)
  })

  it('does not reuse window.confirm, which cannot state the consequence', () => {
    expect(src()).not.toMatch(/window\.confirm|(?<![.\w])confirm\(/)
  })

  it('reports the server answer and re-reads after a write', () => {
    expect(src()).toMatch(/updateAdvertiserGate/)
    expect(src()).toMatch(/await load\(\)/)
  })
})
