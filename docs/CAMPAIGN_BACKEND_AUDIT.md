## 10. Implementation state (baseline — NOT resumed: this phase's audit)

Audited 2026-09-30 against the local checkout plus a read-only probe of the
deployed project. The following was produced by the interrupted parallel
session. Changes are UNCOMMITTED.

### Migration 000008_campaign_lifecycle.sql
- Written and audited (postgreSQL syntax); additive only (indexes, ledger_events
  columns, interaction_kind += 'conversion', protected-column trigger, REVOKE
  INSERT/UPDATE on events tables from authenticated roles, SECURITY DEFINER
  apply_impression / apply_interaction RPCs, RLS policy grants).
- **NOT APPLIED** to the remote database (`migration list` shows the remote
  `000008` column blank; only 000001–000007 are live).

### Edge Functions (local rewrite vs deployed reality)
| Local file | Deployed? | What the probe showed |
|---|---|---|
| campaigns/index.ts | NO | Deployed `campaigns` v2 (2026-09-29 11:27) is the OLD code: `{"error":"Invalid token"}` / `{"error":"Failed to load..."}` string contract; no role enforcement; no state machine; no archive/select. |
| events/index.ts | NO | Function `events` not found on the project (`404: Requested function was not found`). Endpoint `/functions/v1/events/...` never answers. |
| record_impression | NO | Deployed version is OLD: returns `500: {"error":"Internal server error","details":"supabaseUser.auth.setAuth is not a function"}` for every request (deprecated supabase-js v1 API). |
| record_interaction | NO | Same as above (old code + the old `supabaseUser.auth.setAuth` path). |
| campaign_select | NO | Deployed version old (`setAuth` 500), does not enforce servability or UUID validation. |
| get_active_campaign | NO | Deployed version returns the old `{"error":"No active campaign set"}` string contract, does not check `servable`, does not require auth at all. |
| _shared/* (auth/http/events/campaignRules) | NO | New TS modules written locally; not deployed. Note: `auth/index.ts` deployed is also old (deprecates `supabaseUser.auth.setAuth`). |

### Frontend (local rewrites)
- Variables/contracts: `campaignErrors.js`, `campaignRules.js`,
  `advertiserApi.js` (archive/select, audience resolution, MAX_BUDGET_CENTS,
  `conversionRatePct`), `useAdvertiserCampaigns.js` (upsert), and the
  advertiser dashboard components (create via POST, PATCH with field filters,
  status select constrained to legal next states, archive in both places,
  error mapping through `campaignErrorMessage`) were edited locally.
- Exported helpers that were never wired: `eventSessionId`,
  `eventEndpoints`, `isCampaignUuid` (in `economyStore.js`); the event
  senders were left using the old `/api/events/impression|interaction`
  paths with only `{campaign_id}` in the body, so no event ever reaches the
  deployed/working backend.

### Deployment status (verified by read-only HTTP probes 2026-09-30)
1. **Migration 000008:** NOT applied remotely.
2. **Edge Functions:** legacy code is live for `campaigns`,
   `record_impression`, `record_interaction`, `campaign_select`, `get_active_campaign`;
   the `events` function is absent entirely. The new rewrite (with role
   enforcement, state machine, archive/select, servability checks, SECURITY
   DEFINER apply_impression/apply_interaction) must be re-deployed for this
   phase to function.
3. **Frontend contract paths:** `advertiserApi.js` already routes to `<fn>/<...>`
   layouts; `economyStore.js` still targets `<fn>/api/events/...` and `<fn>/api/...`
   layouts and would 404 today. Fix is required for phases 6–9.

## 11. Consensus on remaining work (from the audit)

Phases 1–5 and 11–12 are effectively implemented by the local rewrite
(schema/migration, ownership, CRUD API, state machine, budget validation,
CPM integer accounting, ledger columns); phases 13–18 are implemented in the
UI by the same session; phases 19–23 require the checks below, executed and
documented. Nothing in this phase duplicates the existing architecture.
