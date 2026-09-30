#!/usr/bin/env bash
# Probe whether migration 000008 objects exist (read-only, anon key).
set -u
url=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2)
anon=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2)

rpc() {
  local name="$1"
  out=$(curl -sS -w '\n%{http_code}' --max-time 12 \
    -X POST "$url/rest/v1/rpc/$name" \
    -H "Authorization: Bearer $anon" -H 'apikey: '"$anon" \
    -H 'Content-Type: application/json' -d '{}' 2>&1)
  code=$(printf '%s' "$out" | tail -n1)
  body=$(printf '%s' "$out" | sed '$d' | head -c 300)
  printf 'rpc %s -> %s : %s\n' "$name" "$code" "$body"
}

# apply_impression exists (000008) vs missing -> 404 function not found
rpc "apply_impression"
rpc "apply_interaction"
# Pre-000008 control: a function that should not exist
rpc "definitely_not_a_function_000008"

# column probe: campaigns.* and ledger_events.* via PostgREST OpenAPI
out=$(curl -sS --max-time 12 "$url/rest/v1/" -H "Authorization: Bearer $anon" -H "apikey: $anon" 2>&1)
printf '%s' "$out" | grep -o '"campaign_id"' | head -1 | sed 's/^/ledger_events has campaign_id in schema: /'
printf '%s' "$out" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
except Exception as e:
    print('openapi parse failed:', e); sys.exit()
defs=d.get('definitions',{})
led=defs.get('ledger_events',{})
props=list((led.get('properties') or {}).keys())
print('ledger_events columns:', props)
camp=defs.get('campaigns',{})
print('campaigns has spend_milli_cents:', 'spend_milli_cents' in (camp.get('properties') or {}))
"
