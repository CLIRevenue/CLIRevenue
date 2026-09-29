import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Settlement period in milliseconds (default 5000ms = 5 seconds)
// Can be overridden by setting the SETTLEMENT_MS environment variable
const SETTLEMENT_MS = parseInt(Deno.env.get("SETTLEMENT_MS") || "5000", 10);

serve(async (req) => {
  // Only allow POST requests (to prevent accidental triggering)
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Calculate the cutoff time: now - SETTLEMENT_MS
    const cutoffTime = new Date(Date.now() - SETTLEMENT_MS).toISOString();

    // 1. Find accrued rewards that are older than the cutoff time
    const { data: rewardsToSettle, error: selectError } = await supabaseAdmin
      .from("reward_ledger")
      .select("id, campaign_id, amount_cents, created_at")
      .eq("status", "accrued")
      .lt("created_at", cutoffTime);

    if (selectError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch rewards to settle" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (rewardsToSettle.length === 0) {
      return new Response(
        JSON.stringify({ settled_count: 0, message: "No rewards to settle" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Update each reward to 'available' and set settled_at
    const rewardIds = rewardsToSettle.map((r) => r.id);
    const { error: updateError } = await supabaseAdmin
      .from("reward_ledger")
      .update({ status: "available", settledAt: new Date().toISOString() })
      .in("id", rewardIds);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to update rewards" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Insert ledger events for each settled reward
    const ledgerEventsToInsert = rewardsToSettle.map((reward) => ({
      type: "reward_available",
      amount_cents: reward.amount_cents,
      label: "Reward available",
      detail: `${reward.campaign_id} · withdrawable`, // We could fetch the campaign name, but for simplicity we use the ID
      simulated: false,
    }));

    const { error: ledgerError } = await supabaseAdmin
      .from("ledger_events")
      .insert(ledgerEventsToInsert);

    if (ledgerError) {
      console.error("Failed to insert ledger events for settled rewards:", ledgerError);
      // We don't fail the request because the rewards were updated successfully
    }

    // 4. Return success
    return new Response(
      JSON.stringify({
        settled_count: rewardsToSettle.length,
        message: `Successfully settled ${rewardsToSettle.length} rewards`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", details: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});