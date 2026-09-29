import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  // Only allow GET requests
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Get the active campaign ID from platform_settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("platform_settings")
      .select("active_campaign_id")
      .single();

    if (settingsError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch platform settings" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!settings.active_campaign_id) {
      return new Response(
        JSON.stringify({ error: "No active campaign set" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the campaign details
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("campaigns")
      .select(
        `id, name, headline, description, cta, audience_id, budget_cents, spend_milli_cents, impressions_count, clicks_count, conversions_count, status, created_at, updated_at`
      )
      .eq("id", settings.active_campaign_id)
      .single();

    if (campaignError) {
      return new Response(
        JSON.stringify({ error: "Active campaign not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the audience label from the audiences table
    const { data: audience, error: audienceError } = await supabaseAdmin
      .from("audiences")
      .select("label")
      .eq("id", campaign.audience_id)
      .single();

    // Convert spend_milli_cents to spend_cents (integer division)
    const spendCents = Math.floor(campaign.spend_milli_cents / 1000);

    // Return the campaign object with audience label (or id if not found)
    return new Response(
      JSON.stringify({
        id: campaign.id,
        name: campaign.name,
        headline: campaign.headline,
        description: campaign.description,
        cta: campaign.cta,
        audience: audience ? audience.label : campaign.audience_id,
        budgetCents: campaign.budget_cents,
        spendCents: spendCents,
        impressions: campaign.impressions_count,
        clicks: campaign.clicks_count,
        conversions: campaign.conversions_count,
        status: campaign.status,
        createdAt: campaign.created_at,
        updatedAt: campaign.updated_at,
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