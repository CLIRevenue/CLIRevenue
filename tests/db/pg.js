/**
 * Real-Postgres harness for CLIRevenue migrations and accounting SQL.
 *
 * Uses PGlite: PostgreSQL compiled to WASM, running in-process and in-memory.
 * That means the migrations and the SECURITY DEFINER functions are executed by
 * a real Postgres engine -- plpgsql, triggers, row locking, RLS, enums and
 * search_path all behave as they do in production. Nothing is stubbed except
 * Supabase's own `auth` schema, which does not exist outside Supabase.
 *
 * This is not a mock. It is Postgres 17 semantics in a disposable process.
 * Each run starts from an empty database, so no test can see another test's
 * rows and nothing can touch a real project.
 */
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations', import.meta.url))

/**
 * Supabase's `auth` schema is provided by the platform, not by migrations.
 * The migrations reference auth.users (a trigger target) and auth.uid()
 * (every RLS policy), so both are created here with the shape the SQL expects.
 *
 * auth.uid() reads a session variable, which is how the real PostgREST does it.
 * Tests set it with `set_config('request.jwt.claims', ..., true)` to act as a
 * given user, or leave it empty to act as an anonymous caller.
 */
export const AUTH_PRELUDE = `
-- Supabase provisions these three roles and grants them the public schema.
-- Every GRANT/REVOKE in the migrations targets them by name, so they must
-- exist before 000004 or 000007 runs.
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

-- Supabase does not grant table privileges migration by migration: it gives
-- the three roles ALL on everything in public by default, and the migrations
-- then REVOKE the parts that must not be client-reachable. That baseline is
-- load-bearing -- "REVOKE ALL ON TABLE campaigns FROM anon" in 000008 only
-- makes sense if anon started with ALL. These default privileges must be in
-- place BEFORE the migrations run, and deliberately are not re-applied
-- afterwards, so each REVOKE keeps its effect.
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

-- pgcrypto is normally supplied by Supabase. gen_random_uuid() is built in
-- from PG13, so the extension is only needed where available.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto') THEN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  END IF;
END $$;
`

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/**
 * Apply the auth prelude and every migration in filename order.
 *
 * Each migration runs in its own transaction, mirroring how Supabase applies
 * them. That matters for 000009/000010: 000010 uses the reward_status value
 * 'consumed' that 000009 adds, and an enum value cannot be used in the same
 * transaction that introduces it, so the two must be separate transactions.
 */
export async function migrate() {
  // pgcrypto ships as a separate bundle in PGlite. Supabase has it built in,
  // so the migrations assume it exists; without this, 000001 fails on
  // CREATE EXTENSION "pgcrypto" before anything else runs.
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(AUTH_PRELUDE)
  const applied = []
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    try {
      await db.exec(sql)
      applied.push(file)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Migration failed: ${file}\n${applied.length} applied: ${applied.join(', ') || '(none)'}\n\n${detail}`,
        { cause: err },
      )
    }
  }
  return { db, applied }
}

export async function close(db) {
  await db.close()
}
