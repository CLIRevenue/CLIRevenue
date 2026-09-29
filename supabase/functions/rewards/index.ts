import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const supabaseUser = createClient(supabaseUrl, supabaseAnonKey);

serve(async (req) => {
  // Get the Authorization header
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  const accessToken = authHeader.substring(7); // Remove 'Bearer '

  // Set the user client's auth
  supabaseUser.auth.setAuth(accessToken);

  // Get the user
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError) {
    return new Response(
      JSON.stringify({ error: "Invalid token" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Get the user's profile to check role
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch profile" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Only developers can access rewards
  if (profile.role !== "developer") {
    return new Response(
      JSON.stringify({ error: "Only developers can access rewards" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // Get the developer account id
  const { data: devAccount, error: devAccountError } = await supabaseAdmin
    .from("developer_accounts")
    .select("id")
    .eq("profile_id", user.id)
    .single();

  if (devAccountError) {
    return new Response(
      JSON.stringify({ error: "Developer account not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const developer_id = devAccount.id;

  // Parse the URL
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter((part) => part !== "");
  // Expected paths:
  //   /api/rewards/balance
  //   /api/rewards
  const method = req.method;

  // Helper to handle errors
  const handleError = (error: any, status = 500, message = "Internal server error") => {
    return new Response(
      JSON.stringify({ error: message, details: error?.message || error }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  };

  // GET /api/rewards/balance
  if (method === "GET" && pathParts.length === 3 && pathParts[0] === "api" && pathParts[1] === "rewards" && pathParts[2] === "balance") {
    try {
      // Calculate balances from reward_ledger and payouts (if we have a payouts table)
      // We don't have a payouts table yet; we'll create one later or use a mock.
      // For now, we'll compute:
      //   available_cents = sum of amount_cents where status = 'available'
      //   pending_cents = sum of amount_cents where status = 'accrued'
      //   lifetime_cents = sum of all amount_cents
      //   reserved_cents = 0 (since we don't have payouts yet)

      const { data: rewards, error: rewardsError } = await supabaseAdmin
        .from("reward_ledger")
        .select("amount_cents, status")
        .eq("developer_id", developer_id);

      if (rewardsError) {
        return handleError(rewardsError, 500, "Failed to fetch rewards");
      }

      const available = rewards
        .filter((r) => r.status === "available")
        .reduce((sum, r) => sum + r.amount_cents, 0);
      const pending = rewards
        .filter((r) => r.status === "accrued")
        .reduce((sum, r) => sum + r.amount_cents, 0);
      const lifetime = rewards.reduce((sum, r) => sum + r.amount_cents, 0);
      const reserved = 0; // TODO: implement payouts table

      return new Response(
        JSON.stringify({
          available_cents: available,
          pending_cents: pending,
          lifetime_cents: lifetime,
          reserved_cents: reserved,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return handleError(err);
    }
  }

  // GET /api/rewards
  if (method === "GET" && pathParts.length === 2 && pathParts[0] === "api" && pathParts[1] === "rewards") {
    try {
      const limit = parseInt(url.searchParams.get("limit") || "10", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);

      const { data: rewards, error: rewardsError } = await supabaseAdmin
        .from("reward_ledger")
        .select(`
          id,
          campaign_id,
          amount_cents,
          status,
          created_at,
          settled_at
        `)
        .eq("developer_id", developer_id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (rewardsError) {
        return handleError(rewardsError, 500, "Failed to fetch rewards");
      }

      // Enrich with campaign name
      const rewardsWithCampaign = await Promise.all(
        rewards.map(async (reward) => {
          const { data: campaignData, error: campaignError } = await supabaseAdmin
            .from("campaigns")
            .select("name")
            .eq("id", reward.campaign_id)
            .single();

          return {
            ...reward,
            campaign_name: campaignData ? campaignData.name : null,
          };
        })
      );

      return new Response(
        JSON.stringify({ rewards: rewardsWithCampaign }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return handleError(err);
    }
  }

  // If none of the above matched, return 404
  return new Response(
    JSON.stringify({ error: "Not found" }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
});