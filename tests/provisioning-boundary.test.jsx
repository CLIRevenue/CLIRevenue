import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import SdkSetup from '../src/components/developer/SdkSetup.jsx'

/**
 * The provisioning boundary, asserted at source level.
 *
 * The database invariants are covered by tests/db/provisioning.test.js and
 * the response-shaping rules by supabase/functions/_shared/provisioning.test.ts.
 * What is left is the wiring between them, and wiring is exactly what a
 * behavioural test cannot see: a handler that reads the owner out of the
 * request body, a page that renders a key it did not receive, a client that
 * grows a second env var. Each assertion below names the mistake it prevents.
 */
const ROOT = new URL('..', import.meta.url).pathname
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * Source with its comments removed. Both files explain themselves at length,
 * and the explanations deliberately use the words the assertions forbid
 * ("revoke", "plaintext", "key_hash") while describing what they do not do.
 * Testing the prose would test the prose.
 */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|--)/.test(line))
    .join('\n')

const FN = 'supabase/functions/provision_publisher/index.ts'
const SHARED = 'supabase/functions/_shared/provisioning.ts'
const MIGRATION = 'supabase/migrations/000016_developer_publisher_provisioning.sql'
const PAGE = 'src/components/developer/SdkSetup.jsx'
const CLIENT = 'src/lib/publisherApi.js'

describe('the provisioning function authenticates before it provisions', () => {
  const src = read(FN)

  test('requires a session and a developer account before any write', () => {
    expect(src).toMatch(/getJwtUser\(req\)/)
    expect(src).toMatch(/requireDeveloper\(admin,\s*authed\.user!\.id\)/)
    // The guards come before adminClient is used for anything mutating.
    expect(src.indexOf('requireDeveloper')).toBeLessThan(src.indexOf('admin.rpc'))
  })

  test('takes the owner from the verified token, so there is no field to escalate with', () => {
    // profile.id comes from the JWT subject; a body or query parameter
    // naming another profile would let any developer provision for anyone.
    expect(src).toMatch(/profileId\s*=\s*dev\.profile!\.id/)
    expect(src).not.toMatch(/req\.json\(\)/)
    expect(src).not.toMatch(/searchParams/)
    expect(src).not.toMatch(/owner_profile_id[^\n]*req\b/)
  })

  test('derives the publisher name from the account email rather than the request', () => {
    expect(src).toMatch(/publisherNameFromEmail\(authed\.user!\.email\)/)
  })

  test('is POST-only, OPTIONS-aware, and refuses any sub-path', () => {
    expect(src).toMatch(/req\.method === "OPTIONS"\)\s*return optionsResponse\(req\)/)
    expect(src).toMatch(/METHOD_NOT_ALLOWED/)
    expect(src).toMatch(/restPath\(url\.pathname, "provision_publisher"\)\.length > 0/)
  })

  test('never returns an internal error message to the caller', () => {
    expect(src).toMatch(/INTERNAL_ERROR/)
    // The log keeps the detail; the response must not.
    expect(src).not.toMatch(/apiError\([^)]*err\.message/)
  })
})

describe('the provisioning function mints exactly one key', () => {
  const src = read(FN)

  test('asks the RPC whether a key exists before generating anything', () => {
    expect(src).toMatch(/admin\.rpc\("provision_publisher_slot"/)
    // The early return for an existing slot must come before the generator
    // is ever called, otherwise a refresh would mint a second key.
    const guard = src.indexOf('!slot.needs_key')
    const mint = src.indexOf('generatePublisherKey(')
    expect(guard).toBeGreaterThan(-1)
    expect(mint).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(mint)
  })

  test('stores a hash and a fragment, and reads back neither the hash nor the raw value', () => {
    expect(src).toMatch(/hashPublisherKey\(/)
    expect(src).toMatch(/key_prefix:\s*keyPrefix\(/)
    const select = src.match(/KEY_COLUMNS\s*=\s*"([^"]*)"/)
    expect(select).toBeTruthy()
    expect(select[1]).not.toMatch(/key_hash/)
    // The insert column list must carry the hash; the read-back must not.
    const insertMatch = src.match(/insert\(\{([^}]*)\}/)
    expect(insertMatch).toBeTruthy()
    expect(insertMatch[1]).toMatch(/key_hash/)
  })

  test('reuses the existing hashing and generation helpers rather than reimplementing them', () => {
    expect(src).toMatch(/from "\.\.\/_shared\/publisherAuth\.ts"/)
    expect(src).not.toMatch(/crypto\.subtle/)
    expect(src).not.toMatch(/Math\.random/)
  })

  test('recovers from a lost race without inventing a second key', () => {
    // Two tabs, or a double submit: the unique index fires, and the winner's
    // row is what gets reported - without a raw key, because this request
    // did not mint it.
    expect(src).toMatch(/23505/)
    expect(src).toMatch(/readActiveKey/)
    expect(src).toMatch(/needs_key:\s*false/)
  })

  test('does not rotate: no revoke, and no second key on an existing slot', () => {
    const fnCode = code(FN)
    // revoked_at may appear once, as a read filter for "still active". Any
    // other use would be a rotation wearing a filter's clothes.
    expect(fnCode.match(/revoked_at/g) || []).toHaveLength(1)
    expect(fnCode).toMatch(/\.is\("revoked_at", null\)/)
    expect(fnCode).not.toMatch(/revoked_at:\s*[^n]/)
    expect(fnCode).not.toMatch(/\.update\(|\.upsert\(/)
    expect(read(FN)).toMatch(/no rotation/i)
  })

  test('only ever issues a test key, never a live one', () => {
    expect(src).toMatch(/KEY_ENV\s*=\s*"test"/)
    expect(src).not.toMatch(/generatePublisherKey\(\s*"live"/)
  })

  test('the response builder is the single place a raw key can appear', () => {
    expect(src).toMatch(/buildProvisioningResponse/)
    const shared = read(SHARED)
    expect(shared).toMatch(/if \(created && mayRevealPublishableKey\(newRawKey, slot\.key_env\)\)/)
    // The response type has no field a hash could be smuggled into.
    expect(shared).not.toMatch(/key_hash[?]?:\s*string/)
    expect(code(FN)).not.toMatch(/key_raw|key_plaintext|plaintext/i)
  })

  test('no service-role key literal anywhere in the function', () => {
    expect(src).not.toMatch(/service_role\s*=\s*["']/)
    expect(src).toMatch(/adminClient\(\)/)
  })
})

describe('the database enforces what the function assumes', () => {
  const sql = read(MIGRATION)

  test('one publisher per owner profile', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS publishers_owner_profile_id_key[\s\S]*?owner_profile_id\)[\s\S]*?WHERE owner_profile_id IS NOT NULL/,
    )
  })

  test('one active key per publisher per environment', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS publisher_keys_active_env_key[\s\S]*?\(publisher_id, key_env\)[\s\S]*?WHERE revoked_at IS NULL[\s\S]*?AND key_env IS NOT NULL/,
    )
  })

  test('the environment column stays nullable so pre-existing rows keep working', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS key_env TEXT/)
    expect(sql).toMatch(/key_env IS NULL OR key_env IN \('test', 'live'\)/)
  })

  test('the RPC is reachable only by the service role', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.provision_publisher_slot\(UUID,\s*TEXT\)[\s\S]*?FROM PUBLIC, anon, authenticated/,
    )
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.provision_publisher_slot\(UUID,\s*TEXT\)[\s\S]*?TO service_role/)
  })

  test('the RPC serialises on the developer row rather than trusting the caller', () => {
    expect(sql).toMatch(/FROM public\.developer_accounts[\s\S]*?WHERE profile_id = p_owner_profile_id[\s\S]*?FOR UPDATE/)
    expect(sql).toMatch(/PUBLISHER_OWNER_REQUIRED/)
  })

  test('the RPC cannot return a hash, by construction', () => {
    expect(code(MIGRATION)).not.toMatch(/key_hash/)
  })
})

describe('the browser client asks, it does not decide', () => {
  const src = read(CLIENT)

  test('sends the session and nothing else', () => {
    expect(src).toMatch(/Authorization: `Bearer \$\{token\}`/)
    expect(src).not.toMatch(/apikey/i)
    expect(src).not.toMatch(/service_role|SERVICE_ROLE/i)
    // A body would be a place to put an owner id.
    expect(src).not.toMatch(/body:\s*JSON\.stringify/)
  })

  test('adds no environment variable', () => {
    // The client may only read the gateway base. The page legitimately names
    // the build-time key inside a code sample, so it is checked against the
    // set the rest of the app already uses rather than against one entry.
    const clientVars = [...read(CLIENT).matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)].map((m) => m[1])
    expect(new Set(clientVars)).toEqual(new Set(['VITE_API_BASE_URL']))
    const pageVars = [...read(PAGE).matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)].map((m) => m[1])
    expect(new Set(pageVars)).toEqual(new Set(['VITE_API_BASE_URL', 'VITE_CLIREVENUE_PUBLISHABLE_KEY']))
  })

  test('will not render a key that is not a publishable key', () => {
    expect(src).toMatch(/PUBLISHABLE_KEY_PATTERN\.test/)
    expect(src).toMatch(/\? key\.publishableKey\s*:\s*null/)
  })

  test('falls through only on a routing mismatch', () => {
    expect(src).toMatch(/if \(e\.status !== 404 && e\.status !== 405\) throw e/)
  })
})

describe('the SDK setup page', () => {
  const src = read(PAGE)

  test('provisions from the server on mount', () => {
    expect(src).toMatch(/provisionPublisher\(\)/)
    expect(src).toMatch(/useEffect/)
  })

  test('states that the key is shown once, because only its hash is stored', () => {
    expect(src).toMatch(/SHA-256 hash is stored/)
    expect(src).toMatch(/Reload of this page will bring back the fragment/i)
  })

  test('no longer tells a developer to run SQL for a publisher or a key', () => {
    expect(src).not.toMatch(/service-role SQL/)
    expect(src).not.toMatch(/INSERT INTO publisher_keys/)
    expect(src).not.toMatch(/No API to create a publisher/)
  })

  test('does not advertise an installer that does not exist', () => {
    // npm install @clirevenue/sdk is the real command. A page that tells a
    // developer to run a package we have never published costs them an hour.
    expect(src).toMatch(/npm install @clirevenue\/sdk/)
    expect(src).not.toMatch(/npx clirevenue setup/)
  })

  test('still refuses to invent a number', () => {
    expect(src).toMatch(/never invents a number/)
    expect(src).toMatch(/No performance data is shown here/)
  })

  test('copies the key through the shared control, not a hand-rolled block', () => {
    expect(src).toMatch(/<CopyButton/)
    expect(src).not.toMatch(/navigator\.clipboard/)
  })
})

describe('server-rendered, the page holds no key at all', () => {
  let html = ''
  beforeAll(() => {
    html = renderToStaticMarkup(<SdkSetup />)
  })
  afterAll(() => {
    html = ''
  })

  test('renders the provisioning panel in its checking state', () => {
    // Effects do not run during server rendering, so this is the state a
    // non-JS client sees: a request outstanding and nothing to leak.
    expect(html).toMatch(/SDK setup/)
    expect(html).toMatch(/Checking your publisher account/)
  })

  test('shows no publishable key and no copy control', () => {
    expect(html).not.toMatch(/pk_(live|test)_[A-Za-z0-9_-]{8}/)
    expect(html).not.toMatch(/Copy key/)
    expect(html).not.toMatch(/Reveal key/)
  })
})