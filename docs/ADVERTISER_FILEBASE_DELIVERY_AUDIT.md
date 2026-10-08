# Advertiser + Filebase + Real Delivery — Phase 0 Audit

Status: audit of the existing CLIRevenue backend as it stood before any change.
Scope: advertiser campaign creation, creative storage, and the ad-delivery path.
This document **references** — and does not duplicate — `docs/CAMPAIGN_BACKEND_AUDIT.md`
(campaign backend hardening history) and `docs/MULTI_TENANT_CAMPAIGN_SELECTION.md`
(server-side multi-tenant campaign selection).

---

## 1. Existing campaign schema

Source of truth: `supabase/migrations/000001_init_schema.sql`, hardened by
`000008_campaign_lifecycle.sql`, `000010_campaign_backend_security.sql`,
`000012_remove_global_active_campaign.sql`, `000014_publishers_placements_serve_log.sql`.

`public.campaigns`:

| column | type | notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `advertiser_id` | `uuid` → `advertisers(id)` ON DELETE CASCADE | ownership anchor |
| `name` | `text` NOT NULL | |
| `headline` | `text` NOT NULL | doubles as the ad copy today |
| `description` | `text` | |
| `cta` | `text` DEFAULT `'Learn more'` | |
| `audience_id` | `text` → `audiences(id)` NOT NULL | platform vocabulary, not client-defined |
| `budget_cents` | `int` CHECK `>= 0` | |
| `cpm_cents` | `int` DEFAULT `10` | price per impression, milli-cent scaled via `spend_milli_cents` |
| `spend_milli_cents` | `int` DEFAULT `0` | server-owned |
| `impressions_count` / `clicks_count` / `conversions_count` | `int` CHECK `>= 0` | server-owned |
| `status` | `campaign_status` | `draft,active,paused,completed,archived` |
| `starts_at` / `ends_at` | `timestamptz` | nullable = always in window |
| `landing_url` | `text` | added by `000014`; **nullable, advertised destination only, not signed/attribution-carrying** |
| `created_at` / `updated_at` | `timestamptz` | trigger `update_campaigns_updated_at` |

Money and counters are structurally protected:

- `protect_campaign_accounting()` — a `BEFORE UPDATE` trigger that resets
  `advertiser_id`, `spend_milli_cents`, `impressions_count`, `clicks_count`,
  `conversions_count`, `created_at` back to `OLD` for `authenticated`/`anon`.
- `REVOKE INSERT, UPDATE, DELETE ON campaigns FROM authenticated` (only `SELECT`
  survives), plus `REVOKE ALL FROM anon`.
- `apply_impression(...)` / `apply_interaction(...)` are `SECURITY DEFINER`
  and granted `EXECUTE` to `service_role` **only**.
- `platform_settings.active_campaign_id` was **removed** by `000012`. Campaign
  selection is server-side; there is no global "the one active campaign".

`public.audiences` is platform-controlled: RLS enabled with a single
`SELECT USING (true)` policy, `INSERT/UPDATE/DELETE` revoked from `anon` and
`authenticated`. Clients select an audience id, they cannot invent one.

## 2. Existing creative schema

**A `campaign_creatives` table exists — but it carries no asset.**

`000021_telemetry_event_model.sql` creates it as a *stable creative identity*, not a
media record:

```sql
CREATE TABLE IF NOT EXISTS public.campaign_creatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Three columns. No object key, no MIME type, no size, no media type, no status, no
dimensions. The table's job, per its own `COMMENT`, is that the creative "survives
in-place campaign edits so delivery attribution does not drift when copy changes".

Two triggers already depend on it, and both must keep working:

- `tg_campaign_creative_mint()` — `AFTER INSERT ON campaigns`, mints the row for every
  new campaign. Its `ON CONFLICT` is only valid because `campaign_id` is `UNIQUE`.
- `tg_ad_serve_log_set_creative()` — `BEFORE INSERT ON ad_serve_log`, resolves the
  campaign's creative into `ad_serve_log.creative_id`. Its comment states the rule the
  whole task turns on: *"Creative actually served. Resolved server-side from the
  campaign; never taken from a request body."*

`telemetry_events.creative_id` also references it.

So the design consequence is forced: **extend the existing table, never replace it.**
The correct shape is one-creative-per-campaign with nullable asset columns, because the
mint trigger creates the row *before* any file exists. A row born in status `pending`
means "this campaign has nothing to serve yet", which is exactly the fact the Phase 6
activation gate has to test.

What "creative" means today is only text: `headline`, `description`, `cta`,
`landing_url`. There is no image, no video, no media asset, no file, no upload — so
`ads/deliver` has nothing binary to return.

## 3. Current upload capabilities

None. There is:

- no storage bucket in the frontend, no `supabase.storage` usage for creatives;
- no multipart/streaming upload path in any client;
- no object-storage SDK dependency in `package.json`;
- no `Filebase*` or `S3*` environment variable anywhere (`.env.example`,
  `.env`, `.env.local`, `supabase/functions/_shared/secrets.ts`);
- no upload progress UI in any advertiser surface.

`supabase/functions/_shared/secrets.ts` exports only `constantTimeEqual`.

Filebase is, at present, **planned but not integrated**. `wrangler.toml` is a
static-asset SPA host for `clirevenue` with `not_found_handling = "single-page-application"`;
there is no Cloudflare Worker source directory in the repository. The
"Cloudflare API gateway" is the `api.clirevenue.in` host that fronts the Supabase
Edge Functions, and the routing contract that keeps browser traffic on it is pinned
by `tests/gateway-routing.test.js`.

## 4. Current Filebase integration

None. Filebase appears only as prose in task descriptions. Required configuration
for the new work (all server-side secrets, none of them `VITE_`-prefixed):

```
FILEBASE_ENDPOINT          e.g. https://s3.filebase.com
FILEBASE_REGION            us-east-1
FILEBASE_BUCKET
FILEBASE_ACCESS_KEY_ID
FILEBASE_SECRET_ACCESS_KEY
```

## 5. Current ad delivery response

`supabase/functions/ads/index.ts` → `POST /ads/deliver`:

```
requestId      crypto.randomUUID()
impressionToken  signServeToken(AD_TOKEN_SECRET, {v:1,rid,cid,pid,plid,exp,sv})
expiresAt       now + 30 min
ad              { id, name, headline, description, cta, audience, landingUrl }
```

No-fill is **`204`** with CORS headers and a null body.

`Ad = {id, name, headline, description, cta, audience, landingUrl}` is exactly the
SDK's `Ad` type in `packages/sdk/src/index.ts`, so the response contract and the
SDK type are currently in lockstep — and both are creative-less.

Selection today is genuinely server-side and must not regress:

```
authenticatePublisher(admin, body.publisherKey, body.placementKey)   // sha256 lookup
rateLimitDelivery(publisherId)                                       // 429 + retry_after_ms
require identity.placementId                                         // 400
require AD_TOKEN_SECRET                                              // 503
SELECT ... FROM campaigns
  WHERE status = 'active'
  [AND audience_id = placement.allowed_audience_id]
  ORDER BY created_at, id
  LIMIT 25
find(c => isEligible(c, now))                                        // schedule + budget
INSERT INTO ad_serve_log (...campaign_id, cost_milli_cents...)
sign + respond
```

`isEligible` (`_shared/eligibility.ts`) = `status === 'active'` AND `withinSchedule`
AND `withinBudget` (`spend_milli_cents < budget_cents * 1000`, milli-cent units).

Tracking is separate and already fully server-authoritative:

- `/ads/impression` → `record_serve_impression(...)` RPC
- `/ads/click` → `record_serve_click(...)` RPC (requires a prior impression)
- `/ads/conversion` → `record_serve_conversion(...)` RPC
- `authorizeServe` (`_shared/serveAuthz.ts`) verifies the HMAC token, that
  `requestId` matches the token's `rid`, and that `pid` matches the authenticated
  publisher — in that order, so an invalid token is reported before any request-id
  comparison and serve ids cannot be enumerated.
- **No tracking RPC accepts a `campaign_id`.** The campaign is resolved inside the
  RPC from the `ad_serve_log` row. This is the invariant the whole accounting model
  rests on, and `tests/db/delivery.test.js` already pins it.

## 6. Missing links (the gap list)

| # | Gap | Where it must be closed |
| --- | --- | --- |
| 1 | No creative storage/object model | new migration `000022` |
| 2 | No S3-compatible client | `_shared/filebase.ts` |
| 3 | No advertiser upload API | new Edge Function `creatives` |
| 4 | Campaign activation accepts `draft → active` with only `budget > 0` checked | `campaigns/index.ts` PATCH gate |
| 5 | `campaigns` fn never returns `landing_url`; `cpm_cents` is not create/patchable | `SELECT_COLS`, `campaignRules` allowlists |
| 6 | Delivery has no creative and no creative selection | `ads/index.ts` `handleDeliver` |
| 7 | SDK `Ad` type cannot represent a creative; render emits text only | `packages/sdk/src/index.ts` |
| 8 | Advertiser UI has no upload/wizard/creative surface | `src/components/advertiser/AdvertiserCampaigns.jsx`, `src/lib/advertiserApi.js` |
| 9 | No fixtures/tests for creatives | `tests/db/fixtures.js`, new suites |

## 7. Security concerns

Already handled well and must be preserved:

- `authenticated` cannot `INSERT`/`UPDATE`/`DELETE` on `campaigns`,
  `ad_impressions`, `ad_interactions`, `reward_ledger`, `audiences`.
- `protect_campaign_accounting()` neutralises client accounting writes.
- Publisher keys are stored as SHA-256 hashes only; every auth failure returns the
  same `401 UNAUTHORIZED` so keys cannot be enumerated; revoked keys and suspended
  publishers are excluded by the lookup predicate.
- `ad_serve_log` has RLS enabled with **zero policies**, all grants revoked from
  `anon`/`authenticated`, explicit grants to `service_role`. Only the server writes it.
- `AD_TOKEN_SECRET` is fail-closed: `adTokenSecret()` returns `null` below 16 chars
  and delivery refuses with `503`.

Concerns this work must not introduce:

1. **Service-role Edge Functions bypass RLS.** Any new `creatives`/`campaigns`
   route using `adminClient` must re-derive ownership server-side on **every**
   mutation: JWT → `profiles.role` → `advertisers.id` → `campaigns.advertiser_id`.
   A `campaignId` from the body is an identifier, never an authority.
2. **Browser-supplied `advertiser_id`** must never be read. The existing
   `campaigns` function already ignores it; the new upload path must too.
3. **Presigned URLs are capabilities.** Scope each to exactly one object key, one
   `content-type`, and a short expiry. Never sign a prefix or wildcard. Never return
   the secret or an unsigned public bucket URL.
4. **Object keys must not be user-controlled.** Filenames are attacker input and
   are the classic source of path traversal, key collisions, and content-type
   confusion. Keys are server-constructed from UUIDs only.
5. **`status: "active"` sent straight at PostgREST** is already impossible
   (`UPDATE` revoked). It must also be impossible at the Edge Function, which is
   why activation needs a real readiness check rather than a budget comparison.
6. **HTML creatives** would be stored XSS served from a real origin. Not supported
   in this phase; the media allowlist is `image/*` and `video/*` only.

## 8. Required migrations

One migration, `000022_campaign_creatives.sql`. It is an **ALTER/EXTEND**, not a
`CREATE TABLE` — see §2 for why replacing the table is off the table.

- `creative_status` enum: `pending, uploaded, validated, failed, revoked`.
- `public.advertisers`: `can_run_campaigns BOOLEAN NOT NULL DEFAULT TRUE` — the
  Phase 6 "advertiser is allowed to run campaigns" rule needs a column to live in.
- `public.campaign_creatives` gains, all **nullable** because the mint trigger
  creates the row before any upload exists:
  `advertiser_id uuid → advertisers(id) ON DELETE CASCADE`, `media_type text`,
  `object_key text`, `mime_type text`, `file_size_bytes bigint`, `extension text`,
  `width`/`height`/`duration_ms int`, `poster_object_key text`, `checksum text`,
  `label text`, `status creative_status NOT NULL DEFAULT 'pending'`,
  `updated_at timestamptz NOT NULL DEFAULT NOW()`.
- Conditional CHECKs, so a minted placeholder passes and a lying row cannot:
  `status <> 'validated' OR (advertiser_id, media_type, object_key, mime_type,
  file_size_bytes IS NOT NULL)`; `media_type IS NULL OR IN ('image','video')`;
  MIME allowlist only when `media_type` is set; `file_size_bytes IS NULL OR > 0`;
  poster only on video; dimensions `NULL OR > 0`; and
  `object_key ~ '^advertisers/<uuid>/campaigns/<uuid>/creatives/<uuid>/(original|poster)$'`
  — the traversal and user-filename cases are rejected by the database, not only by
  the Edge Function.
- `CREATE OR REPLACE FUNCTION public.tg_campaign_creative_mint()` now also copies
  `NEW.advertiser_id`, so a slot minted after the migration is never tenant-less.
  The trigger itself is untouched and still relies on `campaign_id UNIQUE`.
- Indexes: `(campaign_id, status)`, `(advertiser_id)`, and
  `UNIQUE (object_key) WHERE object_key IS NOT NULL`.
- `updated_at` trigger via the existing `public.update_updated_at_column()`.
- `public.campaign_activation_blockers(p_campaign_id UUID) RETURNS TEXT[]`,
  `SECURITY DEFINER SET search_path = public`, `GRANT EXECUTE TO service_role` only.
  The rules live in SQL rather than only in TypeScript so readiness is testable
  without an Edge runtime and the two call sites cannot drift. Blockers, in order:
  `CAMPAIGN_NOT_FOUND`, `ADVERTISER_NOT_ELIGIBLE`, `INVALID_AUDIENCE`,
  `INVALID_BUDGET`, `INVALID_CPM`, `INVALID_SCHEDULE`, `SCHEDULE_NOT_STARTED`,
  `SCHEDULE_ENDED`, `INVALID_LANDING_URL`, `BUDGET_EXCEEDED`, `CREATIVE_MISSING`.
- RLS/grants re-asserted idempotently: `ENABLE ROW LEVEL SECURITY`, no policies,
  `REVOKE ALL FROM anon, authenticated`, `GRANT … TO service_role`.

**Migration impact to call out at deploy time.** Any campaign already `active` whose
creative is still an auto-minted `pending` slot becomes ineligible for delivery until
an advertiser uploads and confirms a file. That is the intended consequence of "serve
only real creatives", but it is a visible behaviour change, not a no-op.

## 9. Required Edge Functions

- **new** `supabase/functions/creatives/index.ts`
  - `POST /presign` — authorize an upload: verify advertiser owns `campaignId`,
    validate MIME/size against the allowlist, insert a `pending` creative, return a
    short-lived presigned `PUT` URL bound to the server-derived object key.
  - `POST /confirm` — `HEAD` the object, verify size/content-type, promote
    `pending → uploaded → validated`.
  - `GET /campaigns/:campaignId` — advertiser-scoped list.
  - `DELETE /:creativeId` — revoke the row; delete the Filebase object only when
    the parent campaign is not `active`.
- **modified** `supabase/functions/campaigns/index.ts` — return `landing_url`,
  allow `cpm_cents`/`landing_url`/`starts_at`/`ends_at`, embed normalised
  `creatives[]`, and replace the budget-only activation gate with a real readiness
  check returning `CAMPAIGN_NOT_READY` plus the list of blockers.
- **modified** `supabase/functions/ads/index.ts` — select a real campaign that has
  at least one `validated` creative, skip candidates that do not, generate a
  short-lived presigned `GET` URL for the chosen creative, and add
  `ad.creative` to the response without removing any existing field.
- **new** `supabase/functions/_shared/filebase.ts` — dependency-free SigV4 signer
  on Web Crypto; presign `PUT`/`GET`, `HEAD`, `DELETE`.

## 10. Required frontend changes

- `src/lib/creativeRules.js` — **new**. MIME/size allowlists and human-readable
  validation messages, mirroring the server so the UI can reject before upload.
- `src/lib/advertiserApi.js` — add `requestCreativeUpload`, `confirmCreativeUpload`,
  `fetchCampaignCreatives`, `deleteCampaignCreative`; extend create/patch payloads
  with `landing_url`, `starts_at`, `ends_at`, `cpm_cents`; map `creatives[]` and
  `landing_url` in `normalizeCampaign`.
- `src/components/advertiser/AdvertiserCampaigns.jsx` — step the existing form into
  Details → Audience → Budget & Schedule → Creative, with real upload progress,
  preview, per-creative removal/replacement, save-draft, and activate. Existing
  table/detail markup and CSS classes stay; a small number of new classes go in
  `advertiser.css`.

`AdvertiserOverview.jsx`, `AdvertiserAnalytics.jsx` and `AdvertiserBilling.jsx` are
**already** fully derived from the campaign rows the server returns. No simulated
values exist in the advertiser dashboard today; Phase 11/13 work is limited to
surfacing creatives and using the newly returned fields.

## 11. Required deployment steps

Ordered, and the order is a correctness requirement:

1. `supabase secrets set FILEBASE_ENDPOINT=... FILEBASE_REGION=... FILEBASE_BUCKET=... FILEBASE_ACCESS_KEY_ID=... FILEBASE_SECRET_ACCESS_KEY=...`
2. `supabase db push` — **must precede** steps 3 and 4. `ads` will read
   `campaign_creatives`, and `campaigns` will insert into it.
3. `supabase functions deploy creatives`
4. `supabase functions deploy campaigns ads`
5. Confirm the Edge Functions answer through the public gateway
   (`api.clirevenue.in`), not the internal `functions/v1` base — the same
   distinction `tests/gateway-routing.test.js` pins for telemetry.
6. `npm run build && wrangler pages deploy dist` only for frontend changes.
7. **Do not** publish the SDK. `packages/sdk` is consumed from the workspace;
   `npm publish` is out of scope for this task.

Deploying a function before its migration is the exact defect already recorded in
`tests/gateway-routing.test.js` (the `000021` / `telemetry_session_id` incident).
`handleDeliver` turns any insert failure into `500 INTERNAL_ERROR`, so an
out-of-order deploy here fails loudly at the first request rather than silently.

## 12. What this audit does *not* change

- No second ad-delivery system. `/ads/deliver` stays the only delivery path.
- No change to authentication. Supabase JWTs only.
- No change to `docs/CAMPAIGN_BACKEND_AUDIT.md` or
  `docs/MULTI_TENANT_CAMPAIGN_SELECTION.md`.
- No public-site redesign.
- No `platform_settings.active_campaign_id`, and no client-supplied campaign
  authority anywhere in the delivery or tracking path.