# Advertiser side (Cline ownership)

Routes (pathname-based, hash fallback `#/app/...` works on static hosts):

- `/app/advertiser` — Overview (totals, performance chart, recent campaigns/activity)
- `/app/advertiser/campaigns` — list + search/filters + create + edit + set-active
- `/app/advertiser/analytics` — derived from campaign rows only
- `/app/advertiser/billing` — spend derived from campaigns; payments/invoices disabled stubs
- `/app/advertiser/account` — read-only profile + logout + local notification prefs
- `/app/developer` — untouched placeholder; OpenCode owns it

Auth: Supabase session + role from `public.profiles` (via `/auth` status with
direct profile fallback). No localStorage role, no tokens displayed.

Backend reuse (no new backend, no client-side privileged queries):

- `GET /functions/v1/campaigns/api/campaigns` (falls back to `/functions/v1/api/campaigns`)
- `POST` same collection URL
- `PATCH /functions/v1/campaigns/api/campaigns/:id`
- `POST /functions/v1/campaigns/api/campaigns/:id/select`

Money stays in integer cents; backend is authoritative. Billing, payment
methods, invoices, company-profile writes, and time-series analytics have no
backend endpoint and are isolated as disabled/empty states, never faked.
