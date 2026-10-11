/**
 * Tests for the publisher-scoped placement create path.
 *
 * These run the real production module -- no copy, no reimplementation -- with
 * a fake service-role client. The fake is deliberately not a script: it
 * enforces the same `UNIQUE (publisher_id, placement_key)` constraint the real
 * table does, so the duplicate path is reached the way it is reached in
 * production instead of being told to happen.
 *
 * Run with: npm run test:deno
 */
import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizePlacementCreate,
  classifyPlacementFailure,
  handleCreatePlacement,
  toPlacementRecord,
  validatePlacementInput,
} from "./placementCreate.ts";
import { hashPublisherKey } from "./publisherAuth.ts";

const PUBLISHER_A = "11111111-1111-4111-8111-111111111111";
const PUBLISHER_B = "22222222-2222-4222-8222-222222222222";
const KEY_A = `pk_test_${"a".repeat(40)}`;
const KEY_B = `pk_test_${"b".repeat(40)}`;

type Row = Record<string, unknown>;

type KeyRow = {
  keyId: string;
  publisherId: string;
  revokedAt?: string | null;
  status?: string;
};

/**
 * A service-role client stand-in.
 *
 * Only the chain shapes `authenticatePublisher` and `handleCreatePlacement`
 * actually use are implemented, and each terminal returns a real Promise. The
 * builder is itself awaitable so the fire-and-forget
 * `publisher_keys.update(...).eq(...)` usage stamp inside
 * `authenticatePublisher` resolves the way the real client does.
 */
async function fakeAdmin(config: {
  keys: Record<string, KeyRow>;
  placements?: Row[];
  keyLookupError?: { code?: string; message?: string } | null;
  /** Force the insert to fail with something other than a unique violation. */
  insertError?: { code?: string; message?: string } | null;
}) {
  const hashes = new Map<string, KeyRow>();
  for (const [raw, row] of Object.entries(config.keys)) {
    hashes.set(await hashPublisherKey(raw), row);
  }

  const placements: Row[] = [...(config.placements ?? [])];
  const inserted: Row[] = [];

  const admin = {
    from(table: string) {
      if (table === "publisher_keys") {
        let mode: "select" | "update" = "select";
        let keyHash: string | null = null;
        const builder: Record<string, unknown> = {
          select: () => builder,
          update: () => {
            mode = "update";
            return builder;
          },
          eq: (column: string, value: unknown) => {
            if (column === "key_hash") keyHash = String(value);
            return builder;
          },
          maybeSingle: () => {
            if (mode === "update") return Promise.resolve({ data: null, error: null });
            if (config.keyLookupError) {
              return Promise.resolve({ data: null, error: config.keyLookupError });
            }
            const row = keyHash ? hashes.get(keyHash) : undefined;
            if (!row) return Promise.resolve({ data: null, error: null });
            return Promise.resolve({
              data: {
                id: row.keyId,
                publisher_id: row.publisherId,
                revoked_at: row.revokedAt ?? null,
                publishers: { id: row.publisherId, status: row.status ?? "active" },
              },
              error: null,
            });
          },
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        };
        return builder;
      }

      // placements
      let mode: "select" | "insert" = "select";
      let pending: Row | null = null;
      let publisherFilter: string | null = null;
      let keyFilter: string | null = null;

      const readBack = () => {
        const row = placements.find(
          (p) => p.publisher_id === publisherFilter && p.placement_key === keyFilter,
        );
        return Promise.resolve({ data: row ?? null, error: null });
      };

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (row: Row) => {
          mode = "insert";
          pending = row;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          if (column === "publisher_id") publisherFilter = String(value);
          if (column === "placement_key") keyFilter = String(value);
          return builder;
        },
        limit: () => builder,
        single: () => {
          if (mode !== "insert" || !pending) {
            return Promise.resolve({ data: null, error: { code: "PGRST116" } });
          }
          if (config.insertError) {
            return Promise.resolve({ data: null, error: config.insertError });
          }
          const row = pending;
          const clash = placements.some(
            (p) => p.publisher_id === row.publisher_id && p.placement_key === row.placement_key,
          );
          if (clash) {
            return Promise.resolve({
              data: null,
              error: {
                code: "23505",
                message: "duplicate key value violates unique constraint placements_key",
              },
            });
          }
          const created: Row = {
            id: `id-${inserted.length + 1}`,
            placement_key: row.placement_key,
            name: row.name ?? null,
            enabled: row.enabled ?? true,
            allowed_audience_id: null,
          };
          placements.push({ ...row, ...created });
          inserted.push(row);
          return Promise.resolve({ data: created, error: null });
        },
        maybeSingle: () => {
          if (mode === "insert") {
            return Promise.resolve({ data: null, error: { code: "PGRST116" } });
          }
          return readBack();
        },
        then: (resolve: (v: unknown) => unknown) => readBack().then(resolve),
      };
      return builder;
    },
  };

  return {
    // The production signature takes a real SupabaseClient because it hands
    // the same client to authenticatePublisher. The fake implements only the
    // query surface exercised here, so it is narrowed at this boundary rather
    // than by loosening the production type to "anything".
    admin: admin as unknown as SupabaseClient,
    inserted,
    placements,
  };
}

const adminWith = (keys: Record<string, KeyRow>, extra: Record<string, unknown> = {}) =>
  fakeAdmin({ keys, ...extra });

Deno.test("placement create: input validation", async (t) => {
  await t.step("accepts a minimal request and defaults name and enabled", () => {
    const result = validatePlacementInput({ placementKey: "home-top" });
    assertEquals(result.ok, true);
    assertEquals(result.value, { placementKey: "home-top", name: null, enabled: true });
  });

  await t.step("trims the key so trailing whitespace is not baked into a selector", () => {
    const result = validatePlacementInput({ placementKey: "  sidebar  " });
    assertEquals(result.value?.placementKey, "sidebar");
  });

  await t.step("accepts a disabled placement and a real name", () => {
    const result = validatePlacementInput({ placementKey: "footer", name: "Footer", enabled: false });
    assertEquals(result.value, { placementKey: "footer", name: "Footer", enabled: false });
  });

  await t.step("treats a blank name as no name", () => {
    assertEquals(validatePlacementInput({ placementKey: "footer", name: "   " }).value?.name, null);
  });

  await t.step("rejects a missing or non-string key", () => {
    assertEquals(validatePlacementInput({}).ok, false);
    assertEquals(validatePlacementInput({ placementKey: 7 }).problems.length, 1);
    assertEquals(validatePlacementInput(null).ok, false);
    assertEquals(validatePlacementInput("nope").ok, false);
  });

  await t.step("rejects a key too short or too long", () => {
    assertEquals(validatePlacementInput({ placementKey: "a" }).ok, false);
    assertEquals(validatePlacementInput({ placementKey: "a".repeat(65) }).ok, false);
    assertEquals(validatePlacementInput({ placementKey: "a".repeat(64) }).ok, true);
  });

  await t.step("rejects a key that is unsafe in a selector or a URL", () => {
    // The generated integration interpolates the key straight into
    // document.querySelector, so anything that can terminate a selector is a
    // real injection surface, not a style preference.
    for (const key of ["Home", "home top", "home/top", "home.top", "home?", "-home", "home#"]) {
      const result = validatePlacementInput({ placementKey: key });
      assertEquals(result.ok, false, `expected ${key} to be rejected`);
    }
  });

  await t.step("rejects a non-boolean enabled rather than coercing it", () => {
    const result = validatePlacementInput({ placementKey: "home", enabled: "yes" });
    assertEquals(result.ok, false);
    assertEquals(result.problems[0], "enabled must be a boolean.");
  });

  await t.step("rejects a non-string name and an over-long one", () => {
    assertEquals(validatePlacementInput({ placementKey: "home", name: 3 }).ok, false);
    assertEquals(validatePlacementInput({ placementKey: "home", name: "x".repeat(121) }).ok, false);
  });

  await t.step("reports every problem at once", () => {
    const result = validatePlacementInput({ placementKey: "A", name: 3, enabled: "yes" });
    assertEquals(result.ok, false);
    assertEquals(result.problems.length, 3);
  });
});

Deno.test("placement create: authorization", async (t) => {
  await t.step("omitting publisherId is fine -- the field is never load-bearing", () => {
    assertEquals(authorizePlacementCreate({ authenticatedPublisherId: PUBLISHER_A }), { ok: true });
    assertEquals(
      authorizePlacementCreate({ authenticatedPublisherId: PUBLISHER_A, claimedPublisherId: null }),
      { ok: true },
    );
  });

  await t.step("sending your own publisherId is accepted", () => {
    assertEquals(
      authorizePlacementCreate({
        authenticatedPublisherId: PUBLISHER_A,
        claimedPublisherId: PUBLISHER_A,
      }),
      { ok: true },
    );
  });

  await t.step("naming another publisher is refused", () => {
    assertEquals(
      authorizePlacementCreate({
        authenticatedPublisherId: PUBLISHER_A,
        claimedPublisherId: PUBLISHER_B,
      }),
      { ok: false, failure: "PUBLISHER_MISMATCH" },
    );
  });

  await t.step("a non-string claim is refused rather than ignored", () => {
    assertEquals(
      authorizePlacementCreate({
        authenticatedPublisherId: PUBLISHER_A,
        claimedPublisherId: { id: PUBLISHER_B },
      }),
      { ok: false, failure: "PUBLISHER_MISMATCH" },
    );
  });
});

Deno.test("placement create: database failure classification", async (t) => {
  await t.step("a unique violation is a duplicate, not a crash", () => {
    assertEquals(classifyPlacementFailure({ code: "23505" }), "DUPLICATE_PLACEMENT");
  });

  await t.step("a foreign-key violation is an invalid placement", () => {
    assertEquals(classifyPlacementFailure({ code: "23503" }), "INVALID_PLACEMENT");
  });

  await t.step("anything else is an internal error", () => {
    assertEquals(classifyPlacementFailure({ code: "42P01" }), "INTERNAL_ERROR");
    assertEquals(classifyPlacementFailure({ code: null }), "INTERNAL_ERROR");
    assertEquals(classifyPlacementFailure(null), "INTERNAL_ERROR");
  });
});

Deno.test("placement create: row shape", async (t) => {
  await t.step("maps a row to the wire shape the GET route returns", () => {
    assertEquals(
      toPlacementRecord({
        id: "p1",
        placement_key: "home",
        name: "Home",
        enabled: true,
        allowed_audience_id: "aud1",
      }),
      { id: "p1", key: "home", name: "Home", enabled: true, allowedAudienceId: "aud1" },
    );
  });

  await t.step("a missing name is null, not undefined", () => {
    const record = toPlacementRecord({ id: "p1", placement_key: "home", enabled: false });
    assertEquals(record.name, null);
    assertEquals(record.allowedAudienceId, null);
    assertEquals(record.enabled, false);
  });
});

Deno.test("placement create: the handler", async (t) => {
  const keys = {
    [KEY_A]: { keyId: "key-a", publisherId: PUBLISHER_A },
    [KEY_B]: { keyId: "key-b", publisherId: PUBLISHER_B },
  };

  await t.step("creates a placement owned by the publisher the key resolved to", async () => {
    const { admin, inserted } = await adminWith(keys);
    const result = await handleCreatePlacement(admin, KEY_A, {
      placementKey: "home-top",
      name: "Home top",
    });

    assertEquals(result.status, 200);
    assertEquals(result.body?.publisherId, PUBLISHER_A);
    assertEquals(result.body?.created, true);
    assertEquals(result.body?.placement.key, "home-top");
    assertEquals(result.body?.placement.name, "Home top");
    assertEquals(inserted.length, 1);
    assertEquals(inserted[0].publisher_id, PUBLISHER_A);
  });

  await t.step("never writes a publisher the request did not prove", async () => {
    const { admin, inserted } = await adminWith(keys);
    const result = await handleCreatePlacement(admin, KEY_A, {
      placementKey: "home",
      // The attack: claim publisher B while authenticating as A.
      publisherId: PUBLISHER_B,
    });

    assertEquals(result.status, 403);
    assertEquals(result.code, "PUBLISHER_MISMATCH");
    assertEquals(inserted.length, 0);
  });

  await t.step("still writes the derived publisher when the claim agrees", async () => {
    const { admin, inserted } = await adminWith(keys);
    const result = await handleCreatePlacement(admin, KEY_A, {
      placementKey: "home",
      publisherId: PUBLISHER_A,
    });
    assertEquals(result.status, 200);
    assertEquals(inserted[0].publisher_id, PUBLISHER_A);
  });

  await t.step("rejects a missing key without touching the database", async () => {
    const { admin, inserted } = await adminWith(keys);
    const result = await handleCreatePlacement(admin, undefined, { placementKey: "home" });
    assertEquals(result.status, 401);
    assertEquals(result.code, "UNAUTHORIZED");
    assertEquals(inserted.length, 0);
  });

  await t.step("rejects a malformed key with the same 401 as a wrong one", async () => {
    const { admin } = await adminWith(keys);
    const malformed = await handleCreatePlacement(admin, "not-a-key", { placementKey: "home" });
    const unknown = await handleCreatePlacement(admin, `pk_test_${"c".repeat(40)}`, {
      placementKey: "home",
    });
    assertEquals(malformed.status, 401);
    assertEquals(unknown.status, 401);
    // Indistinguishable on purpose: the response must not reveal which keys exist.
    assertEquals(malformed.code, unknown.code);
  });

  await t.step("rejects a revoked key", async () => {
    const { admin, inserted } = await fakeAdmin({
      keys: { [KEY_A]: { keyId: "key-a", publisherId: PUBLISHER_A, revokedAt: "2026-01-01T00:00:00Z" } },
    });
    const result = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" });
    assertEquals(result.status, 401);
    assertEquals(inserted.length, 0);
  });

  await t.step("rejects a suspended publisher", async () => {
    const { admin } = await fakeAdmin({
      keys: { [KEY_A]: { keyId: "key-a", publisherId: PUBLISHER_A, status: "suspended" } },
    });
    const result = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" });
    assertEquals(result.status, 401);
  });

  await t.step("a broken key lookup is a 500, never a 401", async () => {
    // Reporting an outage as "your key is invalid" would tell a publisher with
    // a working key that it was revoked.
    const { admin, inserted } = await fakeAdmin({
      keys,
      keyLookupError: { code: "57014", message: "statement timeout" },
    });
    const result = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" });
    assertEquals(result.status, 500);
    assertEquals(result.code, "INTERNAL_ERROR");
    assertEquals(inserted.length, 0);
  });

  await t.step("rejects invalid input before any write", async () => {
    const { admin, inserted } = await adminWith(keys);
    const result = await handleCreatePlacement(admin, KEY_A, {
      placementKey: "Home Top!",
      enabled: "yes",
    });
    assertEquals(result.status, 400);
    assertEquals(result.code, "INVALID_PLACEMENT");
    assertEquals(inserted.length, 0);
  });

  await t.step("a duplicate key succeeds with created:false and writes nothing new", async () => {
    const { admin, inserted } = await adminWith(keys);
    const first = await handleCreatePlacement(admin, KEY_A, { placementKey: "home", name: "Home" });
    const second = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" });

    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(second.body?.created, false);
    // The same row comes back, not a second one under the caller's new name.
    assertEquals(second.body?.placement.id, first.body?.placement.id);
    assertEquals(second.body?.placement.name, "Home");
    assertEquals(inserted.length, 1);
  });

  await t.step("two publishers can hold the same placement key", async () => {
    // UNIQUE is (publisher_id, placement_key), so this is the same key name
    // under two accounts -- not a conflict.
    const { admin, inserted } = await adminWith(keys);
    const a = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" });
    const b = await handleCreatePlacement(admin, KEY_B, { placementKey: "home" });

    assertEquals(a.status, 200);
    assertEquals(a.body?.created, true);
    assertEquals(b.status, 200);
    assertEquals(b.body?.created, true);
    assertEquals(b.body?.publisherId, PUBLISHER_B);
    assertEquals(inserted.length, 2);
    assertEquals(inserted[1].publisher_id, PUBLISHER_B);
  });

  await t.step("publisher B's row is never returned to publisher A", async () => {
    // Publisher A creates `home` twice. The duplicate read-back is scoped to A,
    // so it can only ever find A's row -- B having the same key must not make
    // A's create succeed against somebody else's record.
    const { admin } = await fakeAdmin({
      keys,
      placements: [
        {
          id: "b-home",
          publisher_id: PUBLISHER_B,
          placement_key: "home",
          name: "B's home",
          enabled: true,
          allowed_audience_id: null,
        },
      ],
    });
    const result = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" });
    assertEquals(result.status, 200);
    assertEquals(result.body?.created, true);
    assertEquals(result.body?.placement.id !== "b-home", true);
  });

  await t.step("an unexpected insert failure is a 500, not a duplicate", async () => {
    const { admin, inserted } = await fakeAdmin({
      keys,
      insertError: { code: "42P01", message: "relation does not exist" },
    });
    const result = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" });
    assertEquals(result.status, 500);
    assertEquals(result.code, "INTERNAL_ERROR");
    assertEquals(inserted.length, 0);
  });

  await t.step("a duplicate whose row cannot be read back is a 500", async () => {
    // A 23505 with no row visible under this publisher means the constraint
    // fired on something else; calling that a duplicate would point the caller
    // at the wrong record.
    const { admin } = await fakeAdmin({
      keys,
      placements: [
        {
          id: "b-home",
          publisher_id: PUBLISHER_B,
          placement_key: "home",
          name: null,
          enabled: true,
          allowed_audience_id: null,
        },
      ],
      // Force the collision without a visible row: a different table's unique
      // index firing on the same statement.
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const result = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" });
    assertEquals(result.status, 500);
    assertEquals(result.code, "INTERNAL_ERROR");
  });

  await t.step("a rate-limited publisher is refused with a retry delay", async () => {
    const { admin, inserted } = await adminWith(keys);
    const limiter = () => ({ allowed: false, retryAfterMs: 1500 });
    const result = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" }, { limit: limiter });

    assertEquals(result.status, 429);
    assertEquals(result.code, "RATE_LIMITED");
    assertEquals(result.status === 429 ? result.retryAfterMs : null, 1500);
    assertEquals(inserted.length, 0);
  });

  await t.step("the rate limit is keyed on the derived publisher, after auth", async () => {
    const { admin } = await adminWith(keys);
    const seen: string[] = [];
    const limiter = (id: string) => {
      seen.push(id);
      return { allowed: true, retryAfterMs: 0 };
    };
    await handleCreatePlacement(admin, KEY_A, { placementKey: "home", publisherId: PUBLISHER_B }, { limit: limiter });
    // Authenticated as A, so A is what got the budget -- not the claimed id.
    assertEquals(seen, [PUBLISHER_A]);
  });

  await t.step("a limiter that allows passes through untouched", async () => {
    const { admin, inserted } = await adminWith(keys);
    let calls = 0;
    const limiter = () => {
      calls += 1;
      return { allowed: true, retryAfterMs: 0 };
    };
    const result = await handleCreatePlacement(admin, KEY_A, { placementKey: "home" }, { limit: limiter });
    assertEquals(calls, 1);
    assertEquals(result.status, 200);
    assertEquals(inserted.length, 1);
  });
});