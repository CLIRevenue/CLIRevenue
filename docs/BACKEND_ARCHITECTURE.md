# CLIRevenue Backend Architecture

## 1. Database Architecture

We will use Supabase PostgreSQL with the following tables:

### Users and Profiles
- `auth.users` (provided by Supabase Auth)
- `profiles`: extends auth.users with `role` (advertiser, developer, admin), `created_at`, `updated_at`

### Advertisers
- `advertisers`: linked to `profiles`, contains `company_name`, `contact_email`, etc.

### Developer Accounts
- `developer_accounts`: linked to `profiles`, contains `payout_preferences`, etc.

### Campaigns
- `campaigns`: 
  - `id` (uuid, primary key)
  - `advertiser_id` (foreign key to advertisers)
  - `name`, `headline`, `description`, `cta`
  - `audience` (enum or foreign key to audiences table)
  - `budget_cents` (integer)
  - `spend_cents` (integer, default 0)
  - `impressions_count` (integer, default 0)
  - `clicks_count` (integer, default 0)
  - `conversions_count` (integer, default 0)
  - `status` (enum: draft, active, paused, completed, archived)
  - `created_at`, `updated_at`
  - `starts_at`, `ends_at` (optional timestamps)

### Campaign Creatives
- `campaign_creatives`: (if we need to store multiple creatives per campaign)
  - `id` (uuid, primary key)
  - `campaign_id` (foreign key)
  - `headline`, `body`, `cta`, `image_url` (if we store creatives in R2 or elsewhere)
  - `created_at`

But note: the frontend currently uses the campaign fields directly for the ad creative. We can start without a separate creatives table and store the creative fields in the campaigns table. If we need multiple creatives later, we can split.

### Targeting
- We have an `audience` field in campaigns (from the seeded data: backend, frontend, devops, data, oss). We can create an `audiences` table or use an enum. For simplicity, we'll use a text field with a check constraint referencing a list of allowed values.

### Events
- `ad_impressions`:
  - `id` (uuid, primary key)
  - `campaign_id` (foreign key)
  - `developer_id` (foreign key to developer_accounts, nullable for anonymous?)
  - `cli_integration` (string, e.g., 'claude-code')
  - `session_id` (string, to track unique sessions)
  - `timestamp` (timestamptz)
  - `idempotency_key` (string, unique) to prevent duplicate impressions

- `ad_interactions`:
  - `id` (uuid, primary key)
  - `impression_id` (foreign key to ad_impressions, nullable)
  - `campaign_id` (foreign key)
  - `developer_id` (foreign key to developer_accounts)
  - `cli_integration` (string)
  - `session_id` (string)
  - `timestamp` (timestamptz)
  - `idempotency_key` (string, unique)
  - `kind` (enum: click, etc.)

### Reward Ledger
- `reward_ledger` (append-only):
  - `id` (uuid, primary key)
  - `developer_id` (foreign key to developer_accounts)
  - `campaign_id` (foreign key)
  - `interaction_id` (foreign key to ad_interactions, nullable)
  - `amount_cents` (integer)
  - `status` (enum: accrued, available)
  - `created_at` (timestamptz)
  - `settled_at` (timestamptz, nullable)
  - Note: We will not allow direct updates to balance; all changes via ledger entries.

### API Keys
- `api_keys`:
  - `id` (uuid, primary key)
  - `owner_id` (foreign key to profiles, could be advertiser or developer)
  - `key` (string, unique, hashed)
  - `name` (string)
  - `expires_at` (timestamptz)
  - `created_at`
  - `revoked_at` (nullable)

### CLI Integrations
- `cli_integrations`:
  - `id` (uuid, primary key)
  - `name` (string, e.g., 'claude-code', 'codex')
  - `config` (jsonb, for any integration-specific settings)
  - `created_at`

## 2. Authentication Architecture

- Use Supabase Auth for user authentication.
- Define roles: advertiser, developer, admin.
- Use PostgreSQL Row Level Security (RLS) to enforce access controls.
  - Advertisers can only manage their own campaigns.
  - Developers can only view their own reward ledger and balance.
  - Admins have elevated access (to be defined).

## 3. Campaign Lifecycle

- Campaigns are created in `draft` status.
- Advertiser can activate campaign (set status to `active`) if budget > 0.
- Active campaigns can be paused/resumed.
- Campaigns automatically transition to `completed` when end date is reached or budget exhausted.
- Completed campaigns can be archived.

## 4. Ad-Serving Flow

- Developers (or CLI integrations) call `GET /api/ads/serve` with parameters: `cli_integration`, `session_id`, optional context.
- The backend selects an eligible campaign based on:
  - Status = active
  - Budget remaining > 0
  - Targeting matches (if any)
  - Frequency limits (if implemented)
- Returns an ad creative and an impression token (idempotency key for the impression).
- The frontend then records the impression via `POST /api/events/impression` using the token.

## 5. Impression Tracking

- `POST /api/events/impression`:
  - Requires: campaign_id, cli_integration, session_id, idempotency_key (impression_token from ad serving).
  - Creates an impression record if idempotency_key not already used.
  - Updates campaign impressions_count.
  - Returns success.

## 6. Interaction Tracking

- `POST /api/events/interaction`:
  - Requires: campaign_id, cli_integration, session_id, idempotency_key (generated by frontend on click), impression_id (optional, from the impression token).
  - Creates an interaction record if idempotency_key not already used.
  - Updates campaign clicks_count.
  - Triggers reward accrual: creates a reward_ledger entry with status `accrued` and amount = REWARD_PER_INTERACTION_CENTS (configured).
  - Returns success.

## 7. Reward Ledger

- Reward accrual happens server-side when an interaction is recorded.
- A separate process (or database trigger) moves rewards from `accrued` to `available` after a settlement period (e.g., 5 seconds in the demo, but configurable).
- Developers can view their reward ledger via `GET /api/rewards`.
- Balance is computed as sum of available rewards minus any requested payouts.
- Developers can request a payout via `POST /api/payouts/request` (mock for now, no real payment processing).

## 8. Advertiser/Developer Relationships

- Advertisers create campaigns and set budget.
- Developers earn rewards from interactions with campaigns.
- The platform shares revenue with developers (and users) as per the ecosystem diagram.

## 9. API Endpoints

### Campaign Management
- `GET /api/campaigns` (advertiser: list own campaigns)
- `POST /api/campaigns` (advertiser: create new campaign)
- `GET /api/campaigns/:id` (advertiser: get own campaign)
- `PATCH /api/campaigns/:id` (advertiser: update own campaign)
- `POST /api/campaigns/:id/select` (advertiser: set as active campaign for the platform)
- `GET /api/active-campaign` (anyone: get the currently active campaign being served)

### Ad Serving
- `GET /api/ads/serve` (developer/cli: get an ad to display)
  - Query: cli_integration, session_id

### Event Tracking
- `POST /api/events/impression`
- `POST /api/events/interaction`

### Rewards
- `GET /api/rewards` (developer: list own reward ledger entries)
- `GET /api/rewards/balance` (developer: get balance summary)
- `POST /api/payouts/request` (developer: request a payout - mock)

## 10. Security Model

- All API endpoints require authentication (except possibly ad serving and event tracking? but we should authenticate the developer/CLI integration).
- We will use Supabase Auth JWT for authentication.
- RLS policies:
  - `profiles`: users can only update their own profile.
  - `advertisers`: users can only insert/update/delete advertisers linked to their profile.
  - `developer_accounts`: similarly.
  - `campaigns`: advertisers can only manage their own campaigns.
  - `ad_impressions` and `ad_interactions`: insert only by authenticated developers (or CLI integrations via API keys?).
  - `reward_ledger`: select only by the owning developer.
  - `api_keys`: manage own API keys.

- We will implement rate limiting on public endpoints (ad serving, event tracking) to prevent abuse.
- Idempotency keys for event tracking to prevent duplicate events.
- No secrets exposed to frontend; Supabase service role key only used in backend (if using Edge Functions) or in a trusted server.

## 11. Future CLI Integration Architecture

- CLI tools can integrate via an API key or OAuth.
- They would call `/api/ads/serve` to get an ad to display in their UI.
- They would then report impressions and interactions via the event endpoints.
- We may provide SDKs for popular CLIs.

## Migration and Seeding

We will create Supabase migration scripts to set up the schema and insert seed data (3 advertisers, 3 campaigns, etc.).

## Testing

We will write tests for the API endpoints and RLS policies using a testing framework (e.g., Jest) and a Supabase test emulator or a test database.