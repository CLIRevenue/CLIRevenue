/* =============================================================
   The internal backend
   -------------------------------------------------------------
   The Supabase-hosted functions this application calls with a user
   JWT: campaigns, rewards, payouts, the contact inbox, the admin
   console. It is a different host from the public ad gateway
   (api.clirevenue.in), and the two must never be conflated -- the
   gateway-routing contract in tests/gateway-routing.test.js exists
   precisely because they once were.

   WHY THERE IS A DEFAULT HERE
   ---------------------
   VITE_API_BASE_URL is a build-time variable, and a build made
   without one -- a clean checkout, a CI build, a Cloudflare Pages
   build -- used to resolve the base to the empty string, which sent
   every call to a same-origin path such as /api/campaigns. A static
   host answers that path with the single-page app, not with a
   function, so the campaign list came back as "Route not found." The
   build was not misconfigured; it was configured with nothing, and
   nothing was not a valid answer.

   So the internal backend has a default, the same way the ad gateway
   has one in clirevenue.js: a named constant, so a build that
   configures nothing still addresses the intended host instead of
   guessing from an unrelated variable. A deployment that DOES proxy
   /api/* on its own origin keeps working, because the same-origin
   candidate is still tried first and the candidate walker only falls
   through on a routing miss (404/405), never on a real error.

   The two defaults are different hosts on purpose. The gateway is
   public and unauthenticated; this one is the internal backend, and
   every call to it carries the user's own JWT.
   ============================================================= */

export const DEFAULT_INTERNAL_BACKEND = 'https://xoacisojqsqlqzvzzusx.supabase.co/functions/v1'
