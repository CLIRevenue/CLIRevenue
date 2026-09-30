#!/usr/bin/env bash
# Read-only: can anon SELECT campaigns (grants/RLS state)? and does the
# migration's frozen-column trigger exist? (probe only, no mutations)
set -u
url=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2)
anon=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2)

out=$(curl -sS -w '\n%{http_code}' --max-time 12 \
  "$url/rest/v1/campaigns?select=id,status,budget_cents,spend_milli_cents,impressions_count&limit=1" \
  -H "Authorization: Bearer $anon" -H "apikey: $anon" 2>&1)
code=$(printf '%s' "$out" | tail -n1)
body=$(printf '%s' "$out" | sed '$d' | head -c 400)
echo "GET /rest/v1/campaigns (anon) -> $code : $body"

# interaction_kind enum values probe (conversion added by 000008?)
out=$(curl -sS -w '\n%{http_code}' --max-time 12 \
  "$url/rest/v1/rpc/exec_sql" -X POST \
  -H "Authorization: Bearer $anon" -H "apikey: $anon" \
  -H 'Content-Type: application/json' \
  -d '{"query":"select 1"}' 2>&1)
echo "rpc exec_sql -> $(printf '%s' "$out" | tail -n1) (404 = not exposed, expected)"
