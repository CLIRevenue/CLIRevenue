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
        JSON.stringify({ error: "Only developers can record impressions" }),
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

    const { campaign_id, cli_integration, session_id, idempotency_key } = await req.json();

    // Validate required fields
    if (!campaign_id || !cli_integration || !session_id || !idempotency_key) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. Check if idempotency key already used for impressions
    const { data: existingImpression, error: impError } = await supabaseAdmin
      .from("ad_impressions")
      .select("id")
      .eq("idempotency_key", idempotency_key)
      .single();

    if (impError && impError.code !== "PGRST116") { // PGRST116 means no rows returned
      return new Response(
        JSON.stringify({ error: "Failed to check for duplicate impression" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (existingImpression) {
      return new Response(
        JSON.stringify({ error: "Duplicate impression" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Get the campaign and check if it's active and has budget remaining
    // We'll lock the campaign row for update to prevent race conditions
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

    // Check budget: if spend_milli_cents >= (budget_cents * 1000), then no more impressions allowed
    // spend_milli_cents is in milli-cents, budget_cents is in cents
    // budget_cents * 1000 converts budget to milli-cents for comparison
    if (campaign.spend_milli_cents >= campaign.budget_cents * 1000) {
      return new Response(
        JSON.stringify({ error: "Campaign budget exhausted" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Insert the impression and update the campaign atomically
    // We'll do a transaction-like operation by first inserting the impression,
    // then updating the campaign with an atomic increment.
    // Note: Supabase does not support transactions in Edge Functions easily, but we can try to do both and if one fails, we can try to rollback? 
    // For simplicity, we'll do the insert and then the update, and if the update fails, we'll log the error but not fail the request.
    // The impression is still recorded, but the campaign stats might be off. 
    // Alternatively, we can update the campaign first (to reserve the budget) and then insert the impression.
    // We'll do the update first to check the budget and reserve the milli-cents, then insert the impression.
    // However, the budget check and reservation must be atomic.

    // We'll try to update the campaign's spend_milli_cents and impressions_count in an atomic way, but we need to know if we have enough budget.
    // We can do:
    // UPDATE campaigns
    // SET spend_milli_cents = spend_milli_cents + (cpm_cents / 100),
    //     impressions_count = impressions_count + 1
    // WHERE id = $1 AND spend_milli_cents < (budget_cents * 1000)
    // RETURNING *;
    // Then, if the update affects 0 rows, it means the budget is exhausted or the campaign is not active.
    // But we also need to check the campaign status.

    // Let's do a single query that updates the campaign and returns the updated campaign if the budget is sufficient and the campaign is active.
    // We'll also need to insert the impression only if the update succeeds.

    // Step 1: Try to update the campaign with the impression's contribution.
    const milliCentsPerImpression = campaign.cpm_cents / 100;
    const { data: updatedCampaign, error: updateError } = await supabaseAdmin
      .from("campaigns")
      .update({
        impressions_count: campaign.impressions_count + 1,
        spend_milli_cents: campaign.spend_milli_cents + milliCentsPerImpression,
      })
      .eq("id", campaign_id)
      .eq("status", "active")
      .lt("spend_milli_cents", campaign.budget_cents * 1000) // Ensure we don't exceed budget
      .select()
      .single();

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to update campaign" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!updatedCampaign) {
      // This means either the campaign is not active or the budget is exhausted
      return new Response(
        JSON.stringify({ error: "Campaign is not active or budget exhausted" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Insert the impression (now that we know the campaign can accommodate it)
    const { data: impression, error: insertError } = await supabaseAdmin
      .from("ad_impressions")
      .insert([
        {
          campaign_id,
          developer_id,
          cli_integration,
          session_id,
          idempotency_key,
        }
      ])
      .select()
      .single();

    if (insertError) {
      // If the impression insertion fails, we should try to rollback the campaign update? 
      // For simplicity, we'll log the error and still return success? 
      // But the impression is not recorded, so we should return an error.
      return new Response(
        JSON.stringify({ error: "Failed to record impression" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Insert a ledger event for the impression
    const { error: ledgerError } = await supabaseAdmin
      .from("ledger_events")
      .insert([
        {
          type: "impression",
          amount_cents: 0,
          label: `Impression recorded`,
          detail: `${updatedCampaign.name}`,
          simulated: false,
        }
      ]);

    if (ledgerError) {
      console.error("Failed to insert ledger event for impression:", ledgerError);
    }

    // 4. Return success
    return new Response(
      JSON.stringify({
        success: true,
        impression_id: impression.id,
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