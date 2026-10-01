# Database tests — executed against a real PostgreSQL engine

**These tests run and pass.** They are not placeholders and not skipped.

```bash
npm run test:db      # 58 tests
```

## What backs them

[PGlite](https://pglite.dev) — PostgreSQL compiled to WASM, running in-process
and in-memory. The migrations and the `SECURITY DEFINER` functions are executed
by a real Postgres engine: plpgsql, triggers, row locking, RLS, enums,
`search_path` and transaction semantics all behave as they do in production.
Each test file gets a fresh in-memory database, so no test can see another's
rows and nothing can reach a real project.

This replaced an earlier, weaker plan in this file that called the suites
"NOT YET RUN" and waited on a local Supabase stack. A Docker daemon was not
reachable, and PGlite made the local-Postgres option unnecessary.

## The only thing stubbed is Supabase's own `auth` schema

`auth` is created by the platform, not by migrations, but the SQL references
`auth.users` (a trigger target) and `auth.uid()` (every RLS policy), so
`pg.js` creates both, plus the `anon` / `authenticated` / `service_role` roles
and Supabase's default-privilege baseline.

The default-privilege part is load-bearing. Supabase grants those three roles
ALL on everything in `public` by default and the migrations then `REVOKE` the
parts that must not be client-reachable — `REVOKE ALL ON TABLE campaigns FROM
anon` in 000008 only means something if `anon` started with ALL. Those
privileges are therefore installed *before* the migrations run and deliberately
**not** re-applied afterwards.

## Roles, not just a superuser

PGlite's default role is a superuser and superusers `BYPASS RLS`. Any test
that queried directly would pass regardless of what the policies said, so
every test switches with `SET LOCAL ROLE` and sets JWT claims via
`set_config('request.jwt.claims', ...)`. That makes the RLS assertions real,
and it is also what proves the money RPCs are unreachable from a client.

## Coverage

| File | Tests | Covers |
|---|---|---|
| `migrations.test.js` | 7 | 000001–000013 apply in order; tables, enum, 000012 removals, function set |
| `accounting.test.js` | 15 | impression accounting, budget ceiling, client-write refusal, idempotency of both event types, mandatory-impression click rule, cross-campaign impression mismatch, reward minting, paused/absent campaigns |
| `payouts.test.js` | 19 | settlement, repeat settlement, payout consumption, partial consumption, insufficient-balance atomicity, exact/±1-cent boundaries, large amounts, INT4 overflow, invalid amounts, null developer |
| `authorization.test.js` | 14 | advertiser campaign isolation, rival reads, update/insert refusal, anonymous denial, service-role write path, ledger and payout write refusal, developer isolation, role-escalation refusal, column-level profile grant, audience immutability |
| `integrity.test.js` | 3 | every `update_updated_at_column` trigger has a matching column; `payout_transactions` is updatable; money RPCs not executable by `authenticated` |

## What is still UNVERIFIED

- **True concurrent double-spend.** PGlite serves a single connection, so two
  genuinely simultaneous `request_payout` calls cannot be issued. The
  sequential invariant is proven (a second request finds nothing to take), and
  the `FOR UPDATE` locking is what protects the concurrent case, but the
  blocking behaviour itself has not been observed. This needs a multi-connection
  Postgres and is deliberately not claimed as passing.
- **Migrations against the real Supabase project.** These ran on Postgres via
  PGlite, not on the linked project (`xoacisojqsqlqzvzzusx`). No production
  database has been touched.
