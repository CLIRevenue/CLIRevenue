# Multi-tenant campaign selection — design note

Phase 2D. Removes the single global `platform_settings.active_campaign_id`
pointer, which is incompatible with more than one advertiser.

## 1. What the current architecture actually is

Traced exhaustively (every reference in the repo):

| Site | Operation |
|---|---|
| `000001_init_schema.sql:86-95` | `platform_settings (id, active_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL, updated_at)` — singleton row, seeded NULL |
| `000002_seed_data.sql:14` | re-seeds the singleton row, `active_campaign_id` NULL |
| `000004_rls_policies.sql:40-45` | RLS on; SELECT for any signed-in user; **UPDATE allowed to any `advertiser` or `admin`** |
| `campaigns/index.ts:220-236` | `POST /<id>/select` → writes the global pointer |
| `campaign_select/index.ts:33-46` | legacy function, same write |
| `get_active_campaign/index.ts:42-57` | **reads** the pointer, loads that one campaign by id |
| `economyStore.js:46,177` | reads the pointer on init as a UI hint |
| `economyStore.js:200,224` | `selectCampaign` / `createCampaign` set it locally *after* the server write |

Answers to the six questions:

1. **Who can write it** — any authenticated `advertiser` or `admin`, via
   `campaigns` `POST /<id>/select` (ownership-checked first at
   `campaigns/index.ts:197`) or the legacy `campaign_select`. Directly, via the
   RLS policy, any `advertiser`/`admin` may update the row.
2. **Who can read it** — `get_active_campaign` (unauthenticated, it is the
   delivery endpoint) and any signed-in user per the SELECT policy.
3. **How delivery uses it** — `get_active_campaign` reads the pointer and
   loads exactly that campaign, then applies eligibility. One campaign can be
   delivered to every publisher on the platform.
4. **Is selection global** — yes. There is exactly one pointer row, so the last
   advertiser to call `select` decides what the entire network serves.
5. **Does the frontend depend on it** — only weakly. `getActiveCampaign()`
   (`economyStore.js:485`) resolves `activeCampaignId` *within
   `snap.campaigns`*, which `fetchCampaigns()` already scopes to the caller's
   own advertiser. A foreign id fails `find()` and falls back to
   `campaigns[0]`. So the pointer never determines what the console records.
6. **Does removing it break a legitimate flow** — no. The only behaviour lost
   is "which of my campaigns the console highlights first", which is local UI
   state and belongs in local state.

## 2. Target

```
CURRENT:
  advertiser -> select campaign -> global active_campaign_id -> delivery

TARGET:
  advertiser-owned campaigns (status/schedule/budget/audience)
      -> eligible-campaign selection per delivery request
      -> delivery
```

`status = 'active'` already carries "this campaign is live". The global pointer
duplicates that meaning and attaches it to shared mutable state, which is the
entire problem. Removing it leaves eligibility expressed on the row it applies
to.

**When several campaigns are active at once**, each delivery request picks one
deterministically from the eligible set. `get_active_campaign` already computes
status, schedule, budget and audience eligibility; it only had to filter to a
single id first. That filter is what goes. Order is `created_at ASC, id ASC` —
stable, so repeated identical requests return the same campaign, and
deterministic, so nothing about delivery depends on hidden global state.

Fairness, rotation, weighting and bidding are explicitly **out of scope** for
MVP. `created_at ASC` gives oldest-first delivery until a budget is exhausted,
which is a real policy and not an accident; it is the seam where a proper
allocation policy will go.

Delivery context for MVP is the request itself: `?audience=` (existing) and
`?campaign_id=` (new hint). `?campaign_id=` is the minimum stand-in for
placements — it lets a publisher-side caller name the campaign it wants
without introducing a `placements` table. Both are filters on the same
eligible-campaign query.

## 3. Isolation properties this buys

- Advertiser A's activation is a column on A's own row. It cannot be observed
  by, or constrain, B.
- There is no shared mutable delivery state left to race on.
- `campaigns/index.ts` still resolves ownership before acting, and
  `protect_campaign_accounting` still guards the accounting columns.
- `active_campaign_id` is removed by migration, so no code path — including a
  direct PostgREST write under the old RLS policy — can reintroduce it.

## 4. Migration

`000012_remove_global_active_campaign.sql`:

- revoke the advertiser/admin UPDATE policy on `platform_settings`
- drop the `active_campaign_id` column

The table itself is kept. After this change it holds only `id` and
`updated_at`; it can be dropped once confirmed unused, but dropping a table is
not required to remove the cross-tenant state and is not done here.
