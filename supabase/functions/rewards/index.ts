/**
 * rewards — the signed-in developer's own reward ledger and balances.
 *
 * SECURITY / CORRECTNESS
 * The previous implementation resolved the caller with
 * `supabaseUser.auth.setAuth(...)` (removed in supabase-js v2) and routed
 * on `pathParts[0] === "api"`, which never matched the real gateway path
 * `/functions/v1/rewards` — so it answered 500 for a signed-in call and
 * 404 for anything else. Its balance also hardcoded `reserved = 0` and it
 * returned `err.message` in the body.
 *
 * Now: caller resolved from the JWT, routes resolved through restPath(),
 * every figure computed by public.reward_balance() against
 * reward_ledger.remaining_cents (so consumed rewards are gone from the
 * spendable total), and no internal error text is ever returned.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient, getJwtUser, requireDeveloper } from "../_shared/auth.ts";
import { apiError, json, optionsResponse, restPath } from "../_shared/http.ts";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function parseInteger(raw: string | null, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "GET") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const admin = adminClient();
  const dev = await requireDeveloper(admin, authed.user!.id);
  if ("error" in dev && dev.error) return dev.error;
  // Every query below is scoped to the token's own developer account.
  const developerId = dev.developer!.id;

  const url = new URL(req.url);
  const rest = restPath(url.pathname, "rewards");

  try {
    if (rest.length === 1 && rest[0] === "balance") {
      const { data, error } = await admin.rpc("reward_balance", {
        p_developer_id: developerId,
      });
      if (error) {
        console.error("reward_balance failed:", error.message);
        return apiError("INTERNAL_ERROR", "Could not load the balance.", 500);
      }
      return json({
        available_cents: Number(data?.available_cents ?? 0),
        pending_cents: Number(data?.pending_cents ?? 0),
        lifetime_cents: Number(data?.lifetime_cents ?? 0),
        reserved_cents: Number(data?.reserved_cents ?? 0),
      });
    }

    if (rest.length === 0) {
      const limit = Math.min(Math.max(parseInteger(url.searchParams.get("limit"), DEFAULT_LIMIT), 1), MAX_LIMIT);
      const offset = Math.max(parseInteger(url.searchParams.get("offset"), 0), 0);

      const { data, error } = await admin
        .from("reward_ledger")
        .select("id, campaign_id, amount_cents, remaining_cents, status, created_at, settled_at")
        .eq("developer_id", developerId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error("reward_ledger select failed:", error.message);
        return apiError("INTERNAL_ERROR", "Could not load rewards.", 500);
      }

      const rows = data ?? [];
      const campaignIds = [...new Set(rows.map((row) => row.campaign_id).filter(Boolean))];
      const names: Record<string, string> = {};
      if (campaignIds.length) {
        const { data: campaigns } = await admin
          .from("campaigns")
          .select("id, name")
          .in("id", campaignIds);
        for (const campaign of campaigns ?? []) names[campaign.id] = campaign.name;
      }

      return json({
        rewards: rows.map((row) => ({
          id: row.id,
          campaign_id: row.campaign_id,
          campaign_name: names[row.campaign_id] ?? null,
          amount_cents: row.amount_cents,
          remaining_cents: row.remaining_cents,
          status: row.status,
          created_at: row.created_at,
          settled_at: row.settled_at,
        })),
      });
    }

    return apiError("NOT_FOUND", "Not found.", 404);
  } catch (err) {
    console.error("rewards error:", err instanceof Error ? err.message : err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  }
});

serve(handler);
