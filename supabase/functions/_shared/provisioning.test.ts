import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildProvisioningResponse,
  mayRevealPublishableKey,
  publisherNameFromEmail,
  type ProvisioningSlot,
} from "./provisioning.ts";

/**
 * Tests for the provisioning response shaping.
 *
 * This module is the only place a publishable key is allowed to become
 * part of a response body, so the tests below are mostly about the ways it
 * must NOT. A key is a capability: the raw string is the authorisation to
 * request ads, only its sha256 is stored, and the response carrying it
 * travels back over a bearer-authenticated channel. Every rule here exists
 * so that a capability cannot leak into a log, an error, a retry, or a
 * second caller's view.
 */

const TEST_KEY = `pk_test_${"a".repeat(43)}`;
const LIVE_KEY = `pk_live_${"b".repeat(43)}`;

const slot = (over: Partial<ProvisioningSlot> = {}): ProvisioningSlot => ({
  publisher_id: "11111111-1111-4111-8111-111111111111",
  publisher_name: "ada@example.com",
  publisher_created: true,
  needs_key: true,
  key_id: "22222222-2222-4222-8222-222222222222",
  key_prefix: TEST_KEY.slice(0, 12),
  key_env: "test",
  key_label: "signup",
  key_created_at: "2026-10-02T00:00:00Z",
  ...over,
});

Deno.test("publisher name from the signup email", async (t) => {
  await t.step("uses the local part, because that is what a person recognises", () => {
    assertEquals(publisherNameFromEmail("ada.lovelace@clirevenue.com"), "ada.lovelace");
  });

  await t.step("falls back rather than failing on a missing or odd address", () => {
    assertEquals(publisherNameFromEmail(undefined), "CLIRevenue publisher");
    assertEquals(publisherNameFromEmail(null), "CLIRevenue publisher");
    assertEquals(publisherNameFromEmail(""), "CLIRevenue publisher");
    assertEquals(publisherNameFromEmail("@example.com"), "CLIRevenue publisher");
  });

  await t.step("never invents a nicer name from a dot", () => {
    // The whole address would leak into the dashboard; the local part is the
    // part the developer chose as their identity.
    assertEquals(publisherNameFromEmail("ada@clirevenue.com"), "ada");
  });
});

Deno.test("mayRevealPublishableKey", async (t) => {
  await t.step("allows a well-formed key whose environment matches the slot", () => {
    assert(mayRevealPublishableKey(TEST_KEY, "test"));
    assert(mayRevealPublishableKey(LIVE_KEY, "live"));
  });

  await t.step("refuses a key from the wrong environment", () => {
    // A live key must never be shown in a slot the caller thinks is test,
    // and vice versa: the label is what a developer will copy into config.
    assertEquals(mayRevealPublishableKey(LIVE_KEY, "test"), false);
    assertEquals(mayRevealPublishableKey(TEST_KEY, "live"), false);
  });

  await t.step("refuses anything that is not a publishable key", () => {
    assertEquals(mayRevealPublishableKey("", "test"), false);
    assertEquals(mayRevealPublishableKey("pk_test_short", "test"), false);
    assertEquals(mayRevealPublishableKey("sk_test_" + "a".repeat(43), "test"), false);
    assertEquals(mayRevealPublishableKey(`pk_test_${"a".repeat(43)} extra`, "test"), false);
    assertEquals(mayRevealPublishableKey(null, "test"), false);
    assertEquals(mayRevealPublishableKey(undefined, "test"), false);
    assertEquals(mayRevealPublishableKey(TEST_KEY, null), false);
  });
});

Deno.test("buildProvisioningResponse", async (t) => {
  await t.step("carries the key exactly once, when the caller minted it", () => {
    const out = buildProvisioningResponse(slot(), TEST_KEY);
    assertEquals(out.key.publishableKey, TEST_KEY);
    assertEquals(out.key.created, true);
    assertEquals(out.key.env, "test");
    assertEquals(out.key.prefix, TEST_KEY.slice(0, 12));
    assertEquals(out.publisher.created, true);
    assertEquals(out.publisher.name, "ada@example.com");
  });

  await t.step("reports an existing key without inventing one", async () => {
    const out = buildProvisioningResponse(slot({ publisher_created: false, needs_key: false }));
    // Nothing was minted, so the caller has nothing to show and must not be
    // handed the fragment dressed up as a key.
    assertEquals(out.key.created, false);
    assertEquals("publishableKey" in out.key, false);
    assertEquals(out.key.prefix, TEST_KEY.slice(0, 12));
  });

  await t.step("drops a malformed value rather than passing it on", () => {
    const out = buildProvisioningResponse(slot(), "not-a-key");
    assertEquals("publishableKey" in out.key, false);
    // Still honest about the attempt: created reflects the caller's input,
    // publishableKey reflects what passed the gate.
    assertEquals(out.key.created, true);
  });

  await t.step("drops a key whose environment does not match the slot", () => {
    const out = buildProvisioningResponse(slot(), LIVE_KEY);
    assertEquals("publishableKey" in out.key, false);
  });

  await t.step("treats an empty string as nothing minted", () => {
    const out = buildProvisioningResponse(slot(), "");
    assertEquals(out.key.created, false);
    assertEquals("publishableKey" in out.key, false);
  });

  await t.step("never carries a hash, because the response has no field for one", () => {
    const serialised = JSON.stringify(buildProvisioningResponse(slot(), TEST_KEY));
    assertEquals(/hash/i.test(serialised), false);
    assertEquals(serialised.includes("sha256"), false);
  });

  await t.step("uses the literal property names the SQL function returns", () => {
    // The RPC speaks snake_case; the browser contract is camelCase. If these
    // drift, the dashboard silently renders an empty key plate.
    const out = buildProvisioningResponse(slot(), TEST_KEY);
    assertEquals(out.key.label, "signup");
    assertEquals(out.key.createdAt, "2026-10-02T00:00:00Z");
    assertEquals(out.publisher.id, slot().publisher_id);
  });
});