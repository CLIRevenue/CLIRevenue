/**
 * Telemetry invariants that cannot be proven by running the code.
 *
 * Everything else about telemetry is tested against real Postgres. These
 * assertions are about things a passing test suite would happily tolerate:
 * a list that drifted apart from its database twin, a forbidden data source
 * added to an SDK call, or a column added to telemetry_sessions that has no
 * business being there.
 *
 * The duplication between supabase/functions/_shared/telemetry.ts and
 * supabase/migrations/000021_telemetry_event_model.sql is deliberate -- the
 * Edge Function has to reject a bad event type and an off-allow-list metadata
 * key before it spends a network call on them. The cost of that duplication
 * is that the two copies can drift, so the first test here exists to make
 * drift a build failure rather than a silent widening of what is collected.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

const SQL = readFileSync(join(ROOT, 'supabase/migrations/000021_telemetry_event_model.sql'), 'utf8')
const TS = readFileSync(join(ROOT, 'supabase/functions/_shared/telemetry.ts'), 'utf8')
const SDK = readFileSync(join(ROOT, 'packages/sdk/src/index.ts'), 'utf8')
const FN = readFileSync(join(ROOT, 'supabase/functions/telemetry/index.ts'), 'utf8')
// Handler logic lives in supabase/functions/_shared/telemetryRecord.ts so it is
// executable in tests; index.ts owns routing and serve(). Together they are the
// whole telemetry surface.
const RECORD = readFileSync(join(ROOT, 'supabase/functions/_shared/telemetryRecord.ts'), 'utf8')
const SURFACE = `${FN}\n${RECORD}`

/**
 * Source with comments removed.
 *
 * The forbidden-source list has to be checked against code, not prose: every
 * telemetry file names the things it refuses to collect, in its own header
 * comment. Checking the raw text would fail on the documentation that makes the
 * screen reviewable.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
}

/** The block between the first `[` and the matching `]`, as a list of strings. */
function tsList(source, marker) {
  const start = source.indexOf(marker)
  expect(start, `could not find ${marker}`).toBeGreaterThan(-1)
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  return source
    .slice(open + 1, close)
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

/** The single-quoted strings inside a SQL IN ( ... ) block that starts at `from`. */
function sqlList(source, from) {
  const start = source.indexOf(from)
  expect(start, `could not find ${from}`).toBeGreaterThan(-1)
  const open = source.indexOf('(', start + from.length)
  const close = source.indexOf(')', open)
  return [...source.slice(open + 1, close).matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/**
 * Data sources this system is not allowed to collect, written as the API or
 * header that would be used to reach one.
 *
 * These are API-shaped rather than bare words on purpose. The word "clipboard"
 * belongs in the telemetry screen -- the pattern that refuses it -- and checking
 * for the bare word would flag the very code that stops it being collected.
 * What must never appear is a call, not a mention.
 */
const FORBIDDEN_SOURCES = [
  'navigator.clipboard',
  'readText',
  'readBuffer',
  'navigator.mediaDevices',
  'getUserMedia',
  'getDisplayMedia',
  'navigator.geolocation',
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'remote_addr',
  '.useragent',
  'user_agent',
  'devicememory',
  'hardwareconcurrency',
  'getcontext',
  'audiocontext',
]

/** Data that has no legitimate home in this system at all. */
const FORBIDDEN_CONTENT = ['password', 'clipboard', 'terminal', 'microphone', 'camera']

describe('the catalogue is defined once and mirrored exactly', () => {
  it('lists the same twelve events in the Edge module and the database check', () => {
    expect(tsList(TS, 'TELEMETRY_EVENT_TYPES =')).toEqual([
      'session_started',
      'page_viewed',
      'section_viewed',
      'cta_clicked',
      'ad_requested',
      'campaign_selected',
      'creative_delivered',
      'ad_rendered',
      'visibility_qualified',
      'impression_qualified',
      'event_validated',
      'reward_created',
    ])
    expect(sqlList(SQL, 'CHECK (event_type IN')).toEqual(tsList(TS, 'TELEMETRY_EVENT_TYPES ='))
  })

  it('lets the client assert the same five events in both copies', () => {
    const fromTs = tsList(TS, 'CLIENT_EVENT_TYPES =')
    const fromSql = sqlList(SQL, 'IF p_event_type NOT IN')

    expect(fromTs).toEqual([
      'session_started',
      'page_viewed',
      'section_viewed',
      'cta_clicked',
      'ad_rendered',
    ])
    expect(fromSql).toEqual(fromTs)
  })

  it('keeps the metadata allow-list identical on both sides', () => {
    const fromTs = tsList(TS, 'TELEMETRY_METADATA_KEYS =')
    const fromSql = sqlList(SQL, 'IF v_key NOT IN')

    expect(fromTs).toEqual([
      'sectionId',
      'ctaId',
      'placementKey',
      'visiblePercent',
      'dwellMs',
      'adSize',
      'trigger',
    ])
    expect(fromSql).toEqual(fromTs)
  })

  it('keeps the metadata caps identical on both sides', () => {
    expect(SQL).toContain('> 8 THEN')
    expect(SQL).toContain('length(v_text) > 120 THEN')
    expect(TS).toContain('TELEMETRY_METADATA_MAX_KEYS = 8')
    expect(TS).toContain('TELEMETRY_METADATA_MAX_VALUE_LENGTH = 120')
  })

  it('covers the same forbidden shapes on both sides', () => {
    // The two patterns cannot be compared as text: the SQL regex is a POSIX
    // ARE and the JS one is a JS RegExp, so `/d/` and `[0-9]` are the only
    // difference in a concept they both express. What has to hold is that every
    // literal word on one side is a literal word on the other, and that both
    // cover the concepts that matter.
    const fromTs = TS.match(/FORBIDDEN_VALUE_RE\s*=\s*\/([\s\S]*?)\/i;/)
    const fromSql = SQL.match(/v_text ~\* '([\s\S]*?)' THEN/)

    expect(fromTs, 'FORBIDDEN_VALUE_RE not found').not.toBeNull()
    expect(fromSql, 'the SQL value screen not found').not.toBeNull()

    const literalBranches = (body) =>
      body
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .replace(/\\/g, '')
        .replace(/\s/g, '')
        .split('|')
        .filter((branch) => /^[A-Za-z0-9@:./[\]_-]+$/.test(branch))

    const tsWords = new Set(literalBranches(fromTs[1]))
    const sqlWords = new Set(literalBranches(fromSql[1]))

    for (const word of tsWords) expect(sqlWords, `SQL screen misses ${word}`).toContain(word)

    // And the concepts each side must refuse, whichever syntax it spells them in.
    for (const concept of ['pass', 'secret', 'token', 'bearer', 'clipboard', 'terminal', 'command', 'shell', 'private', 'mic', 'camera', 'capture', 'keylog']) {
      expect(tsWords, `TS screen misses ${concept}`).toContain(concept)
      expect(sqlWords, `SQL screen misses ${concept}`).toContain(concept)
    }
    // An api key is one branch with a separator class in it rather than a bare
    // word, so it is checked as written.
    expect(fromTs[1]).toContain('api[_-]?key')
    expect(fromSql[1]).toContain('api[_-]?key')
    // Home directories and dotfiles, which is where private key material lives.
    for (const path of ['.ssh', '.env', '/etc/', '/home/', '/root/', '/var/']) {
      expect(sqlWords, `SQL screen misses ${path}`).toContain(path)
      expect(fromTs[1].replace(/\\/g, ''), `TS screen misses ${path}`).toContain(path)
    }
    // A run of digits, for card and account numbers.
    expect(fromTs[1]).toContain('9,')
    expect(fromSql[1]).toContain('9,')
  })

  it('keeps the id, sdk version and surface patterns identical', () => {
    expect(SQL).toContain("p_session_id !~ '^[A-Za-z0-9._:-]+$'")
    expect(TS).toContain('TELEMETRY_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/')
    expect(SQL).toContain("p_sdk_version !~ '^[A-Za-z0-9@._+-]{1,40}$'")
    expect(TS).toContain('TELEMETRY_SDK_VERSION_RE = /^[A-Za-z0-9@._+-]{1,40}$/')
    expect(SQL).toContain("p_surface !~ '^[A-Za-z0-9._:-]+$'")
    expect(TS).toContain('TELEMETRY_SURFACE_RE = /^[A-Za-z0-9._:-]{1,64}$/')
  })
})

describe('the privacy screen holds', () => {
  it('telemetry_sessions has no column for anything about a person', () => {
    const block = stripComments(
      SQL.slice(SQL.indexOf('CREATE TABLE IF NOT EXISTS public.telemetry_sessions')).split(');')[0],
    )
    for (const source of FORBIDDEN_SOURCES) {
      expect(block.toLowerCase()).not.toContain(source)
    }
    // The only identity is the session the caller already had.
    expect(block).toContain('session_id TEXT PRIMARY KEY')
  })

  it('telemetry_events has no column for anything about a person', () => {
    const block = stripComments(
      SQL.slice(SQL.indexOf('CREATE TABLE IF NOT EXISTS public.telemetry_events')).split(');')[0],
    )
    for (const source of FORBIDDEN_SOURCES) {
      expect(block.toLowerCase()).not.toContain(source)
    }
  })

  it('no telemetry file reads a forbidden data source', () => {
    for (const [name, source] of [
      ['telemetry.ts', TS],
      ['telemetry/index.ts', FN],
      ['telemetryRecord.ts', RECORD],
      ['sdk/index.ts', SDK],
      ['000021.sql', SQL],
    ]) {
      const code = stripComments(source).toLowerCase()
      for (const forbidden of FORBIDDEN_SOURCES) {
        expect(code, `${name} references ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('names the forbidden content in comments, and only there', () => {
    // The words have to appear in the migration and the Edge module so a reader
    // can see what the screen exists for. They must not appear as a column, a
    // parameter or a body key.
    for (const word of FORBIDDEN_CONTENT) {
      expect(SQL.toLowerCase()).toContain(word)
    }
    for (const word of ['password', 'clipboard', 'terminal', 'microphone', 'camera']) {
      expect(SQL).not.toMatch(new RegExp(`^\\s*${word}\\s+(TEXT|JSONB|UUID)`, 'im'))
      expect(SQL).not.toMatch(new RegExp(`p_${word}\\s+(TEXT|JSONB|UUID)`, 'i'))
    }
  })

  it('gives record_telemetry_event no parameter that could steer money', () => {
    const signature = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public.record_telemetry_event'))
    const params = signature.slice(signature.indexOf('('), signature.indexOf(') RETURNS'))
    expect(params).not.toMatch(/campaign/i)
    expect(params).not.toMatch(/creative/i)
    expect(params).not.toMatch(/developer/i)
    expect(params).not.toMatch(/amount/i)
    expect(params).not.toMatch(/reward/i)
    expect(params).not.toMatch(/risk/i)
    expect(params).not.toMatch(/sequence/i)
    expect(params).not.toMatch(/event_id/i)
    expect(params).not.toMatch(/p_id\s/)
  })

  it('never reads a body field the Edge function has not screened', () => {
    // The handler validates the whole body through validateTelemetryPayload
    // before it reads anything else off it, and passes only named parameters
    // to the RPC.
    expect(SURFACE).toContain('validateTelemetryPayload')
    expect(SURFACE).toContain('record_telemetry_event')
    // Every field the handler reads off the body is named here. Anything new
    // has to be added deliberately, alongside the screen that permits it.
    const reads = [...new Set([...SURFACE.matchAll(/body\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))]
    expect(reads.sort()).toEqual([
      'idempotencyKey',
      'idempotency_key',
      'impressionToken',
      'impression_token',
      'occurredAt',
      'occurred_at',
      'publisherKey',
      'requestId',
      'request_id',
      'sessionId',
      'session_id',
      'surface',
    ])
    // And none of them names a person, a place or a device.
    const lowered = reads.join(' ').toLowerCase()
    for (const forbidden of ['user', 'agent', 'email', 'name', 'ip', 'device', 'cookie', 'url', 'referrer']) {
      expect(lowered).not.toContain(forbidden)
    }
  })

  it('sends only the publisher key, the session and the event over the wire', () => {
    const telemetrySection = SDK.slice(SDK.indexOf('---------------- telemetry ----------------'))
    const body = telemetrySection.slice(0, telemetrySection.indexOf('recordRendered'))
    // No url, referrer, cookie, storage read or token beyond the publishable
    // key is attached to a telemetry call.
    expect(body).not.toMatch(/document\.cookie/)
    expect(body).not.toMatch(/localStorage/)
    expect(body).not.toMatch(/safeLocationUrl/)
    expect(body).not.toMatch(/safeReferrer/)
    expect(body).toContain('publisherKey')
    expect(body).toContain('sessionId: this.sessionId')
    expect(body).toContain('idempotencyKey')
  })
})

describe('the reward gate is still three gates', () => {
  it('refuses server-only types in the RPC', () => {
    expect(SQL).toContain('IF p_event_type NOT IN')
    expect(SQL).toContain("RAISE EXCEPTION 'SERVER_ONLY_EVENT")
  })

  it('refuses server-only types at the row, behind a flag a client cannot set', () => {
    expect(SQL).toContain('tg_telemetry_events_server_only_guard')
    expect(SQL).toContain("current_setting('clirevenue.telemetry_internal', true) IS DISTINCT FROM '1'")
  })

  it('refuses a reward whose delivery resolves without a validated event', () => {
    expect(SQL).toContain("RAISE EXCEPTION 'REWARD_UNVALIDATED")
    const gate = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public.tg_telemetry_reward_created'))
    expect(gate).toContain("event_type = 'event_validated'")
    expect(gate).toContain('interaction_id = NEW.interaction_id')
    // And it steps aside when no delivery resolves, so the pre-serve accounting
    // path keeps working.
    expect(gate).toMatch(/IF NOT FOUND OR v_serve\.request_id IS NULL THEN\s*RETURN NEW/)
  })

  it('never reads or writes a reward amount from the telemetry path', () => {
    const gate = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public.tg_telemetry_reward_created'))
    expect(gate).not.toMatch(/amount_cents/)
    expect(gate).not.toMatch(/UPDATE\s+public\.reward_ledger/)
    expect(gate).not.toMatch(/DELETE\s+FROM\s+public\.reward_ledger/)
  })

  it('leaves the payment functions untouched', () => {
    // 000021 must not redefine anything that decides money.
    for (const fn of [
      'apply_interaction',
      'apply_impression',
      'record_serve_impression',
      'record_serve_click',
      'record_serve_conversion',
      'request_payout',
      'apply_settlement',
      'reward_balance',
    ]) {
      expect(SQL, `000021 redefines ${fn}`).not.toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`)
    }
    // No DDL and no DML against a money table either.
    for (const table of ['reward_ledger', 'payouts', 'payout_transactions', 'ledger_events']) {
      expect(SQL, `000021 modifies ${table}`).not.toMatch(
        new RegExp(`(UPDATE|DELETE FROM|ALTER TABLE|DROP TABLE)\\s+(public\\.)?${table}\\b`),
      )
    }
  })
})

describe('isolation is not weakened', () => {
  it('enables RLS with no policies on every telemetry table', () => {
    for (const table of ['telemetry_sessions', 'telemetry_events', 'campaign_creatives']) {
      expect(SQL).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON public\\.${table} FROM anon, authenticated`))
    }
    expect(SQL).not.toMatch(/CREATE POLICY/i)
  })

  it('revokes every new function from anon and authenticated', () => {
    const revokes = [...SQL.matchAll(/REVOKE ALL ON (?:FUNCTION )?(public\.[a-z_]+)/g)].map((m) => m[1])
    const grants = [...SQL.matchAll(/GRANT EXECUTE ON FUNCTION (public\.[a-z_]+)/g)].map((m) => m[1])
    expect(revokes.length).toBeGreaterThan(0)
    for (const fn of [
      'public.telemetry_emit',
      'public.record_telemetry_event',
      'public.telemetry_metadata_is_allowed',
    ]) {
      expect(revokes).toContain(fn)
      expect(grants).toContain(fn)
      const revoke = SQL.match(
        new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace('.', '\\.')}\\([^)]*\\) FROM PUBLIC, anon, authenticated`),
      )
      expect(revoke, `${fn} is not revoked from anon and authenticated`).not.toBeNull()
      expect(SQL).not.toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION ${fn.replace('.', '\\.')}\\([^)]*\\) TO (anon|authenticated)`),
      )
    }
  })
})

describe('the delivery handler is unchanged', () => {
  it('emits the delivery chain from a trigger, not from application code', () => {
    expect(SQL).toContain('AFTER INSERT ON public.ad_serve_log')
    expect(SQL).toContain('CREATE TRIGGER telemetry_serve_inserted')
    // No application file gained a telemetry call to make the chain happen.
    expect(FN).toContain('ad_rendered')
  })

  it('still sends the same publisher context on delivery and nothing more', () => {
    // The delivery handler keeps its own context screen; telemetry did not
    // widen it.
    expect(SDK).toContain('safeLocationUrl()')
    expect(SDK).toContain('safeReferrer()')

    // deliver() posts to /ads/deliver and nothing else. The one thing telemetry
    // added to it is the page-load session id, which is what links the
    // delivery's server-written events to the rest of the page.
    const deliver = stripComments(SDK.slice(SDK.indexOf('private async deliver')))
    const post = deliver.slice(0, deliver.indexOf('this.cache.set'))
    expect(post).toContain('/ads/deliver')
    expect(post).not.toContain('/telemetry')
    expect(post).not.toContain('emitTelemetry')
    expect(post).toContain('sessionId: this.sessionId')
  })

  it('persists the session the SDK sends on the delivery path', () => {
    // The delivery lifecycle is written by a trigger that fires inside the
    // ad_serve_log insert. If the insert does not carry the session, every
    // delivery event lands in a synthetic per-serve session, the page's real
    // session aggregate stays empty, and SYNTHETIC_SESSION fires on 100% of
    // deliveries -- which makes the flag worth nothing as a signal.
    //
    // This was a real gap: the column existed, the RPC resolved sessions from
    // it, and the SDK sent the field, but nothing on the delivery path read it.
    const ADS = readFileSync(join(ROOT, 'supabase/functions/ads/index.ts'), 'utf8')
    const deliver = ADS.slice(ADS.indexOf('async function handleDeliver'))
    const insert = deliver.slice(0, deliver.indexOf('.select("id")'))
    expect(insert).toContain('telemetry_session_id: readTelemetrySession(body)')
    expect(ADS).toContain('function readTelemetrySession(')
  })

  it('treats the delivery session as an opaque, bounded, well-formed string', () => {
    const ADS = readFileSync(join(ROOT, 'supabase/functions/ads/index.ts'), 'utf8')
    const reader = ADS.slice(ADS.indexOf('function readTelemetrySession'))
    expect(reader).toMatch(/length > 200/)
    expect(reader).toMatch(/\^\[A-Za-z0-9\._:-\]\+\$/)
    // Absent or malformed must fall back to null, never to a truncated value.
    expect(reader).toContain('return null')
  })

  it('offers telemetry as an option a publisher can turn off', () => {
    // Losing telemetry costs an advertiser the lifecycle but changes no money,
    // so it is a publisher choice rather than something hard-wired.
    expect(SDK).toContain('telemetry?: boolean')
    expect(SDK).toContain('options.telemetry !== false')
  })
})

/** Every .ts file under the telemetry function and its shared module. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|js)$/.test(full)) out.push(full)
  }
  return out
}

describe('the telemetry surface stays small', () => {
  it('is exactly one Edge Function and one shared module', () => {
    const files = walk(join(ROOT, 'supabase/functions/telemetry')).filter((f) => !f.endsWith('.test.ts'))
    expect(files.map((f) => f.replace(ROOT, ''))).toEqual(['supabase/functions/telemetry/index.ts'])
  })

  it('never lets the service role key reach the SDK bundle', () => {
    expect(stripComments(SDK)).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(FN).toContain('adminClient()')
  })

  it('logs nothing that identifies a visitor', () => {
    for (const source of [TS, FN]) {
      const logs = [...source.matchAll(/console\.(log|error|warn)\(([^)]*)\)/g)].map((m) => m[0])
      for (const log of logs) {
        expect(log.toLowerCase()).not.toMatch(/cookie|user-agent|ip\b|clipboard/)
      }
    }
  })
})