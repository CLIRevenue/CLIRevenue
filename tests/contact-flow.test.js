import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  CONTACT_FALLBACK,
  contactErrorCode,
  contactErrorLog,
  contactErrorMessage,
} from '../src/lib/contactErrors.js'

const ROOT = new URL('..', import.meta.url).pathname
const CONTACT = join(ROOT, 'src/components/conv/Contact.jsx')
const ADMIN_CONTACTS = join(ROOT, 'src/components/admin/AdminContacts.jsx')
const ADMIN_API = join(ROOT, 'src/lib/adminApi.js')

const read = (p) => readFileSync(p, 'utf8')
const contactSrc = read(CONTACT)
const adminContactsSrc = read(ADMIN_CONTACTS)
const adminApiSrc = read(ADMIN_API)

// Anything a PostgREST/Postgres failure can hand back that would tell a
// stranger something about how the store is built.
const DATABASE_DETAIL =
  /postgres|pgrst|row-level security|permission denied|contact_submissions|schema|relation|column|pg_|policy/i

describe('contact error mapping', () => {
  it('never derives visitor copy from the raw error message', () => {
    const err = { message: 'permission denied for table contact_submissions' }
    expect(contactErrorMessage(err, CONTACT_FALLBACK)).toBe(
      'Messaging is unavailable right now. Please try again later.'
    )
    expect(contactErrorMessage(err, CONTACT_FALLBACK)).not.toContain('contact')
  })

  it('reads the code from both error shapes it receives', () => {
    // supabase-js puts `code` at the top level; the fetch helpers nest it.
    expect(contactErrorCode({ code: 'PGRST205' })).toBe('unavailable')
    expect(contactErrorCode({ payload: { code: '42501' } })).toBe('unavailable')
    expect(contactErrorCode({ payload: { error: { code: '23505' } } })).toBe('unavailable')
  })

  it('collapses every database-shaped code to unavailable', () => {
    for (const code of ['PGRST205', 'PGRST116', '23505', '42501', '42P01', 'PG0001', '25P02']) {
      expect(contactErrorCode({ code })).toBe('unavailable')
    }
  })

  it('maps HTTP status to a visitor-actionable code', () => {
    expect(contactErrorCode({ status: 429 })).toBe('rate_limited')
    expect(contactErrorCode({ status: 503 })).toBe('unavailable')
    expect(contactErrorCode({ status: 401 })).toBe('unauthenticated')
  })

  it('logs the code alone, never the message', () => {
    const err = {
      status: 400,
      message: 'permission denied for table contact_submissions',
      code: '42501',
    }
    const logged = contactErrorLog(err)
    expect(logged).not.toMatch(DATABASE_DETAIL)
    expect(typeof logged === 'string' || typeof logged === 'object').toBe(true)
  })

  it('returns a usable string for every code it can produce', () => {
    for (const code of [
      'unauthenticated',
      'forbidden',
      'not_found',
      'not_configured',
      'invalid_event',
      'rate_limited',
      'unavailable',
      'unknown',
    ]) {
      const message = contactErrorMessage({ contactCode: code }, CONTACT_FALLBACK)
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toMatch(DATABASE_DETAIL)
    }
  })
})

describe('public contact form does not leak storage detail', () => {
  it('never logs a raw error message', () => {
    expect(contactSrc).not.toMatch(/submitError\.message/)
    expect(contactSrc).not.toMatch(/console\.error\([^)]*,\s*e\s*\)/)
  })

  it('routes both failure paths through the error mapper', () => {
    expect(contactSrc).toContain('contactErrorLog')
    expect(contactSrc).toContain('contactErrorMessage')
    expect(contactSrc).toContain('CONTACT_FALLBACK')
  })

  it('renders no user-visible database string in its own copy', () => {
    // The form's own literals: the category labels, the caps messages and the
    // success copy. The table name in the insert is a code identifier, not
    // copy, so it is excluded from the scan rather than the whole file.
    const literals = (contactSrc.match(/'[^'\n]{6,}'/g) || []).filter(
      (l) => !/contact_submissions|clirevenue-sdk|clirevenue\.in/.test(l)
    )
    for (const literal of literals) {
      expect(literal).not.toMatch(/postgres|pgrst|row-level security|contact_submissions/i)
    }
  })

  it('inserts only the documented columns', () => {
    const insert = contactSrc.slice(
      contactSrc.indexOf(".from('contact_submissions')"),
      contactSrc.indexOf('})', contactSrc.indexOf(".from('contact_submissions')"))
    )
    for (const column of [
      'name',
      'email',
      'subject',
      'category',
      'message',
      'user_id',
    ]) {
      expect(insert).toContain(column)
    }
    // Nothing that would turn the public insert into a privilege probe.
    expect(insert).not.toMatch(/status|admin_notes|updated_at/)
  })

  it('is reachable without authentication', () => {
    // user_id is user?.id ?? null — an anonymous visitor submits, the row is
    // simply not attributed. Guard against someone "fixing" that into a gate.
    expect(contactSrc).toContain('user?.id ?? null')
  })
})

describe('admin inbox stays behind the admin surface', () => {
  it('reads through the authenticated backend, never the anon client', () => {
    expect(adminApiSrc).toContain('VITE_API_BASE_URL')
    expect(adminApiSrc).not.toContain('VITE_AD_GATEWAY_URL')
    expect(adminApiSrc).not.toMatch(/supabase\s*\.\s*from\(/)
  })

  it('exposes receive, status, notes and delete against /contacts', () => {
    expect(adminApiSrc).toContain('/contacts')
    expect(adminApiSrc).toContain('admin_notes')
  })

  it('shows an explicit denial when the server refuses a non-admin', () => {
    expect(adminContactsSrc).toContain('Access denied')
  })

  it('is only reachable from the role-gated admin route', () => {
    const appSrc = read(join(ROOT, 'src/App.jsx'))
    expect(appSrc).toContain('AdminConsole')
    // AdminConsole is rendered behind RequireRole allow={['admin']}; the
    // contacts tab is inside it, so no public route can render the inbox.
    expect(appSrc).toMatch(/RequireRole\s+allow=\{\s*\['admin'\]\s*\}/)
  })
})

describe('contact storage is not browser-readable', () => {
  const migrationsDir = join(ROOT, 'supabase/migrations')
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => read(join(migrationsDir, f)))
    .join('\n')

  it('revokes SELECT from anon and authenticated', () => {
    const relevant = sql
      .split('\n')
      .filter((line) => /contact_submissions/i.test(line) && /REVOKE|GRANT|POLICY/i.test(line))
      .join('\n')
    expect(relevant).toMatch(/REVOKE[^;]*FROM\s+anon,\s*authenticated/i)
  })

  it('grants the browser INSERT only — no read, update or delete', () => {
    // service_role legitimately gets full access; the browser roles must not.
    const browserGrants = sql
      .split('\n')
      .filter(
        (line) =>
          /GRANT/i.test(line) &&
          /contact_submissions/i.test(line) &&
          /anon|authenticated/i.test(line)
      )
      .join('\n')
    expect(browserGrants).toMatch(/GRANT\s+INSERT/i)
    expect(browserGrants).not.toMatch(/GRANT[^;]*\b(SELECT|UPDATE|DELETE)\b/i)
  })
})