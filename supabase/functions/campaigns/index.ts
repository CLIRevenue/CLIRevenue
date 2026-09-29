import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey,
);
serve(async (req)=>{
  // Get the Authorization header
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({
      error: "Missing or invalid Authorization header"
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const accessToken = authHeader.substring(7);

  const supabaseUser = createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  );

  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();
  if (userError) {
    return new Response(JSON.stringify({
      error: "Invalid token"
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  // Get the user's profile to check role
  const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
  if (profileError) {
    return new Response(JSON.stringify({
      error: "Failed to fetch profile"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const isAdvertiser = profile.role === "advertiser";
  const isAdmin = profile.role === "admin";
  // Parse the URL to get the path and method
  const url = new URL(req.url);
  const pathParts = url.pathname
  .split("/")
  .filter((part) => part !== "");

  if (pathParts[0] === "campaigns") {
    pathParts.shift();
  }
  // Expected path: /api/campaigns or /api/campaigns/:id
  const method = req.method;
  // Helper to handle errors
  const handleError = (error, status = 500, message = "Internal server error")=>{
    return new Response(JSON.stringify({
      error: message,
      details: error?.message || error
    }), {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    });
  };
  // GET /api/campaigns - list campaigns for the advertiser
  if (method === "GET" && pathParts.length === 2 && pathParts[0] === "api" && pathParts[1] === "campaigns") {
    try {
      // Get the advertiser id from the advertiser profile linked to the user
      const { data: advertiserProfile, error: advError } = await supabaseAdmin.from("advertisers").select("id").eq("profile_id", user.id).single();
      if (advError) {
        return handleError(advError, 404, "Advertiser profile not found");
      }
      const advertiserId = advertiserProfile.id;
      const { data: campaigns, error: campaignsError } = await supabaseAdmin.from("campaigns").select(`
          id,
          name,
          headline,
          description,
          cta,
          audience_id,
          budget_cents,
          spend_milli_cents,
          impressions_count,
          clicks_count,
          conversions_count,
          status,
          created_at,
          updated_at
        `).eq("advertiser_id", advertiserId);
      if (campaignsError) {
        return handleError(campaignsError, 500, "Failed to fetch campaigns");
      }
      // Convert to the expected format (spend_cents from spend_milli_cents)
      const formattedCampaigns = campaigns.map((camp)=>({
          id: camp.id,
          name: camp.name,
          headline: camp.headline,
          description: camp.description,
          cta: camp.cta,
          audience: camp.audience_id,
          // In the economyStore, we transform the audience_id to the audience string (like 'backend') by using the audiences table.
          // However, the frontend's economyStore expects the audience to be the string (from the audiences table) because it uses it to get the campaign name by id? 
          // Actually, the economyStore's getCampaignNameById function uses the campaign's id to find the campaign in the snapshot and then returns the name? 
          // Wait, the economyStore's getCampaignNameById is not shown. We'll assume the frontend expects the audience string (like 'backend') for display.
          // We'll fetch the audience label for each campaign.
          budgetCents: camp.budget_cents,
          spendCents: Math.floor(camp.spend_milli_cents / 1000),
          impressions: camp.impressions_count,
          clicks: camp.clicks_count,
          conversions: camp.conversions_count,
          status: camp.status,
          simulated: false
        }));
      // Now we need to enrich with audience label. Let's do a separate query for audiences to avoid N+1.
      // For simplicity, we'll do a join in the original query? We'll do a separate query for now.
      const { data: audiences, error: audiencesError } = await supabaseAdmin.from("audiences").select("id, label");
      if (audiencesError) {
        // If we can't fetch audiences, we'll fall back to using the audience_id as the audience string.
        return new Response(JSON.stringify(formattedCampaigns.map((camp)=>({
            ...camp,
            audience: camp.audience
          }))), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
      const audienceMap = Object.fromEntries(audiences.map((aud)=>[
          aud.id,
          aud.label
        ]));
      const enrichedCampaigns = formattedCampaigns.map((camp)=>({
          ...camp,
          audience: audienceMap[camp.audience] || camp.audience
        }));
      return new Response(JSON.stringify(enrichedCampaigns), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      return handleError(err);
    }
  }
  // GET /api/campaigns/:id - get a specific campaign for the advertiser
  if (method === "GET" && pathParts.length === 3 && pathParts[0] === "api" && pathParts[1] === "campaigns") {
    try {
      const campaignId = pathParts[2];
      // Get the advertiser id from the advertiser profile linked to the user
      const { data: advertiserProfile, error: advError } = await supabaseAdmin.from("advertisers").select("id").eq("profile_id", user.id).single();
      if (advError) {
        return handleError(advError, 404, "Advertiser profile not found");
      }
      const advertiserId = advertiserProfile.id;
      const { data: campaign, error: campaignError } = await supabaseAdmin.from("campaigns").select(`
          id,
          name,
          headline,
          description,
          cta,
          audience_id,
          budget_cents,
          spend_milli_cents,
          impressions_count,
          clicks_count,
          conversions_count,
          status,
          created_at,
          updated_at
        `).eq("id", campaignId).eq("advertiser_id", advertiserId).single();
      if (campaignError) {
        return handleError(campaignError, 404, "Campaign not found or access denied");
      }
      // Get the audience label
      const { data: audience, error: audienceError } = await supabaseAdmin.from("audiences").select("label").eq("id", campaign.audience_id).single();
      // Convert spend_milli_cents to spend_cents
      const spendCents = Math.floor(campaign.spend_milli_cents / 1000);
      return new Response(JSON.stringify({
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
        updatedAt: campaign.updated_at
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      return handleError(err);
    }
  }
  // PATCH /api/campaigns/:id - update a campaign (advertiser only)
  if (method === "PATCH" && pathParts.length === 3 && pathParts[0] === "api" && pathParts[1] === "campaigns") {
    try {
      const campaignId = pathParts[2];
      // Get the advertiser id from the advertiser profile linked to the user
      const { data: advertiserProfile, error: advError } = await supabaseAdmin.from("advertisers").select("id").eq("profile_id", user.id).single();
      if (advError) {
        return handleError(advError, 404, "Advertiser profile not found");
      }
      const advertiserId = advertiserProfile.id;
      // Check if the campaign exists and belongs to the advertiser
      const { data: existingCampaign, error: existError } = await supabaseAdmin.from("campaigns").select("id").eq("id", campaignId).eq("advertiser_id", advertiserId).single();
      if (existError || !existingCampaign) {
        return new Response(JSON.stringify({
          error: "Campaign not found or access denied"
        }), {
          status: 404,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
      const updates = await req.json();
      // We'll allow updating: name, headline, description, cta, audience_id, budget_cents, status
      // We'll not allow changing advertiser_id or the counts (those are updated via other endpoints)
      const allowedUpdates = [
        "name",
        "headline",
        "description",
        "cta",
        "audience_id",
        "budget_cents",
        "status"
      ];
      const filteredUpdates = {};
      for (const key of allowedUpdates){
        if (updates[key] !== undefined) {
          filteredUpdates[key] = updates[key];
        }
      }
      // Validate audience_id if provided
      if (filteredUpdates.audience_id) {
        const { data: audienceData, error: audienceError } = await supabaseAdmin.from("audiences").select("id").eq("id", filteredUpdates.audience_id).single();
        if (audienceError) {
          return new Response(JSON.stringify({
            error: "Invalid audience"
          }), {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          });
        }
      }
      // Validate status if provided
      if (filteredUpdates.status) {
        const validStatuses = [
          "draft",
          "active",
          "paused",
          "completed",
          "archived"
        ];
        if (!validStatuses.includes(filteredUpdates.status)) {
          return new Response(JSON.stringify({
            error: "Invalid status"
          }), {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          });
        }
      }
      // Validate budget_cents if provided
      if (filteredUpdates.budget_cents !== undefined) {
        if (typeof filteredUpdates.budget_cents !== "number" || filteredUpdates.budget_cents < 0) {
          return new Response(JSON.stringify({
            error: "Budget must be a non-negative integer"
          }), {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          });
        }
      }
      const { data: updatedCampaign, error: updateError } = await supabaseAdmin.from("campaigns").update(filteredUpdates).eq("id", campaignId).eq("advertiser_id", advertiserId).select().single();
      if (updateError) {
        return handleError(updateError, 500, "Failed to update campaign");
      }
      // Insert a ledger event for campaign update? We'll skip for now.
      // Get audience label for response
      const { data: audienceData, error: audienceError } = await supabaseAdmin.from("audiences").select("label").eq("id", updatedCampaign.audience_id).single();
      // Convert spend_milli_cents to spend_cents for response
      const spendCents = Math.floor(updatedCampaign.spend_milli_cents / 1000);
      return new Response(JSON.stringify({
        id: updatedCampaign.id,
        name: updatedCampaign.name,
        headline: updatedCampaign.headline,
        description: updatedCampaign.description,
        cta: updatedCampaign.cta,
        audience: audienceData ? audienceData.label : updatedCampaign.audience_id,
        budget_cents: updatedCampaign.budget_cents,
        spend_cents: spendCents,
        impressions_count: updatedCampaign.impressions_count,
        clicks_count: updatedCampaign.clicks_count,
        conversions_count: updatedCampaign.conversions_count,
        status: updatedCampaign.status,
        created_at: updatedCampaign.created_at,
        updated_at: updatedCampaign.updated_at
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      return handleError(err);
    }
  }
  // POST /api/campaigns - create a new campaign (advertiser only)
  if (method === "POST" && pathParts.length === 2 && pathParts[0] === "api" && pathParts[1] === "campaigns") {
    try {
      // Get the advertiser id from the advertiser profile linked to the user
      const { data: advertiserProfile, error: advError } = await supabaseAdmin.from("advertisers").select("id").eq("profile_id", user.id).single();
      if (advError) {
        return handleError(advError, 404, "Advertiser profile not found");
      }
      const advertiserId = advertiserProfile.id;
      const { name, headline, description, cta, audience_id, budget_cents } = await req.json();
      // Validate required fields
      if (!name || !headline || !audience_id || budget_cents === undefined) {
        return new Response(JSON.stringify({
          error: "Missing required fields"
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
      // Validate audience_id
      const { data: audienceData, error: audienceError } = await supabaseAdmin.from("audiences").select("id").eq("id", audience_id).single();
      if (audienceError) {
        return new Response(JSON.stringify({
          error: "Invalid audience"
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
      // Validate budget_cents
      if (typeof budget_cents !== "number" || budget_cents < 0) {
        return new Response(JSON.stringify({
          error: "Budget must be a non-negative integer"
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
      // Set default values
      const finalCta = cta || "Learn more";
      const finalDescription = description || null;
      const { data: newCampaign, error: insertError } = await supabaseAdmin.from("campaigns").insert([
        {
          advertiser_id: advertiserId,
          name,
          headline,
          description: finalDescription,
          cta: finalCta,
          audience_id,
          budget_cents,
          spend_milli_cents: 0,
          impressions_count: 0,
          clicks_count: 0,
          conversions_count: 0,
          status: "draft"
        }
      ]).select().single();
      if (insertError) {
        return handleError(insertError, 500, "Failed to create campaign");
      }
      // Get audience label for response
      const { data: audienceData2, error: audienceError2 } = await supabaseAdmin.from("audiences").select("label").eq("id", newCampaign.audience_id).single();
      // Convert spend_milli_cents to spend_cents (which is 0)
      const spendCents = 0;
      return new Response(JSON.stringify({
        id: newCampaign.id,
        name: newCampaign.name,
        headline: newCampaign.headline,
        description: newCampaign.description,
        cta: newCampaign.cta,
        audience: audienceData2 ? audienceData2.label : newCampaign.audience_id,
        budgetCents: newCampaign.budget_cents,
        spendCents: spendCents,
        impressions: newCampaign.impressions_count,
        clicks: newCampaign.clicks_count,
        conversions: newCampaign.conversions_count,
        status: newCampaign.status,
        createdAt: newCampaign.created_at,
        updatedAt: newCampaign.updated_At
      }), {
        status: 201,
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      return handleError(err);
    }
  }
  // If none of the above matched, return 404
  return new Response(JSON.stringify({
    error: "Not found"
  }), {
    status: 404,
    headers: {
      "Content-Type": "application/json"
    }
  });
});
