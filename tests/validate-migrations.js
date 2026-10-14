import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations', import.meta.url))
const AUTH_PRELUDE = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ),
    'anon'
  );
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto') THEN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  END IF;
END $$;
`

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

console.log('Applying migrations:', files.length)

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(AUTH_PRELUDE)

let applied = 0
for (const file of files) {
  try {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    await db.exec(sql)
    applied++
    console.log('OK', file)
  } catch (err) {
    console.error('FAIL', file, ':', err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    break
  }
}

if (applied === files.length) {
  console.log('ALL', applied, 'migrations applied successfully')

  // Verify contact_submissions exists with correct columns
  const { rows: cols } = await db.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contact_submissions'
    ORDER BY ordinal_position;
  `)
  console.log('contact_submissions columns:', cols.map((c) => c.column_name).join(', '))

  const { rows: policies } = await db.query(`
    SELECT policyname, cmd FROM pg_policies WHERE tablename = 'contact_submissions'
    ORDER BY cmd, policyname;
  `)
  console.log('RLS policies:', policies.map((p) => `${p.cmd} ${p.policyname}`).join('; '))

  const { rows: enums } = await db.query(`
    SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'contact_statuses' ORDER BY e.enumsortorder;
  `)
  console.log('contact_statuses:', enums.map((e) => e.enumlabel).join(', '))

  const { rows: adminEmails } = await db.query(
    "SELECT email FROM public.admin_emails WHERE email = 'clirevenue@gmail.com'"
  )
  console.log('admin_emails entry:', adminEmails.length ? adminEmails[0].email : 'MISSING')
}

await db.close()