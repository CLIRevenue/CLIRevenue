/**
 * The ad text contract, at the boundary where a patch meets the database.
 *
 * Two rules live here that cannot be checked by a unit test of the string
 * itself:
 *
 *   1. `effectiveAdText` — the headline a campaign will have *after* a patch.
 *      A patch that does not carry a headline leaves the stored one in place,
 *      and the stored one still has to be valid, because the database
 *      re-checks the whole row on every UPDATE and the constraint was added
 *      NOT VALID to protect the campaigns that predate the rule. Getting this
 *      wrong is not a cosmetic problem: a campaign with a legacy 80-character
 *      headline would have every unrelated edit — a budget change, a schedule
 *      change — refused with a raw constraint violation instead of a message
 *      that says what to do.
 *
 *   2. The blocker messages. `campaign_activation_blockers()` in the database
 *      now returns AD_TEXT_REQUIRED and AD_TEXT_TOO_LONG, and the API names
 *      the blocker it was given. A code the API has no message for degrades
 *      into "Campaign is not ready to activate.", which tells the advertiser
 *      nothing about the one thing they have to change.
 *
 * Run with: npm run test:deno
 */
import { assertEquals } from "jsr:@std/assert@1";
import {
  ACTIVATION_BLOCKER_MESSAGES,
  activationBlockerMessage,
  effectiveAdText,
} from "./campaignRules.ts";
import { MAX_AD_TEXT_LENGTH } from "./adText.ts";

Deno.test("a patch that carries a headline validates the headline it carries", () => {
  const result = effectiveAdText("A headline", "A stored headline");
  assertEquals(result.ok, true);
  assertEquals(result.ok && result.value, "A headline");
});

Deno.test("a patch that carries no headline validates the stored one", () => {
  const result = effectiveAdText(undefined, "A stored headline");
  assertEquals(result.ok, true);
  assertEquals(result.ok && result.value, "A stored headline");
});

Deno.test("a patch that carries no headline refuses a legacy headline that is too long", () => {
  const result = effectiveAdText(undefined, "x".repeat(MAX_AD_TEXT_LENGTH + 1));
  assertEquals(result.ok, false);
  assertEquals(result.ok === false && result.code, "AD_TEXT_TOO_LONG");
});

Deno.test("a patch that carries no headline refuses a legacy empty headline", () => {
  const result = effectiveAdText(undefined, "   ");
  assertEquals(result.ok, false);
  assertEquals(result.ok === false && result.code, "AD_TEXT_REQUIRED");
});

Deno.test("a patch that carries a shorter headline rescues a legacy campaign", () => {
  /* The only way forward for a campaign written before the rule existed: send
     a headline that fits, in the same request. */
  const result = effectiveAdText("Short enough", "x".repeat(80));
  assertEquals(result.ok, true);
  assertEquals(result.ok && result.value, "Short enough");
});

Deno.test("an explicit null headline is refused rather than ignored", () => {
  const result = effectiveAdText(null, "A stored headline");
  assertEquals(result.ok, false);
  assertEquals(result.ok === false && result.code, "AD_TEXT_REQUIRED");
});

Deno.test("the stored headline is normalised the same way as an incoming one", () => {
  const incoming = effectiveAdText("  caf\u00e9  ", undefined);
  const stored = effectiveAdText(undefined, "  caf\u00e9  ");
  assertEquals(incoming.ok && incoming.value, "caf\u00e9");
  assertEquals(stored.ok && stored.value, "caf\u00e9");
});

Deno.test("the API has a message for every ad-text blocker code", () => {
  /* These two codes come out of the database's activation blockers. If the
     API has no message for one, the advertiser is told the campaign is "not
     ready" instead of what to change. */
  assertEquals(
    Object.prototype.hasOwnProperty.call(ACTIVATION_BLOCKER_MESSAGES, "AD_TEXT_REQUIRED"),
    true,
  );
  assertEquals(
    Object.prototype.hasOwnProperty.call(ACTIVATION_BLOCKER_MESSAGES, "AD_TEXT_TOO_LONG"),
    true,
  );
  assertEquals(
    activationBlockerMessage("AD_TEXT_TOO_LONG"),
    "Shorten the ad text to 60 characters or fewer before activating.",
  );
  assertEquals(
    activationBlockerMessage("AD_TEXT_REQUIRED"),
    "Write the ad text before activating.",
  );
});
