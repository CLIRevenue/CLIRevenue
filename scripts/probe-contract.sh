#!/usr/bin/env bash
# Probe deployed function response CONTRACTS with the anon key (no user session).
# Distinguishes new handlers ({error:{code,message}}) from old ones.
set -u
url=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2)
anon=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2)
base="$url/functions/v1"

req() {
  local method="$1" path="$2" data="${3:-}"
  local out code body
  if [ "$method" = GET ]; then
    out=$(curl -sS -w '\n%{http_code}' --max-time 12 -H "Authorization: Bearer $anon" "$base/$path" 2>&1)
  else
    out=$(curl -sS -w '\n%{http_code}' --max-time 12 -X POST -H "Authorization: Bearer $anon" -H 'Content-Type: application/json' ${data:+-d "$data"} "$base/$path" 2>&1)
  fi
  code=$(printf '%s' "$out" | tail -n1)
  body=$(printf '%s' "$out" | sed '$d' | head -c 400)
  printf '%s %s %s -> %s : %s\n' "$method" "$path" "${data:-''}" "$code" "$body"
}

echo "== campaigns list (expect 401 UNAUTHENTICATED or FORBIDDEN from new code) =="
req GET "campaigns"
echo "== campaigns create unauth (new code: UNAUTHENTICATED) =="
req POST "campaigns" '{"name":"x"}'
echo "== events function deployed? (404 gateway = not deployed) =="
req POST "events/impression" '{"campaign_id":"x"}'
echo "== record_impression with anon, empty body =="
req POST "record_impression" '{}'
echo "== record_impression with campaign_id only (new requires cli/session/idem) =="
req POST "record_impression" '{"campaign_id":"00000000-0000-4000-8000-000000000000"}'
echo "== record_interaction =="
req POST "record_interaction" '{}'
echo "== get_active_campaign =="
req GET "get_active_campaign"
echo "== campaign_select no id =="
req POST "campaign_select/x/select" '{}'
echo "== campaigns/:id/archive with bad uuid =="
req POST "campaigns/not-a-uuid/archive" '{}'
