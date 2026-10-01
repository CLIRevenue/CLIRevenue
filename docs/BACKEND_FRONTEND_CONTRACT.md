# Backend-Frontend API Contract

This document describes the exact request/response structures that the frontend expects from the backend. The frontend currently uses a mock store (`lib/economyStore.js`) and we will replace those calls with API endpoints.

## Authentication

All endpoints (except where noted) require a valid Supabase Auth JWT in the `Authorization` header: `Bearer <token>`.

The frontend is responsible for handling user authentication via Supabase Auth (sign up, sign in, etc.). Once authenticated, the user's role (advertiser, developer, admin) is stored in `user_role` in the `profiles` table (or via app metadata).

## Campaign Management

### Get Campaign List (Advertiser)
- **Endpoint**: `GET /api/campaigns`
- **Description**: Returns a list of campaigns belonging to the authenticated advertiser.
- **Response**:
  ```json
  {
    "campaigns": [
      {
        "id": "string (uuid)",
        "name": "string",
        "headline": "string",
        "description": "string",
        "cta": "string",
        "audience": "string",
        "budget_cents": "integer",
        "spend_cents": "integer",
        "impressions_count": "integer",
        "clicks_count": "integer",
        "conversions_count": "integer",
        "status": "string (draft|active|paused|completed|archived)",
        "created_at": "string (ISO timestamp)",
        "updated_at": "string (ISO timestamp)"
      }
    ]
  }
  ```

### Create Campaign (Advertiser)
- **Endpoint**: `POST /api/campaigns`
- **Description**: Creates a new campaign for the authenticated advertiser.
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "headline": "string (required)",
    "description": "string (optional)",
    "cta": "string (optional, default: 'Learn more')",
    "audience": "string (required, must be one of: backend, frontend, devops, data, oss)",
    "budget_cents": "integer (required, > 0)"
  }
  ```
- **Response** (201 Created):
  ```json
  {
    "id": "string (uuid)",
    "name": "string",
    "headline": "string",
    "description": "string",
    "cta": "string",
    "audience": "string",
    "budget_cents": "integer",
    "spend_cents": "integer",
    "impressions_count": "integer",
    "clicks_count": "integer",
    "conversions_count": "integer",
    "status": "string",
    "created_at": "string (ISO timestamp)",
    "updated_at": "string (ISO timestamp)"
  }
  ```

### Get Active Campaign (Any Authenticated User)
- **Endpoint**: `GET /api/active-campaign`
- **Description**: Returns an eligible campaign to serve. Selection is over the **eligible set**, not a single global pointer — eligibility is status, schedule, remaining budget, and optional audience match, resolved against the campaign row itself. Candidates are ordered deterministically (`created_at ASC`, then `id ASC`) within a 25-campaign window. There is no longer a platform-wide "active campaign" that one advertiser's click could change for everyone else.
- **Query Parameters**:
  - `audience`: `string` (optional) — restrict candidates to this audience.
  - `campaign_id`: `string (uuid)` (optional) — delivery context. If this campaign is not eligible, the response is 404 with a reason, which is distinguishable from "nothing eligible".
- **Response**:
  ```json
  {
    "id": "string (uuid)",
    "name": "string",
    "headline": "string",
    "description": "string",
    "cta": "string",
    "audience": "string",
    "budget_cents": "integer",
    "spend_cents": "integer",
    "impressions_count": "integer",
    "clicks_count": "integer",
    "conversions_count": "integer",
    "status": "string",
    "created_at": "string (ISO timestamp)",
    "updated_at": "string (ISO timestamp)"
  }
  ```
  Returns 404 with `NO_FILL` if no campaign is eligible for the request.

### Select Campaign (Advertiser)
- **Endpoint**: `POST /api/campaigns/:id/select`
- **Description**: Validates that `:id` belongs to the authenticated advertiser and echoes the campaign back. **This no longer writes any server state** — campaign selection is per-advertiser local UI state, and the frontend keeps it in `activeCampaignId`. This endpoint previously wrote a single global `platform_settings.active_campaign_id`, which meant the last advertiser to press "select" decided what every publisher on the network was served. The route is retained so stale callers get a correct answer rather than a 404.
- **Parameters**: `:id` is the campaign UUID.
- **Errors**: 404 if the campaign does not exist or is not owned by the caller.
- **Response** (200 OK):
  ```json
  {
    "campaign": { "...": "campaign object, same shape as the list" },
    "selected": true,
    "global": false
  }
  ```

### Get Campaign by ID (Advertiser)
- **Endpoint**: `GET /api/campaigns/:id`
- **Description**: Returns a single campaign if it belongs to the authenticated advertiser.
- **Parameters**: `:id` is the campaign UUID.
- **Response**: Same as the campaign object in the list.

## Ad Serving

### Get Ad to Serve
- **Endpoint**: `GET /api/ads/serve`
- **Description**: Returns an eligible ad for the given CLI integration and session. The frontend uses this to decide what ad to display in the sponsored slot.
- **Query Parameters**:
  - `cli_integration`: `string` (e.g., 'claude-code', 'codex') - required
  - `session_id`: `string` (unique identifier for the developer's session) - required
- **Response** (200 OK):
  ```json
  {
    "ad": {
      "id": "string (uuid)",
      "campaign_id": "string (uuid)",
      "advertiser": "string",
      "brand": "string",
      "headline": "string",
      "body": "string",
      "cta": "string",
      "creative_url": "string (optional, if creatives are stored externally)"
    },
    "impression_token": "string (idempotency key for recording the impression)"
  }
  ```
  If no eligible campaign is found, returns 204 No Content or an empty ad object? The frontend expects an ad object; we can return null for ad and no impression_token? Let's see the frontend: in Workbench, it calls `getActiveCampaign` and then uses that campaign to render the slot. However, we are changing to an ad serving endpoint that selects a campaign. We must maintain the frontend's expectation that there is always an active campaign set by the advertiser console. Therefore, we can keep the active campaign concept and have the ad serving endpoint return that active campaign if it is eligible (active, budget remaining). Otherwise, we return no ad.

  However, the frontend's Workbench uses `getActiveCampaign` directly, not an ad serving endpoint. We have two options:
  1. Keep the frontend as is and change only the backend implementation of `getActiveCampaign` to fetch from the database (and the active campaign is set via an API endpoint).
  2. Introduce an ad serving endpoint and change the frontend to use it.

  The user said: "Do NOT redesign or modify the frontend." So we must not change the frontend. Therefore, we must keep the frontend's current calls: `getActiveCampaign`, `recordImpression`, `recordQualifyingEvent`.

  Thus, we cannot change the frontend to use an ad serving endpoint. We must keep the active campaign concept.

  Therefore, we will keep the active campaign as a global setting (set by the advertiser via selectCampaign). The workbench will always display the active campaign (if set). The ad serving logic (eligibility checks) will happen when recording impressions and interactions? Actually, the frontend records an impression every time the slot becomes visible (on screen). We need to ensure that we only count impressions for eligible campaigns (active, budget not exhausted). We can do that in the impression recording endpoint.

  So we will keep:
  - GET /api/active-campaign
  - POST /api/events/impression
  - POST /api/events/interaction

  And the frontend will continue to work as is.

  However, we must ensure that if the active campaign is not eligible (e.g., paused, budget exhausted), then recording an impression should not succeed (or should not count). We can return an error or silently ignore. The frontend does not handle errors from recordImpression (it doesn't check the return value). So we can make the impression endpoint do nothing if the campaign is not eligible.

  But we also need to prevent spending budget when there is none. We'll check in the impression endpoint: if the campaign is active and has remaining budget, we record the impression and decrement the remaining budget? Actually, we track spend separately. We'll increment impressions_count and maybe later calculate spend based on CPM? In the mock, spend is not tied to impressions; it's a separate simulated value. We'll need to decide how to model spend.

  Looking at the mock: spend_cents is updated independently (not based on impressions). In the seed data, spend is set to a fixed number. In the mock economyStore, when an impression is recorded, it does not update spend. It only updates impressions_count. Similarly, interaction updates clicks_count. Spend is only updated when creating a campaign (set to the budget) and then manually in the seed data? Actually, in the mock, spend is never updated except in the seed data. The mock economyStore does not update spend when recording impressions or interactions.

  Therefore, we will not update spend in the impression or interaction endpoints. We will leave spend as a field that the advertiser can update (maybe via a separate API) or we can compute it based on impressions and a fixed CPM? But the mock treats spend as independent.

  To keep the frontend working without changes, we must not change the data that the frontend expects. The frontend uses the campaign object from `getActiveCampaign` and displays:
    - budget (from budgetCents)
    - spend (from spendCents)
    - impressions (from impressionsCount)
    - clicks (from clicksCount)
    - conversions (from conversionsCount)

  And it computes CTR, CVR, etc.

  Therefore, we must update impressions_count and clicks_count when recording impressions and interactions, but we do not update spend_cents. Spend_cents will remain as set when the campaign is created (or updated via a separate API if we allow the advertiser to update it). In the mock, the advertiser cannot update spend; it's only set on campaign creation.

  We'll allow the advertiser to update the campaign's budget (and thus spend? Actually, in the mock, spend is separate from budget. The mock has a budgetCents and spendCents. In the seed data, spend is less than budget. We'll treat spend as the amount spent so far, which should increase as ads are served. However, the mock does not auto-increment spend. We'll need to decide on a billing model.

  Since the user said "Do not implement real payment processing yet", we can keep spend as a manual field for now, or we can tie it to impressions with a fixed CPM (cost per mille) that is set per campaign. But to avoid changing the frontend, we can keep spend as a field that is only updated when the campaign is created (and maybe updated via an API we create for the advertiser to update spend manually). However, the frontend does not have an interface to update spend.

  Looking at the AdvertiserConsole, there is no field to edit spend. The advertiser only sets budget. The spend is shown as a read-only field.

  In the mock, spend is set to a fixed number in the seed data and never changes. This is unrealistic.

  We have two options:
  a) Implement a simple billing model: each impression costs a fixed amount (e.g., $0.01 CPM -> $0.00001 per impression). Then we can increment spend_cents by that amount per impression. We'll need to store the CPM in the campaign.
  b) Keep spend as a manual field that the advertiser can update via an API (but the frontend doesn't have a UI for it, so we would need to add UI? But we cannot change frontend.)

  Since we cannot change the frontend, we must keep the frontend's expectation that spend is a field that exists and is displayed. We can leave it as is (only set on campaign creation) and not update it automatically. Then the spend will not reflect reality, but the frontend will still work.

  However, the user wants us to turn the simulated backend into a real backend. We should at least make spend reflect the actual cost. We can add a CPM field to the campaign (in cents per mille impressions) and then compute spend as impressions_count * CPM / 1000. But we must not change the frontend's expectation of the campaign object: it expects a `spend_cents` field. We can compute it and return it in the API.

  We'll add a `cpm_cents` field to the campaign (cost per mille impressions in cents). Then when we record an impression, we increment impressions_count and also add to spend_cents: `spend_cents += cpm_cents / 1000` (but we need to handle fractions: we can keep spend_cents as integer and use fixed-point arithmetic, or we can round per impression). To avoid floating point, we can accumulate in milli-cents? Or we can update spend_cents only when impressions reach a threshold.

  Alternatively, we can store spend_cents as the total cost in cents and update it with each impression using integer math: let CPM be in microcents per impression? Let's define:

    Let CPM be in cents per 1000 impressions.
    Cost per impression = CPM / 1000 cents.

    To keep integer cents, we can accumulate the cost in milli-cents (1/1000 cent) and then convert to cents when needed? But we must return spend_cents as integer cents.

  We can store spend_cents as integer cents and update it as: spend_cents += (CPM * impressions_delta) / 1000, but we need to round.

  Since we are not required to implement real payment processing, we can keep it simple and not auto-update spend. We'll leave spend_cents as set on campaign creation and allow the advertiser to update it via an API (but we won't build the frontend UI for it). However, the frontend does not call any API to update spend.

  We'll decide later. For now, to match the mock exactly, we will not update spend_cents in the impression or interaction endpoints. We will only update impressions_count and clicks_count.

  We'll note this as a limitation and maybe improve in a future iteration.

  For the ad serving contract, we will keep the existing frontend calls and not introduce a new ad serving endpoint. Instead, we will keep the active campaign concept.

  Therefore, the ad serving flow is implicit: the frontend displays the active campaign, and when it records an impression or interaction, we update the counts.

  We'll need to ensure that we only allow impressions and interactions if the campaign is active and has not exhausted its budget (if we decide to model budget). We'll check the budget_cents and spend_cents: if spend_cents >= budget_cents, then we should not record more impressions or interactions.

  We'll implement that in the impression and interaction endpoints.

  Let's proceed with the contract as per the existing frontend calls.

### Record Impression
- **Endpoint**: `POST /api/events/impression`
- **Description**: Records an impression for the active campaign (or any campaign? The frontend passes the campaignId from the active campaign). We'll use the campaignId to verify eligibility.
- **Request Body**:
  ```json
  {
    "campaign_id": "string (uuid)",
    "cli_integration": "string",
    "session_id": "string",
    "idempotency_key": "string (unique identifier to prevent duplicate impressions)"
  }
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "impression_id": "string (uuid)"
  }
  ```
  If the campaign is not active, or budget exhausted, or idempotency key already used, we return an appropriate error (400 or 409).

### Record Interaction
- **Endpoint**: `POST /api/events/interaction`
- **Description**: Records an interaction (click) and accrues a reward.
- **Request Body**:
  ```json
  {
    "campaign_id": "string (uuid)",
    "cli_integration": "string",
    "session_id": "string",
    "idempotency_key": "string (unique identifier to prevent duplicate interactions)",
    "impression_id": "string (uuid, optional, the impression that led to this interaction)"
  }
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "interaction_id": "string (uuid)",
    "reward_accrued": {
      "id": "string (uuid)",
      "amount_cents": "integer",
      "status": "accrued",
      "created_at": "string (ISO timestamp)"
    }
  }
  ```
  If the campaign is not active, or budget exhausted, or idempotency key already used, return error.

## Rewards and Balance

### Get Balance (Developer)
- **Endpoint**: `GET /api/rewards/balance`
- **Description**: Returns the balance summary for the authenticated developer.
- **Response**:
  ```json
  {
    "available_cents": "integer",
    "pending_cents": "integer",
    "lifetime_cents": "integer",
    "reserved_cents": "integer"
  }
  ```

### Get Reward Ledger (Developer)
- **Endpoint**: `GET /api/rewards`
- **Description**: Returns a list of reward ledger entries for the authenticated developer, ordered by most recent.
- **Query Parameters**:
  - `limit`: `integer` (optional, default 10)
  - `offset`: `integer` (optional, default 0)
- **Response**:
  ```json
  {
    "rewards": [
      {
        "id": "string (uuid)",
        "campaign_id": "string (uuid)",
        "amount_cents": "integer",
        "status": "string (accrued|available)",
        "created_at": "string (ISO timestamp)",
        "settled_at": "string (ISO timestamp, nullable)"
      }
    ]
  }
  ```

### Request Payout (Developer)
- **Endpoint**: `POST /api/payouts/request`
- **Description**: Requests a payout of the available balance (mock, no real payment processing).
- **Request Body**:
  ```json
  {
    "amount_cents": "integer (required, > 0 and <= available_cents)",
    "provider_id": "string (optional, defaults to 'demo-ledger')"
  }
  ```
- **Response** (200 OK):
  ```json
  {
    "payout": {
      "id": "string (uuid)",
      "amount_cents": "integer",
      "status": "string (requested)",
      "created_at": "string (ISO timestamp)"
    },
    "transaction": {
      "id": "string (uuid)",
      "type": "string (payout)",
      "amount_cents": "integer",
      "status": "string (requested)",
      "created_at": "string (ISO timestamp)"
    }
  }
  ```
  Returns 400 if amount invalid or insufficient balance.

## Account Connection (via Supabase Auth)

The frontend's `connectAccount` and `disconnectAccount` are mocked. In the real app, we will use Supabase Auth session.

- To check if connected: the frontend can check the auth state.
- We will not provide API endpoints for connect/disconnect; instead, we rely on the user's auth session.

However, the frontend uses `economy.account.connected` to display connection status. We can replicate that by having a `/api/auth/status` endpoint or by checking the presence of a user.

We'll add:
- **Endpoint**: `GET /api/auth/status`
- **Description**: Returns the authentication status and user profile.
- **Response** (if authenticated):
  ```json
  {
    "user": {
      "id": "string (uuid)",
      "email": "string",
      "role": "string (advertiser|developer|admin)"
    },
    "connected": true
  }
  ```
  If not authenticated, returns 401 or { connected: false }.

We'll leave it to the frontend to call this endpoint to set the connection status.

## Error Handling

All error responses will be in the format:
```json
{
  "error": {
    "message": "string",
    "code": "string (optional)"
  }
}
```
with appropriate HTTP status codes.

## Idempotency

For impression and interaction endpoints, the `idempotency_key` must be unique per developer per campaign. We will check for duplicates and return 409 Conflict if already recorded.

## Rate Limiting

We will implement rate limiting on public endpoints (impression, interaction, ad serving) to prevent abuse. Limits will be defined per IP address or per API key.

## Future Extensions

When we are ready to implement real ad serving with eligibility checks, we can introduce an ad serving endpoint and change the frontend to use it (but that would require frontend changes, which we are not allowed to do now). Therefore, we will keep the active campaign model for now and note that in the future, if we want to change the ad serving algorithm, we may need to work with the frontend team to introduce a new endpoint.