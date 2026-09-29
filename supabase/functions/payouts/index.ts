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

    // Only developers can request payouts
    if (profile.role !== "developer") {
      return new Response(
        JSON.stringify({ error: "Only developers can request payouts" }),
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

    const { amount_cents, provider_id } = await req.json();

    // Validate required fields
    if (amount_cents === undefined || amount_cents === null) {
      return new Response(
        JSON.stringify({ error: "Missing required field: amount_cents" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate amount_cents is a positive integer
    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      return new Response(
        JSON.stringify({ error: "Amount must be a positive integer" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Set default provider_id if not provided
    const finalProviderId = provider_id || "demo-ledger";

    // Check if the provider_id is valid (we'll check against a list of allowed providers)
    // For now, we'll allow any provider_id, but we could check against a table.
    // We'll skip validation for simplicity.

    // 1. Calculate the available balance
    const { data: rewards, error: rewardsError } = await supabaseAdmin
      .from("reward_ledger")
      .select("amount_cents, status")
      .eq("developer_id", developer_id);

    if (rewardsError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch rewards" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const available = rewards
      .filter((r) => r.status === "available")
      .reduce((sum, r) => sum + r.amount_cents, 0);
    const reserved = 0; // TODO: sum of requested payouts not yet sent

    const availableBalance = available - reserved;

    if (amount_cents > availableBalance) {
      return new Response(
        JSON.stringify({ error: "Insufficient available balance" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Create a payout record
    const { data: payout, error: payoutError } = await supabaseAdmin
      .from("payouts")
      .insert([
        {
          developer_id,
          amount_cents,
          provider_id: finalProviderId,
          status: "requested",
        }
      ])
      .select()
      .single();

    if (payoutError) {
      return new Response(
        JSON.stringify({ error: "Failed to create payout record" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Create a payout transaction record (mirroring the mock)
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("payout_transactions")
      .insert([
        {
          payout_id: payout.id,
          type: "payout",
          amount_cents: payout.amount_cents,
          provider_id: payout.provider_id,
          status: payout.status,
        }
      ])
      .select()
      .single();

    if (transactionError) {
      return new Response(
        JSON.stringify({ error: "Failed to create payout transaction" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Insert a ledger event for the payout request
    const { error: ledgerError } = await supabaseAdmin
      .from("ledger_events")
      .insert([
        {
          type: "payout",
          amount_cents: payout.amount_cents,
          label: "Payout requested",
          detail: `${finalProviderId} · demo rail, not sent`,
          simulated: false,
        }
      ]);

    if (ledgerError) {
      console.error("Failed to insert ledger event for payout:", ledgerError);
    }

    // 5. Return success
    return new Response(
      JSON.stringify({
        payout: {
          id: payout.id,
          amount_cents: payout.amount_cents,
          status: payout.status,
          created_at: payout.created_at,
        },
        transaction: {
          id: transaction.id,
          type: transaction.type,
          amount_cents: transaction.amount_cents,
          status: transaction.status,
          created_at: transaction.created_at,
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