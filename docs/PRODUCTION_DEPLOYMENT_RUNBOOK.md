# Production Deployment Runbook

Scope: migrations `000008`–`000015` and Edge Functions for `xoacisojqsqlqzvzzusx`.
Nothing in this document has been executed. No deploy, no `db push`, no commit.

Production state as of 2026-09-30:

- Branch `backend-real-delivery`, HEAD `054c68b`.
- Production has `000001`–`000007`. `000008`–`000015` are pending.
- Deployed functions are the old `054c68b`-ancestor versions of `campaigns`, `rewards`,
  `record_impression`, `record_interaction`. `events` is undeployed.
- CLI `2.118.0`; remote Postgres `17.6.1.166`.

## 1. Secrets to provision BEFORE deploying

| Secret | Required | Missing-secret behaviour |
| --- | --- | --- |
| `AD_TOKEN_SECRET` (>= 16 chars) | yes | `ads` returns 503 and refuses to serve. Fail closed. |
| `SETTLEMENT_SECRET` | yes | `hasSettlementSecret` returns false, so only the scoped developer path works. |
| `SETTLEMENT_MS` | no | Falls back to `DEFAULT_SETTLEMENT_MS`. |
| `APP_ORIGINS` | no | Falls back to `*`. Prefer restricting before launch. |
| `SUPABASE_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` | auto | Provisioned and linked by the platform. |

`AD_TOKEN_SECRET` must be set before step 3, otherwise `ads` is deployed but cannot serve.
Rotate the Cursor API key exposed via `ps` (PID 12016) separately — unrelated to this deploy.

## 2. Migration order

Hard dependency, verified by arity:

- `000011_ad_interaction_integrity.sql` defines `public.apply_interaction` with 8 parameters.
- `000015_serve_tracking_rpcs.sql` calls it with exactly 8 arguments (line 181, and again at 261).

`000011` MUST apply before `000015`. The normal ascending order satisfies this.

Second constraint — `000012_remove_global_active_campaign.sql` is guarded and idempotent, but
the old deployed `campaigns` function still reads and writes
`platform_settings.active_campaign_id`. Hold `000012` until the new `campaigns` function
is live, or old traffic will call a column that no longer exists.

`supabase migration up` has no subset flag, so to defer `000012` while applying `000013`–`000015`:

```
mv supabase/migrations/000012_remove_global_active_campaign.sql /tmp/
supabase migration up
mv /tmp/000012_remove_global_active_campaign.sql supabase/migrations/
supabase migration up
```

Migrations are not transactional across the whole run, so take a snapshot first.

## 3. Deploy order

1. `supabase db push` (or `supabase migration up`) through `000011`, with `000012` set aside.
2. Deploy the new `campaigns` function.
3. Apply `000012` via a second `supabase migration up`, then restore the file.
4. Deploy remaining functions (`000013`–`000015` are additive; `000015` supplies
   `record_serve_impression` / `record_serve_interaction` used by the tracking functions).
5. Deploy `events` (currently undeployed).

The old `record_impression` / `record_interaction` call the two-argument `apply_impression` /
`apply_interaction`. `000011` changes the impression signature, so steps 2–4 are one
transactional unit: do not leave the tracking functions deployed across the `000011` apply.

## 4. `--no-verify-jwt` per function

Derived by reading the auth path of each function, not by assumption.

Needs `--no-verify-jwt`:

- `ads` — authenticates with `body.publisherKey` via `authenticatePublisher`.
- `get_active_campaign` — no authentication by design. Public delivery probe. Its
  `campaign_id` filter was removed precisely so no caller can pin delivery to another
  advertiser's campaign.
- `settle_rewards` — **dual-mode**. The settlement-secret branch is platform-wide and the
  developer-JWT branch is scoped. Deploying with gateway JWT verification makes the
  gateway reject secret-only callers before the function runs, silently disabling
  platform-wide settlement. In-function auth is still enforced: the secret is compared in
  constant time and the other path verifies a real JWT.

Must use the default (gateway verifies JWT):

- `auth` — GET `/me`; returns the caller's own profile. It does not mint tokens.
- `campaigns`, `campaign_select`, `payouts`, `rewards` — `requireAdvertiser` / `requireDeveloper`.
- `events`, `record_impression`, `record_interaction` — these delegate to
  `_shared/events.ts`, where `handleImpression` / `handleInteraction` call `getJwtUser`
  then `requireDeveloper`. They are authenticated despite having no auth code of their own.
- `delete_account` — passes the `Authorization` header to `auth.getUser()`.

## 5. Security notes

- Serve tokens are HMAC-SHA256, not JWTs. Signature is verified before the payload is
  decoded, so an unsigned token never reaches the request-id comparison.
- Publisher keys are stored as SHA-256 hashes plus a display prefix. A caller-supplied
  `publisherId` is never trusted; it is derived from the key.
- Tracking RPCs derive campaign and developer server-side and reject caller-supplied
  `campaign_id`.
- `000008:41 protect_campaign_accounting` is a plain trigger function, **not**
  `SECURITY DEFINER`, and it does not pin `search_path`. A text search for
  `SECURITY DEFINER` in that file matches a *comment* inside its body ("SECURITY
  DEFINER RPCs and service-role Edge Functions still update counters"), which is
  how it was previously misread here. Verified against a live schema: all 14
  `SECURITY DEFINER` functions in `public` already carry
  `SET search_path = public`, and `pg_proc.prosecdef` for
  `protect_campaign_accounting` is `false`. Its body touches only
  `current_setting`, `NEW` and `OLD` — no tables, no user-controllable
  resolution — so there is nothing to pin. No migration is warranted.
- A serve belonging to another developer returns the same 404 as a serve that does not
  exist, so request ids cannot be enumerated.

## 6. Known gaps

- Concurrent double-spend is unverified. PGlite is single-connection, and no local
  PostgreSQL or Docker is available to test true concurrency. The `FOR UPDATE` locking in
  `apply_impression` / `apply_interaction` is unexercised by the suite.
- PGlite does not fully emulate Postgres, so a clean local apply is necessary but not
  sufficient evidence for a production apply. Stage first.
- Multi-tenant campaign selection is deterministic: advertiser-owned eligibility,
  `created_at ASC`, then `id ASC`, over a 25-candidate window. There is no auction or
  weighting.

---

## 7. Verified observations (2026-10-09)

Everything below was verified by execution against a real Postgres (PGlite,
which replays every migration in `supabase/migrations/`), not by reading source.

### 7.1 `SECURITY DEFINER` coverage

| Measurement | Value |
| --- | --- |
| Functions in `public` | 63 |
| `SECURITY DEFINER` | 14 |
| Of those, with `search_path` pinned | **14** |
| `SECURITY DEFINER` without a pinned `search_path` | **0** |

The 14 are `apply_impression`, `apply_interaction`, `apply_settlement`,
`campaign_activation_blockers`, `ensure_own_profile`, `handle_new_user`,
`provision_publisher_slot`, `record_serve_click`, `record_serve_conversion`,
`record_serve_impression`, `record_telemetry_event`, `request_payout`,
`reward_balance`, `telemetry_emit`.

An audit handoff proposed a migration `000024_protect_campaign_search_path.sql`
to pin `search_path` on `protect_campaign_accounting`. **It was not applied**,
because the premise was a false positive (§5) and there is no definer function
left unprotected. Adding a production migration for a function that is not
`SECURITY DEFINER` would be a schema change with no security benefit.

### 7.2 Active-key uniqueness

`000016_developer_publisher_provisioning.sql:93` creates a partial unique
index:

```sql
CREATE UNIQUE INDEX publisher_keys_active_env_key
  ON public.publisher_keys (publisher_id, key_env)
  WHERE revoked_at IS NULL AND key_env IS NOT NULL;
```

Covered by `tests/db/publisher-keys-active.test.js` (7 tests): one active key
per `(publisher_id, key_env)`; a rejected insert leaves the original row
byte-identical; revoking frees the slot; `test` and `live` coexist; the
constraint is per-publisher; rows with `key_env IS NULL` do not collide with
each other or with a scoped key; and the index definition in `pg_indexes`
matches the migration.

`supabase/functions/publisher_keys/index.ts` now maps that violation to
`409 KEY_EXISTS` with the existing key's metadata and the recovery sentence
"Revoke it before creating a replacement." Previously both the `createKey`
helper and the POST handler collapsed a duplicate to a 500, so a developer
clicking "create key" twice got an opaque failure for something that is not a
fault. The 409 payload is metadata only — it never contains `key_hash` or a raw
key, and `tests/publisher-keys-contract.test.js` asserts both.

### 7.3 Body-size and rate limiting

- `_shared/http.ts` has `MAX_REQUEST_BODY_BYTES = 128 * 1024` and
  `readJsonObjectBody()`, which pre-checks `content-length` and caps the read.
  Over-sized or malformed bodies return `413 PAYLOAD_TOO_LARGE`.
- `x-clirevenue-publisher-key` is now in the CORS allow-headers list. Without
  it, a browser caller could not send the header at all.
- `createRateLimiter` gained a `maxKeys` bound on its map, so a limiter keyed by
  an attacker-controlled value cannot grow without limit. This was an unbounded
  map and a slow memory leak, not a correctness bug.
- `get_active_campaign` gained `rateLimitPublicRead` (60 burst, 1/s refill,
  10 000 keys), keyed by `x-forwarded-for` only when there is exactly one hop —
  an absent or multi-hop header falls back to a shared `unknown` bucket, which
  is intentionally conservative. A spoofed single-value header can still
  evade the limit; this is the standard trade for a function that must not
  authenticate the caller.
- `telemetry` decisions were extracted from inline handler code into
  `_shared/telemetryRecord.ts` with the secret and limiter injected, and are
  covered by 43+ steps. The invariant it protects: **no `Authorization` header
  reaches the telemetry insert path at all.**

---

## 8. Rate-limit limitations, stated plainly

These limits are per-isolate and in-memory. They bound a single warm instance's
misuse; they do not bound a fleet.

- **Per-isolate, so the effective limit scales with instance count.** Under
  horizontal scale the real ceiling is roughly `limit x instances`. Nothing here
  enforces a global cap.
- **A cold start resets every bucket.** Restarting the function resets the
  token buckets, so "wait N seconds" is only true within one instance's
  lifetime.
- **A spoofed single-hop `x-forwarded-for` produces a fresh key per request.**
  `get_active_campaign` deliberately does not trust this header, but neither can
  it reject a well-formed lie. Any limit here should be treated as a speed bump,
  not an access control.
- **`x-forwarded-for` is only trusted when there is exactly one hop.** The
  common misconfiguration is trusting the client's first value; that was the
  bug being fixed.
- **No limiter covers every function.** The ones covered were chosen by the
  audit. A function with no limiter has no limit at all.

None of this replaces per-publisher or per-account limits enforced in the
database, which are the ones that hold regardless of instance count.

---

## 9. Deprecation plan

| Item | Status | Plan |
| --- | --- | --- |
| `test_secret`, `test_edge` Edge Functions | **Removed** | Were untracked and gitignored, which is why no test or reviewer noticed. `tests/security-invariants.test.js` now pins their absence, pins that no function source returns `secretPreview` / `secretLength`, and names every shipped function so an unexpected directory shows up in a diff. |
| Publisher key in the URL query string | **Removed** | `cli` and the CLI now send it as `x-clirevenue-publisher-key`. A credential in a query string lands in gateway logs, proxy logs and shell history. `readPublisherKey()` prefers the header and falls back to the query only for callers that have not migrated. The query fallback is the deprecation: remove it once no deployed caller sends the key that way. |
| `config.placements` (config v1) | **Superseded by v2** | Read-time migration in `src/project/config.ts` maps each v1 placement to one integration with one slot. Reading does not rewrite the file; the next write does. |
| `clirevenue@1.0.0` on npm | **Stale** | It is a pre-redesign snapshot: it still prompts for a placement preset and an ad size, and has no `editor` or `keybindings` command. Publishing a newer version is the only fix and requires explicit authorisation. |
| `AD_TOKEN_SECRET` | **UNKNOWN** | See `DEPLOYMENT_CHECKLIST.md` §4. Rotate if presence is found. |

---

## 10. Provenance

**The deployed backend is not HEAD, and nothing in this repository has been
deployed.**

- This checkout's HEAD is `838aaa6`, branch `backend-real-delivery`.
- `supabase/.temp/` records a linked project ref, but there is no `.supabase/`
  directory and no deploy was attempted from here. The runbook's production
  state at the top of this document was written on 2026-09-30 against HEAD
  `054c68b` and migrations `000008`–`000015`. The newest migration in this tree
  is now `000023`, and **how far production has advanced is unverified.**
- `POST /cli/placements` and the `x-clirevenue-publisher-key` header are
  implemented and tested in source but are **not deployed**. Any flow that
  creates a placement, or any CLI build that sends the header, fails against
  the deployed API.
- Every "verified" claim in §7 comes from a local run against PGlite or the
  local test suite. PGlite is not production Postgres and every file replays all
  migrations, so a clean local run is necessary but not sufficient evidence for
  a production apply.

No commit, push, publish, migration, or deploy has been performed.
