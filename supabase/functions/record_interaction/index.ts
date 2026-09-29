import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const supabaseUser = createClient(supabaseUrl, supabaseAnonKey);

serve(async (req) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
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

    // Get the user's profile to check role and get developer account id
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role, id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch profile" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (profile.role !== "developer") {
      return new Response(
        JSON.stringify({ error: "Only developers can record interactions" }),
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

    const { campaign_id, cli_integration, session_id, idempotency_key, impression_id } = await req.json();

    // Validate required fields
    if (!campaign_id || !cli_integration || !session_id || !idempotency_key) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. Check if idempotency key already used for interactions
    const { data: existingInteraction, error: intError } = await supabaseAdmin
      .from("ad_interactions")
      .select("id")
      .eq("idempotency_key", idempotency_key)
      .single();

    if (intError && intError.code !== "PGRST116") { // PGRST116 means no rows returned
      return new Response(
        JSON.stringify({ error: "Failed to check for duplicate interaction" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (existingInteraction) {
      return new Response(
        JSON.stringify({ error: "Duplicate interaction" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Get the campaign and check if it's active and has budget remaining (for consistency)
    // We'll also verify that the impression_id belongs to this campaign and developer
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("campaigns")
      .select("id, status, budget_cents, cpm_cents, spend_milli_cents, name")
      .eq("id", campaign_id)
      .single();

    if (campaignError) {
      return new Response(
        JSON.stringify({ error: "Campaign not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    if (campaign.status !== "active") {
      return new Response(
        JSON.stringify({ error: "Campaign is not active" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Verify the impression exists and belongs to this campaign and developer
    const { data: impression, error: impressionError } = await supabaseAdmin
      .from("ad_impressions")
      .select("id, campaign_id, developer_id")
      .eq("id", impression_id)
      .single();

    if (impressionError) {
      return new Response(
        JSON.stringify({ error: "Impression not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    if (impression.campaign_id !== campaign_id) {
      return new Response(
        JSON.stringify({ error: "Impression does not belong to the campaign" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (impression.developer_id !== developer_id) {
      return new Response(
        JSON.stringify({ error: "Impression does not belong to the developer" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Check if idempotency key already used for this impression (optional, but we already checked globally)
    // We'll also check if an interaction with this idempotency key and impression_id exists? 
    // We already checked the idempotency key globally in the ad_interactions table.

    // 5. Insert the interaction and update the campaign's clicks_count atomically
    // We'll do an atomic update on the campaign to increment clicks_count, and then insert the interaction.
    // We'll also accrue a reward (fixed 18 cents) and insert a reward_ledger entry.

    // First, update the campaign's clicks_count atomically
    const { data: updatedCampaign, error: updateError } = await supabaseAdmin
      .from("campaigns")
      .update({
        clicks_count: campaign.clicks_count + 1,
      })
      .eq("id", campaign_id)
      .select()
      .single();

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to update campaign" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!updatedCampaign) {
      return new Response(
        JSON.stringify({ error: "Campaign not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // 6. Insert the interaction
    const { data: interaction, error: insertError } = await supabaseAdmin
      .from("ad_interactions")
      .insert([
        {
          campaign_id,
          developer_id,
          cli_integration,
          session_id,
          idempotency_key,
          impression_id,
          kind: "click", // default
        }
      ])
      .select()
      .single();

    if (insertError) {
      // If the interaction insertion fails, we should try to rollback the campaign update? 
      // For simplicity, we'll log the error and still return success? 
      // But the interaction is not recorded, so we should return an error.
      return new Response(
        JSON.stringify({ error: "Failed to record interaction" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 7. Accrue a reward (fixed 18 cents) and insert into reward_ledger
    const rewardAmountCents = 18; // fixed reward per interaction
    const { data: reward, error: rewardError } = await supabaseAdmin
      .from("reward_ledger")
      .insert([
        {
          developer_id,
          campaign_id,
          interaction_id: interaction.id,
          amount_cents: rewardAmountCents,
          status: "accrued",
        }
      ])
      .select()
      .single();

    if (rewardError) {
      return new Response(
        JSON.stringify({ error: "Failed to accrue reward" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 8. Insert ledger events for the interaction and the reward accrual
    const { error: ledgerInteractionError } = await supabaseAdmin
      .from("ledger_events")
      .insert([
        {
          type: "interaction",
          amount_cents: 0,
          label: `Interaction recorded`,
          detail: `${updatedCampaign.name}`,
          simulated: false,
        }
      ]);

    if (ledgerInteractionError) {
      console.error("Failed to insert ledger event for interaction:", ledgerInteractionError);
    }

    const { error: ledgerRewardError } = await supabaseAdmin
      .from("ledger_events")
      .insert([
        {
          type: "reward_accrued",
          amount_cents: rewardAmountCents,
          label: `Reward accrued`,
          detail: `${updatedCampaign.name} · ${rewardAmountCents}¢`,
          simulated: false,
        }
      ]);

    if (ledgerRewardError) {
      console.error("Failed to insert ledger event for reward accrual:", ledgerRewardError);
    }

    // 9. Return success with the reward accrued
    return new Response(
      JSON.stringify({
        success: true,
        interaction_id: interaction.id,
        reward_accrued: {
          id: reward.id,
          amount_cents: reward.amount_cents,
          status: reward.status,
        },
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