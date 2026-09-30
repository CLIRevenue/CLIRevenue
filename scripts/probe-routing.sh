#!/usr/bin/env bash
# Probe deployed path routing: how does the function see the URL?
set -u
url=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2)
anon=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2)
f="$url/functions/v1"

echo '--- OPTIONS /campaigns/api/campaigns (new code CORS preflight -> 204; old code -> 401/no CORS) ---'
curl -sS -o /dev/null -w '%{http_code}\n' -X OPTIONS "$f/campaigns/api/campaigns" --max-time 10

echo '--- GET /campaigns/api/campaigns with anon token ---'
curl -sS -w '\n%{http_code}\n' "$f/campaigns/api/campaigns" -H "Authorization: Bearer $anon" --max-time 10

echo '--- GET /campaigns/zzz/qqq with anon token ---'
curl -sS -w '\n%{http_code}\n' "$f/campaigns/zzz/qqq" -H "Authorization: Bearer $anon" --max-time 10

echo '--- GET /campaigns with anon token ---'
curl -sS -w '\n%{http_code}\n' "$f/campaigns" -H "Authorization: Bearer $anon" --max-time 10

echo '--- GET /campaign_select/x/select POST with anon token (path parsing evidence) ---'
curl -sS -w '\n%{http_code}\n' -X POST "$f/campaign_select/api/campaigns/x/select" -H "Authorization: Bearer $anon" -H 'Content-Type: application/json' -d '{}' --max-time 10
