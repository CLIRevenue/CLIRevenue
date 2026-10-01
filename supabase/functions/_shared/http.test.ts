import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corsFor, json, apiError, optionsResponse, originFor, serveWithCors } from "./http.ts";

/**
 * CORS tests.
 *
 * The properties that matter, and the reason each is non-obvious:
 *
 *   1. an allow-listed origin gets ITS OWN value echoed back;
 *   2. an unrelated origin gets NO allow-origin header at all -- never another
 *      allow-listed site's origin;
 *   3. the origin is preserved on EVERY response class: 2xx, 4xx, 5xx, no-fill
 *      and auth failure, plus the OPTIONS preflight;
 *   4. with no allow-list configured the default stays a wildcard, because
 *      these functions read no cookie and the caller always presents its token
 *      explicitly.
 *
 * APP_ORIGINS is read from the Deno environment, so each case sets it before
 * exercising the header builders.
 */

const ALLOWED_A = "https://app.clirevenue.test";
const ALLOWED_B = "https://studio.clirevenue.test";
const OUTSIDER = "https://evil.example";

/**
 * Run `fn` with APP_ORIGINS set, restoring it afterwards.
 *
 * Deliberately async-aware: a plain try/finally around `return fn()` restores
 * the environment the moment the promise is *created*, not when it settles,
 * which tears the allow-list down mid-test. Every caller awaits this.
 */
async function withOrigins<T>(value: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  const previous = Deno.env.get("APP_ORIGINS");
  if (value === undefined) Deno.env.delete("APP_ORIGINS");
  else Deno.env.set("APP_ORIGINS", value);
  try {
    return await fn();
  } finally {
    if (previous === undefined) Deno.env.delete("APP_ORIGINS");
    else Deno.env.set("APP_ORIGINS", previous);
  }
}

const reqFrom = (origin: string, path = "https://x.functions.supabase.co/ads/deliver") =>
  new Request(path, { headers: { origin } });

const acao = (res: Response): string | null => res.headers.get("Access-Control-Allow-Origin");

Deno.test("cors", async (t) => {
  await t.step("with no allow-list configured the default is a wildcard", async () => {
    await withOrigins(undefined, () => {
      assertEquals(originFor(reqFrom(OUTSIDER)), "*");
      assertEquals(corsFor(reqFrom(OUTSIDER))["Access-Control-Allow-Origin"], "*");
    });
  });

  await t.step("an allow-listed origin receives its own value, not another's", async () => {
    await withOrigins(`${ALLOWED_A}, ${ALLOWED_B}`, () => {
      assertEquals(originFor(reqFrom(ALLOWED_A)), ALLOWED_A);
      assertEquals(originFor(reqFrom(ALLOWED_B)), ALLOWED_B);
    });
  });

  await t.step("an unrelated origin receives NO allow-origin header", async () => {
    await withOrigins(`${ALLOWED_A}, ${ALLOWED_B}`, () => {
      // The regression this guards: previously this returned ALLOWED_A, so an
      // unrelated origin was handed another site's origin in a header.
      assertEquals(originFor(reqFrom(OUTSIDER)), "");
      const headers = corsFor(reqFrom(OUTSIDER));
      assertEquals(headers["Access-Control-Allow-Origin"], undefined);
    });
  });

  await t.step("a request with no Origin header is treated as unknown, not as allow-listed", async () => {
    await withOrigins(ALLOWED_A, () => {
      const noOrigin = new Request("https://x.functions.supabase.co/ads/deliver");
      assertEquals(originFor(noOrigin), "");
    });
  });

  await t.step("the origin survives every response class", async () => {
    await withOrigins(`${ALLOWED_A}, ${ALLOWED_B}`, () => {
      const req = reqFrom(ALLOWED_B);
      const responses: Array<[string, Response]> = [
        ["2xx success", json({ ok: true }, 200, req)],
        ["201 created", json({ ok: true }, 201, req)],
        ["4xx client error", apiError("BAD", "no", 400, {}, req)],
        ["401 auth failure", apiError("UNAUTHORIZED", "Sign in is required.", 401, {}, req)],
        ["429 rate limited", apiError("RATE_LIMITED", "slow down", 429, {}, req)],
        ["5xx server error", apiError("INTERNAL_ERROR", "boom", 500, {}, req)],
        ["204 no-fill style", new Response(null, { status: 204, headers: corsFor(req) })],
        ["OPTIONS preflight", optionsResponse(req)],
      ];
      for (const [label, res] of responses) {
        assertEquals(acao(res), ALLOWED_B, `${label} must echo the caller's origin`);
      }
    });
  });

  await t.step("an unrelated origin gets no allow-origin on any response class", async () => {
    await withOrigins(`${ALLOWED_A}, ${ALLOWED_B}`, () => {
      const req = reqFrom(OUTSIDER);
      const responses: Array<[string, Response]> = [
        ["2xx success", json({ ok: true }, 200, req)],
        ["4xx", apiError("BAD", "no", 400, {}, req)],
        ["401 auth failure", apiError("UNAUTHORIZED", "Sign in is required.", 401, {}, req)],
        ["5xx", apiError("INTERNAL_ERROR", "boom", 500, {}, req)],
        ["OPTIONS preflight", optionsResponse(req)],
      ];
      for (const [label, res] of responses) {
        assertEquals(acao(res), null, `${label} must not name any origin`);
      }
    });
  });

  await t.step("Vary: Origin is set whenever an allow-list exists, for cache safety", async () => {
    await withOrigins(`${ALLOWED_A}, ${ALLOWED_B}`, () => {
      // Without Vary, a shared cache could hand origin A's ACAO to origin B.
      assertEquals(corsFor(reqFrom(ALLOWED_A))["Vary"], "Origin");
      assertEquals(corsFor(reqFrom(OUTSIDER))["Vary"], "Origin");
    });
  });

  await t.step("an explicit req still wins over the ambient scope", async () => {
    await withOrigins(`${ALLOWED_A}, ${ALLOWED_B}`, () => {
      const handler = serveWithCors((req) => json({ seen: req.url }, 200, req));
      return handler(reqFrom(ALLOWED_B)).then((res) => {
        assertEquals(acao(res), ALLOWED_B);
      });
    });
  });

  await t.step("error paths built WITHOUT an explicit req still echo the right origin", async () => {
    // This is the whole point of serveWithCors. The 100 apiError() call
    // sites that never threaded a Request would otherwise answer with the
    // first allow-listed origin -- and an auth failure is exactly the
    // response an attacker's browser reads.
    await withOrigins(`${ALLOWED_A}, ${ALLOWED_B}`, async () => {
      const handler = serveWithCors(() => {
        // No `req` argument anywhere in sight, exactly like the real helpers.
        return apiError("UNAUTHORIZED", "Sign in is required.", 401);
      });
      const allowed = await handler(reqFrom(ALLOWED_B));
      assertEquals(acao(allowed), ALLOWED_B);

      const rejected = await handler(reqFrom(OUTSIDER));
      assertEquals(acao(rejected), null);
    });
  });

  await t.step("concurrent requests do not see each other's origin", async () => {
    await withOrigins(`${ALLOWED_A}, ${ALLOWED_B}`, async () => {
      // The ambient request must be per-async-context. A module-level
      // variable would let these interleave and answer with the wrong origin.
      const handler = serveWithCors(() => {
        // Yield, so an interleaving bug would actually manifest.
        return new Promise<Response>((resolve) =>
          setTimeout(() => resolve(apiError("UNAUTHORIZED", "no", 401)), 5)
        );
      });
      const [a, b] = await Promise.all([handler(reqFrom(ALLOWED_A)), handler(reqFrom(ALLOWED_B))]);
      assertEquals(acao(a), ALLOWED_A);
      assertEquals(acao(b), ALLOWED_B);
    });
  });

  await t.step("outside a request scope there is no ambient origin", async () => {
    await withOrigins(`${ALLOWED_A}, ${ALLOWED_B}`, () => {
      // Fail closed rather than guessing the first entry.
      assertEquals(originFor(), "");
    });
  });
});