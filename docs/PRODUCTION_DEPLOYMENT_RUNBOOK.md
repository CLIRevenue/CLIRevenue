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
- `000008:41 protect_campaign_accounting` is `SECURITY DEFINER` without a pinned
  `search_path`, but it references no tables, so it is not exploitable. Eleven of the
  twelve definer functions do pin it.
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
