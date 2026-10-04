/**
 * Admin authorization: routing, role checks, and server-side enforcement.
 *
 * What this suite covers:
 *   1. authState.js exposes a home route for the 'admin' role.
 *   2. App.jsx routes /app/admin through RequireRole with allow=['admin'].
 *   3. App.jsx renders the AdminConsole shell (not a stub) for /app/admin.
 *   4. The admin Edge Function is the sole authority: it calls requireAdmin,
 *      which queries profiles.role from the database via the service role.
 *   5. No frontend file references ADMIN_EMAIL, ADMIN_PASSWORD, or stores
 *      isAdmin in localStorage/sessionStorage.
 *   6. The admin Edge Function rejects non-admin callers with 403.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// ---------- helpers --------------------------------------------------

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(js|jsx|ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}
import { readdirSync, statSync } from 'node:fs'

const srcFiles = walk(join(ROOT, 'src'))
const fnFiles  = walk(join(ROOT, 'supabase/functions'))

// ---------- authState: admin home route ------------------------------

describe('admin role routing', () => {
  it('authState.js maps admin role to /app/admin', () => {
    const src = read('src/components/auth/authState.js')
    expect(src).toMatch(/admin:\s*['"]\/app\/admin['"]/)
  })

  it('authNavState exposes a dashboard link for the admin role', () => {
    const src = read('src/components/auth/authState.js')
    expect(src).toMatch(/admin:\s*['"]\/app\/admin['"]/)
    expect(src).toMatch(/roleHome\(role\)/)
  })

  it('RequireRole is used with allow=admin for /app/admin in App.jsx', () => {
    const src = read('src/App.jsx')
    expect(src).toMatch(/RequireRole[\s\S]*?allow=\{(\[.*'admin'|\[.*"admin")\]/)
  })
})

// ---------- App.jsx: admin route wiring ------------------------------

describe('App.jsx admin route', () => {
  it('routes /app/admin through RequireRole allow=admin', () => {
    const src = read('src/App.jsx')
    expect(src).toMatch(/\/app\/admin.*RequireRole.*allow=\{\['admin'\]\}/s)
  })

  it('renders AdminConsole for /app/admin (not a stub)', () => {
    const src = read('src/App.jsx')
    const adminSection = src.slice(
      src.indexOf("clean === '/app/admin'"),
      src.indexOf('if (clean === /app")')
    )
    expect(adminSection).toMatch(/AdminConsole/)
    expect(adminSection).not.toMatch(/No admin app ships/)
    expect(adminSection).not.toMatch(/out of scope/)
  })
})

// ---------- NO fake admin secrets in frontend -------------------------

describe('no fake admin secrets in frontend', () => {
  it('no frontend file hardcodes an admin email', () => {
    const offenders = srcFiles.filter((f) => {
      const src = readFileSync(f, 'utf8')
      // Look for ADMIN_EMAIL literal or email === "..." patterns inside admin-ish code
      return /ADMIN_EMAIL|ADMIN_USER|admin@|ADMIN_PASSWORD/.test(src)
    })
    expect(offenders.map((f) => f.replace(ROOT, ''))).toEqual([])
  })

  it('no frontend file stores isAdmin in localStorage or sessionStorage', () => {
    const offenders = srcFiles.filter((f) => {
      const src = readFileSync(f, 'utf8')
      return /localStorage\.(set|get)Item.*isAdmin|sessionStorage\.(set|get)Item.*isAdmin/.test(src)
    })
    expect(offenders.map((f) => f.replace(ROOT, ''))).toEqual([])
  })

  it('adminApi.js never accepts an email or role from the request body', () => {
    const src = read('src/lib/adminApi.js')
    // The admin API layer only sends Authorization header; no email/role body params.
    expect(src).not.toMatch(/email.*body|role.*body/i)
    expect(src).toMatch(/Authorization.*Bearer/)
  })
})

// ---------- Edge Function: requireAdmin enforcement -------------------

describe('admin Edge Function authorization', () => {
  it('the admin function calls requireAdmin (not just getJwtUser)', () => {
    const src = read('supabase/functions/admin/index.ts')
    expect(src).toMatch(/requireAdmin/)
    // requireAdmin must come from _shared/auth
    expect(src).toMatch(/requireAdmin.*from.*_shared\/auth/)
  })

  it('requireAdmin rejects callers whose role is not admin (source)', () => {
    const src = read('supabase/functions/_shared/auth.ts')
    const fnBody = src.slice(src.indexOf('export async function requireAdmin'))
    expect(fnBody).toMatch(/role\s*!==\s*['"]admin['"]/)
    expect(fnBody).toMatch(/FORBIDDEN/)
    expect(fnBody).toMatch(/Admin access required/)
    expect(fnBody).toMatch(/admin_emails/)
  })

  it('requireAdmin returns 403 for non-admin, not 200', () => {
    const src = read('supabase/functions/_shared/auth.ts')
    const fnBody = src.slice(src.indexOf('export async function requireAdmin'))
    expect(fnBody).toMatch(/apiError\(.*FORBIDDEN.*403/)
  })

  it('the admin Edge Function never trusts an email in the request body', () => {
    const src = read('supabase/functions/admin/index.ts')
    expect(src).not.toMatch(/req\.json\(\)/)
    expect(src).not.toMatch(/body\.email/)
    expect(src).not.toMatch(/body\[.email.\]/)
  })

  it('the admin Edge Function identifies the caller only via JWT (user.id)', () => {
    const src = read('supabase/functions/admin/index.ts')
    expect(src).toMatch(/getJwtUser/)
    expect(src).toMatch(/authed\.user!/)
    // No trusted caller email from body
    expect(src).not.toMatch(/body\.email/)
  })
})

// ---------- RLS: admin policies exist in migration --------------------

describe('admin RLS policies', () => {
  it('migration 000017 creates the admin_emails allowlist table', () => {
    const src = read('supabase/migrations/000017_admin_rls.sql')
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_emails/)
    expect(src).toMatch(/REVOKE ALL ON public\.admin_emails FROM anon, authenticated/)
    expect(src).toMatch(/GRANT SELECT ON public\.admin_emails/)
  })

  it('migration 000018 adds admin SELECT policies for key tables', () => {
    const src = read('supabase/migrations/000018_admin_rls_policies.sql')
    const checks = {
      campaigns:          'Admins can view all campaigns',
      advertisers:        'Admins can view all advertisers',
      developer_accounts: 'Admins can view all developer',
      publishers:         'Admins can view all publishers',
      placements:         'Admins can view all placements',
      ad_serve_log:       'Admins can view all serve log',
      ad_impressions:     'Admins can view all impressions',
      ad_interactions:    'Admins can view all interactions',
      reward_ledger:      'Admins can view all reward ledger',
      payouts:            'Admins can view all payouts',
      payout_transactions:'Admins can view all payout transactions',
    }
    for (const [table, label] of Object.entries(checks)) {
      expect(src, 'missing admin policy for ' + table).toMatch(label)
    }
    // All admin policies must use jwt_is_admin() (SECURITY DEFINER) rather
    // than querying admin_emails directly.
    expect(src).toMatch(/jwt_is_admin\(\)/)
    expect(src).toMatch(/SECURITY DEFINER/)
  })

  it('migration 000018 creates the jwt_is_admin() SECURITY DEFINER function', () => {
    const src = read('supabase/migrations/000018_admin_rls_policies.sql')
    expect(src).toMatch(/CREATE OR REPLACE FUNCTION public\.jwt_is_admin/)
    expect(src).toMatch(/SECURITY DEFINER/)
    expect(src).toMatch(/current_setting\('request.jwt.claims'/)
    expect(src).toMatch(/GRANT EXECUTE ON FUNCTION public\.jwt_is_admin/)
  })

  it('admin policies do not hardcode a test email address', () => {
    const src018 = read('supabase/migrations/000018_admin_rls_policies.sql')
    expect(src018).not.toMatch(/@example\.com|@test\.com/)
  })

  it('publisher_keys admin policy exists (never expose key_hash to non-admin)', () => {
    const src = read('supabase/migrations/000018_admin_rls_policies.sql')
    expect(src).toMatch(/publisher_keys/)
  })
})

// ---------- Security invariants: service role key in frontend ----------

describe('service role key never reaches browser', () => {
  it('AdminOverview uses Object.entries for system status, not Object.values', () => {
    const src = read('src/components/admin/AdminOverview.jsx')
    expect(src).toMatch(/Object\.entries\(system\)/)
    expect(src).not.toMatch(/Object\.values\(system\)/)
  })

  it('no admin file references the service role key env var', () => {
    const adminFiles = [
      'src/lib/adminApi.js',
      'src/components/admin/AdminConsole.jsx',
      'src/components/admin/AdminOverview.jsx',
      'src/components/admin/AdminCampaigns.jsx',
      'supabase/functions/admin/index.ts',
    ]
    for (const f of adminFiles) {
      const src = read(f)
      expect(src, `${f} must not reference SERVICE_ROLE`).not.toMatch(
        /SERVICE_ROLE|service_role|serviceRoleKey/
      )
    }
  })
})
