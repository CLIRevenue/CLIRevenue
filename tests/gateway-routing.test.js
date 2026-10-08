/* =============================================================
   Production routing contract for the ad SDK
   -------------------------------------------------------------
   Two production smoke-test defects are pinned here, both of which
   looked like gateway faults and were not.

   1. Telemetry CORS failure. The SDK was addressed at the internal
      backend instead of the public gateway, because src/lib/clirevenue.js
      reused VITE_API_BASE_URL as the gateway base. A preflight to a
      function that was never deployed answers 404, and Chrome reports
      that as "Response to preflight request doesn't pass access control
      check" -- which points at CORS and away from the real cause.

   2. Delivery 500. A migration/function deploy-order defect: the ads
      function writes ad_serve_log.telemetry_session_id, which migration
      000021 creates. Deploying the function before the migration makes
      the insert fail, and handleDeliver turns any insert failure into
      500 INTERNAL_ERROR.

   The second one is the more interesting test, so it reads the migrations
   and the function together. Nothing can tell you from inside the Edge
   Function that a column it writes does not exist in the database it is
   talking to; only a contract between the two source trees can.
   ============================================================= */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const boundary = readFileSync(join(ROOT, 'src/lib/clirevenue.js'), 'utf8')
const adsFn = readFileSync(join(ROOT, 'supabase/functions/ads/index.ts'), 'utf8')
const sdk = readFileSync(join(ROOT, 'packages/sdk/src/index.ts'), 'utf8')

const MIGRATIONS = join(ROOT, 'supabase/migrations')
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
const migrations = migrationFiles.map((f) => ({ name: f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }))

describe('the SDK is addressed at the public gateway', () => {
  it('reads a gateway-specific variable, not the internal backend base', () => {
    // The defect, stated as an assertion: this line is what made production
    // browser traffic bypass api.clirevenue.in.
    expect(boundary).not.toMatch(/readEnv\(\s*['"]VITE_API_BASE_URL['"]\s*\)/)
    expect(boundary).toContain("readEnv('VITE_AD_GATEWAY_URL')")
  })

  it('falls back to the SDK default when no gateway is configured', () => {
    // A production build that sets neither variable must still address the
    // published gateway. Silently resolving to undefined would send every
    // request to the current origin.
    expect(boundary).toMatch(/baseUrl\s*=\s*\(rawGateway\s*\|\|\s*DEFAULT_BASE_URL\)/)
  })

  it('has the SDK default pointing at the published gateway', () => {
    expect(sdk).toContain('export const DEFAULT_BASE_URL = "https://api.clirevenue.in"')
  })

  it('posts telemetry to the same base as the ad pipeline', () => {
    // One base for the whole SDK. If telemetry grew its own host it would
    // drift from delivery again, which is the whole class of fault here.
    const urls = [...sdk.matchAll(/\$\{this\.baseUrl\}(\/[\w/-]+)/g)].map((m) => m[1])
    expect(urls).toContain('/telemetry')
    expect(urls).toContain('/ads/deliver')
    expect(urls).toContain('/ads/impression')
    expect(urls).toContain('/ads/click')
    expect(urls).toContain('/ads/conversion')

    // And no SDK endpoint is addressed against a literal host, which is how a
    // second base gets introduced in the first place.
    const literals = [...sdk.matchAll(/url:\s*`https?:\/\/[^`]+/g)].map((m) => m[0])
    expect(literals, 'a hardcoded host in the SDK').toEqual([])
  })

  it('keeps the internal backend on its own variable', () => {
    // The two bases must stay distinct. Sharing them was the root cause.
    const internal = readFileSync(join(ROOT, 'src/lib/accountApi.js'), 'utf8')
    expect(internal).toContain('VITE_API_BASE_URL')
  })
})

describe('an Edge Function never writes a column a migration has not created', () => {
  /**
   * Every column name the ads function's ad_serve_log insert passes.
   *
   * Parsed from the insert itself rather than restated here, so adding a
   * column to the function automatically brings it under the contract.
   */
  function serveInsertColumns() {
    const start = adsFn.indexOf('.from("ad_serve_log")')
    expect(start, 'the ad_serve_log insert was not found').toBeGreaterThan(-1)
    const insert = adsFn.slice(start, adsFn.indexOf('.select("id")'))
    return [...insert.matchAll(/^\s{6}([a-z_]+):/gm)].map((m) => m[1])
  }

  /**
   * Columns the migrations create on a given table.
   *
   * Reads both shapes a migration can use: the CREATE TABLE body and any
   * later `ALTER TABLE ... ADD COLUMN`. Whitespace is normalised first so a
   * statement broken across lines is still matched, and every ADD COLUMN in a
   * migration is considered, because 000021 adds two of them to one table in
   * separate statements.
   */
  function declaredColumns(table) {
    const declared = new Set()
    for (const { sql } of migrations) {
      const flat = sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ')

      // The body is taken from the raw sql, not the flattened copy, because it
      // is terminated by a line-anchored `);` and contains nested parentheses
      // in its REFERENCES and CHECK clauses.
      const create = sql.match(
        new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? (?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`),
      )
      if (create) {
        for (const line of create[1].split('\n')) {
          const col = line.match(/^\s*([a-z_]+)\s+[A-Z]/)
          if (col) declared.add(col[1])
        }
      }

      for (const m of flat.matchAll(
        new RegExp(`ALTER TABLE (?:public\\.)?${table} [^;]*?ADD COLUMN(?: IF NOT EXISTS)? ([a-z_]+)`, 'g'),
      )) {
        declared.add(m[1])
      }
    }
    return declared
  }

  it('finds the columns the delivery insert writes', () => {
    const columns = serveInsertColumns()
    expect(columns).toContain('request_id')
    expect(columns.length).toBeGreaterThan(8)
  })

  it('writes only columns some migration declares on ad_serve_log', () => {
    const declared = declaredColumns('ad_serve_log')
    expect(declared.size, 'no ad_serve_log columns found in the migrations').toBeGreaterThan(8)
    const undeclared = serveInsertColumns().filter((c) => !declared.has(c))
    expect(
      undeclared,
      `the ads function writes columns no migration creates: ${undeclared.join(', ')}. ` +
        'Deploy the migration before the function, or the delivery insert fails and handleDeliver returns 500.',
    ).toEqual([])
  })

  it('creates telemetry_session_id in migration 000021 specifically', () => {
    // Naming the file is the point: the deploy order has to be recoverable
    // from the repository, not inferred.
    const telemetry = migrations.find((m) => /000021/.test(m.name))
    expect(telemetry, 'migration 000021 is missing').toBeTruthy()
    expect(telemetry.sql).toMatch(/ADD COLUMN IF NOT EXISTS telemetry_session_id TEXT/)
  })
})

describe('the endpoint the SDK uses is one the platform actually serves', () => {
  it('addresses /telemetry on the same base as the ad routes', () => {
    // The gateway fronts the ads function. A new path has to be routed there
    // or it answers 404 and the browser blames CORS. Asserting the path
    // exists in one place stops a second SDK endpoint being invented.
    expect(sdk).toContain('`${this.baseUrl}/telemetry`')
    expect(sdk).toContain('path: "/telemetry"')
  })

  it('keeps the offline retry queue on the same path', () => {
    // A queued telemetry event flushed later must not address a different
    // host than the one that accepted the live event.
    expect(sdk).toContain('path: "/telemetry"')
    expect(sdk).toMatch(/url: `\$\{this\.baseUrl\}\$\{event\.path\}`/)
  })
})