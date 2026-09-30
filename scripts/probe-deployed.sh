#!/usr/bin/env bash
# Read-only probe: which Edge Function paths respond on the deployed project.
base=https://xoacisojqsqlqzvzzusx.supabase.co/functions/v1
probe() {
  local method="$1" path="$2" data="$3"
  local out code body
  if [ "$method" = "GET" ]; then
    out=$(curl -sS -w '\n%{http_code}' --max-time 12 "$base/$path" 2>&1)
  else
    out=$(curl -sS -w '\n%{http_code}' --max-time 12 -X POST -H 'Content-Type: application/json' ${data:+-d "$data"} "$base/$path" 2>&1)
  fi
  code=$(printf '%s' "$out" | tail -n1)
  body=$(printf '%s' "$out" | sed '$d' | head -c 300)
  printf '%s %s -> %s : %s\n' "$method" "$path" "$code" "$body"
}
probe GET "campaigns"
probe GET "api/campaigns"
probe GET "api/events/impression"
probe GET "events/impression"
probe POST "events/impression" '{"campaign_id":"x"}'
probe POST "record_impression" '{}'
probe GET "api/active-campaign"
probe GET "api/auth/status"
probe GET "get_active_campaign"
