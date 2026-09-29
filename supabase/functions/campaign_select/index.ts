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
      headers: { "Content-Type": "application/json" } });
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

    // Only advertisers and admins can select the active campaign
    if (profile.role !== "advertiser" && profile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only advertisers and admins can select the active campaign" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the campaign ID from the URL
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter((part) => part !== "");
    // Expected path: /api/campaigns/:id/select
    if (pathParts.length !== 4 || pathParts[0] !== "api" || pathParts[1] !== "campaigns" || pathParts[3] !== "select") {
      return new Response(
        JSON.stringify({ error: "Invalid URL" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const campaignId = pathParts[2];

    // Get the advertiser id for the user (to check ownership)
    const { data: advertiserProfile, error: advError } = await supabaseAdmin
      .from("advertisers")
      .select("id")
      .eq("profile_id", user.id)
      .single();

    if (advError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch advertiser profile" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if the campaign belongs to the advertiser (if the user is an advertiser, not admin)
    if (profile.role === "advertiser") {
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("campaigns")
        .select("id, advertiser_id")
        .eq("id", campaignId)
        .single();

      if (campaignError) {
        return new Response(
          JSON.stringify({ error: "Campaign not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      if (campaign.advertiser_id !== advertiserProfile.id) {
        return new Response(
          JSON.stringify({ error: "Campaign does not belong to you" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Update the platform_settings table to set the active campaign
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("platform_settings")
      .update({ active_campaign_id: campaignId })
      .eq("id", (() => {
        // We need to get the settings row id. There's only one row, but we can select it.
        // We'll do a separate query to get the id.
        return null;
      })());

    // Since we don't know the id of the settings row, we'll update by matching the current active_campaign_id or just update the first row.
    // Better: we can update the table without a condition, but we want to ensure we update the single row.
    // We'll do: update platform_settings set active_campaign_id = $1 where true;
    // But we need to return the updated row.

    // Let's do it in two steps: first get the settings row id, then update.
    const { data: settingsData, error: settingsDataError } = await supabaseAdmin
      .from("platform_settings")
      .select("id")
      .single();

    if (settingsDataError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch platform settings" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: updatedSettings, error: updateError } = await supabaseAdmin
      .from("platform_settings")
      .update({ active_campaign_id: campaignId })
      .eq("id", settingsData.id)
      .select()
      .single();

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to update active campaign" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Insert a ledger event for campaign selection? We'll skip for now.

    return new Response(
      JSON.stringify({
        active_campaign_id: updatedSettings.active_campaign_id,
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