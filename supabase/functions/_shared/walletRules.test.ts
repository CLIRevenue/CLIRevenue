import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  creditsForAmount,
  MONTHLY_GRANT_LIMIT,
  MAX_TOPUP_MINOR,
  MIN_TOPUP_MINOR,
  parseAmountToMinor,
  parseFreezeRequest,
  parseGrantRequest,
  parseTopupRequest,
  PAYMENT_METHODS,
} from "./walletRules.ts";

Deno.test("wallet rules", async (t) => {
  await t.step("parseAmountToMinor accepts whole numbers", () => {
    const r = parseAmountToMinor("500");
    assertEquals(r.ok, true);
    assertEquals(r.ok ? r.value : undefined, 50000);
  });

  await t.step("parseAmountToMinor accepts two decimal places", () => {
    const r = parseAmountToMinor("500.55");
    assertEquals(r.ok, true);
    assertEquals(r.ok ? r.value : undefined, 50055);
  });

  await t.step("parseAmountToMinor pads one decimal place", () => {
    const r = parseAmountToMinor("500.5");
    assertEquals(r.ok, true);
    assertEquals(r.ok ? r.value : undefined, 50050);
  });

  await t.step("parseAmountToMinor trims whitespace", () => {
    const r = parseAmountToMinor("  500  ");
    assertEquals(r.ok, true);
    assertEquals(r.ok ? r.value : undefined, 50000);
  });

  await t.step("parseAmountToMinor refuses three decimal places", () => {
    const r = parseAmountToMinor("500.555");
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors[0].field, "amount");
  });

  await t.step("parseAmountToMinor refuses negative amounts", () => {
    const r = parseAmountToMinor("-500");
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors[0].field, "amount");
  });

  await t.step("parseAmountToMinor refuses empty", () => {
    const r = parseAmountToMinor("");
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors[0].field, "amount");
  });

  await t.step("parseAmountToMinor refuses non-numeric", () => {
    const r = parseAmountToMinor("abc");
    assertEquals(r.ok, false);
  });

  await t.step("parseAmountToMinor refuses null", () => {
    const r = parseAmountToMinor(null);
    assertEquals(r.ok, false);
  });

  await t.step("parseAmountToMinor enforces the minimum", () => {
    const r = parseAmountToMinor("0.50");
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors[0].field, "amount");
  });

  await t.step("parseAmountToMinor accepts exactly the minimum", () => {
    const r = parseAmountToMinor("1.00");
    assertEquals(r.ok, true);
    assertEquals(r.ok ? r.value : undefined, MIN_TOPUP_MINOR);
  });

  await t.step("parseAmountToMinor enforces the maximum", () => {
    const r = parseAmountToMinor(String(MAX_TOPUP_MINOR / 100 + 0.01));
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors[0].field, "amount");
  });

  await t.step("parseAmountToMinor accepts exactly the maximum", () => {
    const r = parseAmountToMinor((MAX_TOPUP_MINOR / 100).toFixed(2));
    assertEquals(r.ok, true);
    assertEquals(r.ok ? r.value : undefined, MAX_TOPUP_MINOR);
  });

  await t.step("creditsForAmount floors, never rounds", () => {
    assertEquals(creditsForAmount(150, 1), { credits: 1, tooSmall: false });
    assertEquals(creditsForAmount(99, 1), { credits: 0, tooSmall: true });
    assertEquals(creditsForAmount(100, 1), { credits: 1, tooSmall: false });
    assertEquals(creditsForAmount(150, 2), { credits: 3, tooSmall: false });
    assertEquals(creditsForAmount(99, 2), { credits: 1, tooSmall: false });
  });

  await t.step("parseTopupRequest accepts a valid top-up", () => {
    const body = {
      amount: "500.00",
      currency: "INR",
      paymentMethod: "upi",
      paymentReference: "ref-123",
      payerName: "Ada Lovelace",
      payerEmail: "ada@example.com",
      payerAddress: "123 Street",
      payerPhone: "9876543210",
    };
    const r = parseTopupRequest(body);
    assertEquals(r.ok, true);
    if (r.ok) {
      assertEquals(r.value.amount, "500.00");
      assertEquals(r.value.currency, "INR");
      assertEquals(r.value.paymentMethod, "upi");
      assertEquals(r.value.payerName, "Ada Lovelace");
      assertEquals(r.value.payerEmail, "ada@example.com");
    }
  });

  await t.step("parseTopupRequest defaults currency to INR", () => {
    const body = {
      amount: "100",
      paymentMethod: "card",
      payerName: "Ada",
      payerEmail: "ada@example.com",
    };
    const r = parseTopupRequest(body);
    assertEquals(r.ok, true);
    if (r.ok) assertEquals(r.value.currency, "INR");
  });

  await t.step("parseTopupRequest rejects missing amount", () => {
    const r = parseTopupRequest({ currency: "INR", paymentMethod: "upi", payerName: "Ada", payerEmail: "ada@example.com" });
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "amount"), true);
  });

  await t.step("parseTopupRequest rejects unknown currency", () => {
    const body = { amount: "100", currency: "XYZ", paymentMethod: "upi", payerName: "Ada", payerEmail: "ada@example.com" };
    const r = parseTopupRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "currency"), true);
  });

  await t.step("parseTopupRequest rejects unknown payment method", () => {
    const body = { amount: "100", currency: "INR", paymentMethod: "cash", payerName: "Ada", payerEmail: "ada@example.com" };
    const r = parseTopupRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "paymentMethod"), true);
  });

  await t.step("parseTopupRequest rejects short payer name", () => {
    const body = { amount: "100", currency: "INR", paymentMethod: "upi", payerName: "A", payerEmail: "ada@example.com" };
    const r = parseTopupRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "payerName"), true);
  });

  await t.step("parseTopupRequest rejects bad email", () => {
    const body = { amount: "100", currency: "INR", paymentMethod: "upi", payerName: "Ada", payerEmail: "not-an-email" };
    const r = parseTopupRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "payerEmail"), true);
  });

  await t.step("parseTopupRequest rejects null body", () => {
    const r = parseTopupRequest(null);
    assertEquals(r.ok, false);
  });

  await t.step("payment methods match the database set", () => {
    assertEquals(PAYMENT_METHODS, ["upi", "card", "bank_transfer", "manual", "promo"]);
  });

  await t.step("parseGrantRequest accepts a valid grant", () => {
    const body = { credits: 500, reason: "Goodwill gesture.", profileId: "00000000-0000-0000-0000-000000000001" };
    const r = parseGrantRequest(body);
    assertEquals(r.ok, true);
    if (r.ok) {
      assertEquals(r.value.credits, 500);
      assertEquals(r.value.reason, "Goodwill gesture.");
      assertEquals(r.value.profileId, "00000000-0000-0000-0000-000000000001");
    }
  });

  await t.step("parseGrantRequest refuses credits over the monthly cap", () => {
    const body = { credits: MONTHLY_GRANT_LIMIT + 1, reason: "Reason here.", profileId: "00000000-0000-0000-0000-000000000001" };
    const r = parseGrantRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "credits"), true);
  });

  await t.step("parseGrantRequest refuses zero credits", () => {
    const body = { credits: 0, reason: "Reason here.", profileId: "00000000-0000-0000-0000-000000000001" };
    const r = parseGrantRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "credits"), true);
  });

  await t.step("parseGrantRequest refuses short reason", () => {
    const body = { credits: 100, reason: "No", profileId: "00000000-0000-0000-0000-000000000001" };
    const r = parseGrantRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "reason"), true);
  });

  await t.step("parseGrantRequest rejects missing profile", () => {
    const body = { credits: 100, reason: "Reason here." };
    const r = parseGrantRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "profileId"), true);
  });

  await t.step("parseGrantRequest rejects null body", () => {
    const r = parseGrantRequest(null);
    assertEquals(r.ok, false);
  });

  await t.step("parseFreezeRequest accepts a valid freeze", () => {
    const body = { scope: "wallet", reason: "Suspicious activity.", profileId: "00000000-0000-0000-0000-000000000001" };
    const r = parseFreezeRequest(body);
    assertEquals(r.ok, true);
    if (r.ok) {
      assertEquals(r.value.scope, "wallet");
      assertEquals(r.value.reason, "Suspicious activity.");
    }
  });

  await t.step("parseFreezeRequest accepts all scopes", () => {
    for (const scope of ["account", "wallet", "keys"]) {
      const body = { scope, reason: "Reason here is long enough.", profileId: "00000000-0000-0000-0000-000000000001" };
      const r = parseFreezeRequest(body);
      assertEquals(r.ok, true, `scope ${scope} should be accepted`);
    }
  });

  await t.step("parseFreezeRequest rejects unknown scope", () => {
    const body = { scope: "everything", reason: "Reason here is long enough.", profileId: "00000000-0000-0000-0000-000000000001" };
    const r = parseFreezeRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "scope"), true);
  });

  await t.step("parseFreezeRequest rejects short reason", () => {
    const body = { scope: "wallet", reason: "No", profileId: "00000000-0000-0000-0000-000000000001" };
    const r = parseFreezeRequest(body);
    assertEquals(r.ok, false);
    assertEquals(r.ok ? undefined : r.errors.some((e) => e.field === "reason"), true);
  });

  await t.step("parseFreezeRequest rejects null body", () => {
    const r = parseFreezeRequest(null);
    assertEquals(r.ok, false);
  });
});
