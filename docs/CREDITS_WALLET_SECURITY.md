# Credit Wallet Security Model

Status: design of the CLIRevenue credit wallet system.  
Scope: advertiser and developer wallets, top-ups, admin grant/freeze/unfreeze,
campaign credit reservation.  
Source of truth: `supabase/migrations/20261021120000_credit_wallets.sql`,
`supabase/migrations/20261021120100_wallet_governance_campaign_credits.sql`,
`supabase/functions/_shared/walletRules.ts`,
`supabase/functions/wallet/index.ts`, `supabase/functions/admin/index.ts`.

---

## 1. Currency and units

- 1 credit = 1 INR = 100 cents.
- Credits are whole numbers (bigint).
- Top-up credits are computed server-side from `amount_minor` × rate (floor,
  never round): `creditsForAmount(amountMinor, rate)`.
- Minimum top-up: 100 minor units (`MIN_TOPUP_MINOR`). Maximum: 10,000,000
  minor units (`MAX_TOPUP_MINOR`).
- All money state lives in Postgres. The browser never asserts, credits, or
  settles money.

---

## 2. Wallet creation

- One wallet per person, keyed by `profiles.id` (the profile is both advertiser
  and developer).
- Auto-created via `AFTER INSERT ON profiles` trigger `ensure_wallet`.
- Backfill migration runs `ensure_wallet` for all existing profiles so no
  profile is wallet-less.
- New wallets start at `balance_credits = 0`, `reserved_credits = 0`,
  `frozen_at = NULL`.

---

## 3. Top-ups: pending-first, confirmed-second

### 3.1 Creation (browser path)

- `POST /wallet/topups` (authenticated user, Edge Function) creates a
  `wallet_topups` row with `status = 'pending'` and `credits` computed
  server-side.
- Payer details (`payer_name`, `payer_email`, `payer_address`) and
  `payment_method` are recorded but **never used to move money**.
- Idempotency key prevents duplicate creation: replaying the same key returns
  the original pending row without creating a second one.
- Nothing is credited at creation time. Balance is unchanged.

### 3.2 Confirmation (service_role only)

- `confirm_wallet_topup(topup_id, payment_reference, actor_profile_id)` is the
  **only** function that credits a wallet. It runs `SECURITY DEFINER` as
  `service_role`.
- It calls `post_wallet_transaction()` which writes an append-only
  `wallet_transactions` row and updates `wallets.balance_credits` atomically.
- Idempotent: confirming an already-confirmed top-up returns `duplicate: true`
  and does not credit twice.
- Rejects if the top-up is not `pending` (already settled or rejected).

### 3.3 Client cannot write money

- `wallet_transactions`: SELECT+INSERT granted to `service_role` only.
  `authenticated` and `anon` have no privileges.
- `confirm_wallet_topup`: EXECUTE granted to `service_role` only. Revoked from
  `PUBLIC, anon, authenticated`.
- An authenticated user attempting to call `confirm_wallet_topup` or insert into
  `wallet_transactions` gets a 403/permission error.

---

## 4. Admin grants

- `grant_free_credits(profile_id, credits, reason, actor_profile_id,
  idempotency_key)` — `SECURITY DEFINER`, `service_role`.
- Capped at **2000 credits per person per calendar month**. The cap is a sum
  over grant transactions in the current month, computed while the wallet row
  is locked (`lock_wallet()`), so concurrent grants cannot both pass.
- Returns `month_used_credits` and `month_remaining_credits`.
- Refuses grants to frozen accounts (`ACCOUNT_FROZEN`).
- Idempotency key prevents double-grant on replay.

---

## 5. Freeze scopes

Three independent scopes on `profiles`:

| Scope | What it blocks | What it does NOT block |
|-------|---------------|----------------------|
| `account` | All credit movement (grants, top-ups), campaign activation | Sign-in |
| `wallet` | Top-up creation and confirmation | Sign-in, key auth |
| `keys` | Publisher key authentication | Sign-in, credit movement |

- `freeze_account(profile_id, scope, reason, actor_profile_id)` — `SECURITY
  DEFINER`, `service_role`. Locks profile + wallet, writes the scope-specific
  frozen flag, inserts an `account_freezes` history row.
- Freeze does **not** sign the user out. The frozen person can still sign in;
  the notice and unfreeze request are the only channels that reach them.
- Trigger `on_profile_frozen_pause_campaigns` fires on `profiles` UPDATE when
  `frozen_at` is set: pauses all active campaigns owned by that profile.
- `release_freeze(profile_id, scope, reason, actor_profile_id)` clears the
  frozen flag for that scope and releases the freeze row.

---

## 6. Unfreeze requests

- `request_unfreeze(profile_id, freeze_id, subject, body, user_email)` —
  `SECURITY DEFINER`, `service_role`.
- Creates a support request in `advertiser_queries` with category `unfreeze`
  and `related_freeze_id` pointing at the `account_freezes` row.
- Links the freeze row back via `unfreeze_request_id` / `unfreeze_requested_at`.
- Rejects if the requester is not the freeze owner (`NOT_YOUR_FREEZE`) or the
  freeze is already released (`FREEZE_ALREADY_RELEASED`).

---

## 7. Campaign credit reservation

- `reserve_campaign_credits(campaign_id, budget_credits, actor_profile_id)` —
  called on campaign activation (draft→active). Fails closed with
  `INSUFFICIENT_CREDITS` or `ACCOUNT_FROZEN` if the wallet cannot cover the
  budget.
- Reserves credits by writing `campaign_credit_holds` and incrementing
  `wallets.reserved_credits`.
- `settle_campaign_credit_hold(campaign_id, final_spend_credits,
  actor_profile_id)` — called on deactivation (active→paused/completed/archived).
  Releases the hold, settles actual spend, and returns unused reserved credits
  to the balance.
- `campaign_activation_blockers` table records `INSUFFICIENT_CREDITS` /
  `ACCOUNT_FROZEN` blocks so the UI can show why activation failed.
- Delivery path (`spend_milli_cents`) is untouched by freeze; only activation
  is gated.

---

## 8. Reconciliation

- `reconcile_wallet(profile_id)` recomputes `balance_credits` and
  `reserved_credits` from the append-only `wallet_transactions` log and
  compares against the projections. Reports `balanced: true/false` and
  `drift_credits`. Used for audits; never auto-corrects.

---

## 9. RLS and grants summary

| Object | SELECT | INSERT | UPDATE | DELETE | Notes |
|--------|--------|--------|--------|--------|-------|
| `wallets` | authenticated (own) | service_role | service_role | — | RLS: own profile only |
| `wallet_transactions` | service_role only | service_role only | — | — | Append-only |
| `wallet_topups` | authenticated (own) | authenticated (own) | service_role | — | RLS: own profile only |
| `credit_rates` | authenticated | — | service_role | — | Read-only for users |
| `account_freezes` | authenticated (own) | service_role | service_role | — | RLS: own profile only |
| `user_notifications` | authenticated (own) | authenticated (own) | service_role | — | RLS: own profile only |

All money-moving functions (`confirm_wallet_topup`, `grant_free_credits`,
`freeze_account`, `release_freeze`, `request_unfreeze`,
`reserve_campaign_credits`, `settle_campaign_credit_hold`,
`post_wallet_transaction`) are `SECURITY DEFINER` as `service_role`, with
EXECUTE revoked from `PUBLIC, anon, authenticated`.

---

## 10. What the browser cannot do

- Cannot credit a wallet (no `confirm_wallet_topup` access).
- Cannot insert a ledger row (no `wallet_transactions` INSERT).
- Cannot confirm its own top-up (function revoked).
- Cannot bypass a freeze (RLS + function checks on `frozen_at`).
- Cannot create a top-up for another person (RLS: `profile_id = auth.uid()`).

The Edge Function wallet API enforces bearer-token auth and routes every
mutating call through `service_role` RPCs that re-check ownership and freeze
state inside Postgres.
