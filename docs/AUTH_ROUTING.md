# Auth + role routing takeover (single app)

Source of truth: Supabase session -> `public.profiles.id = auth user id` ->
`public.profiles.role` -> dashboard. No localStorage role, no chooser screen.

- `/` public site (unchanged film/console/conversion)
- `/login`, `/signup` shared auth pages (CLIRevenue styling)
- `/app` resolves to role home
- `/app/advertiser/*` requires `advertiser`
- `/app/developer/*` requires `developer`
- `/app/admin/*` requires `admin` (empty placeholder; no admin app ships)

Signup creates `auth.users` with `user_metadata.role`, then bootstrap creates
`profiles` + side row via `handle_new_user` trigger, `ensure_own_profile` RPC
fallback, and RLS self-insert policies. Admin is never a signup option.

Advertiser dashboard and campaigns Edge Function untouched. Developer app is new
and isolated (`src/components/developer/DeveloperApp.jsx`).
