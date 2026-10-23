/**
 * walletRules — the pure parts of the credit wallet.
 *
 * Everything here is a function of its arguments: no database, no network,
 * no clock that is not injected. That is deliberate. The rules that decide
 * whether a top-up is well formed, how a decimal amount becomes a minor
 * unit, and how many credits an admin may give away are the rules a
 * wallet is judged by, and they are the rules that are easiest to get
 * subtly wrong. Keeping them here means they can be tested without a
 * browser, a database, or a payment provider.
 *
 * The amounts are handled as STRINGS on the way in and as integer minor
 * units on the way out. A float is never used to represent money:
 * 0.1 + 0.2 is not 0.3, and a wallet that rounds a float is a wallet that
 * eventually invents a credit nobody paid for.
 */

/** The credit unit. One credit is one INR. */
export const CREDIT_CURRENCY = "INR";

/**
 * The free-credit allowance an admin may give one person in a calendar
 * month. The database enforces the same number inside
 * grant_free_credits(); this constant is what the admin console shows
 * and what the request parser refuses to exceed, so an over-limit grant
 * is refused before it reaches the money.
 */
export const MONTHLY_GRANT_LIMIT = 2000;

/** The ways a person can say they paid. The database CHECKs the same set. */
export const PAYMENT_METHODS = [
  "upi",
  "card",
  "bank_transfer",
  "manual",
  "promo",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The currencies a top-up may be paid in. INR is the credit unit itself. */
export const TOPUP_CURRENCIES = ["INR", "USD", "EUR", "GBP"] as const;
export type TopupCurrency = (typeof TOPUP_CURRENCIES)[number];

/** Decimal places in the minor unit of every currency here is two. */
export const MINOR_UNIT_SCALE = 2;

/**
 * The largest single top-up, in minor units. 10,000,000 minor units is
 * 100,000.00 in the currency. A ceiling exists so a typo cannot open a
 * request for an absurd number that an operator might approve.
 */
export const MAX_TOPUP_MINOR = 10_000_000;

/** The smallest top-up, in minor units. Below this, no credits are minted. */
export const MIN_TOPUP_MINOR = 100;

export type FieldError = { field: string; message: string };

export type TopupInput = {
  amount: string;
  currency: TopupCurrency;
  paymentMethod: PaymentMethod;
  paymentReference: string;
  payerName: string;
  payerEmail: string;
  payerAddress: string;
  payerPhone: string;
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] };

/**
 * Parse a decimal amount into integer minor units, exactly.
 *
 * "500" is 50000 paise. "500.5" is 50050. "500.555" is refused, because
 * a third decimal place is either a typo or a currency that does not
 * exist here, and rounding it silently is how a wallet loses a paisa
 * without anybody noticing.
 *
 * The sign is refused: a negative top-up is not a smaller top-up, it is
 * a different request, and it is not one this endpoint serves.
 */
export function parseAmountToMinor(raw: unknown): ParseResult<number> {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, errors: [{ field: "amount", message: "Enter an amount." }] };
  }
  const text = String(raw).trim();
  if (!text) {
    return { ok: false, errors: [{ field: "amount", message: "Enter an amount." }] };
  }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return {
      ok: false,
      errors: [{ field: "amount", message: "Enter a positive amount, like 500 or 500.50." }],
    };
  }
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > MINOR_UNIT_SCALE) {
    return {
      ok: false,
      errors: [{ field: "amount", message: "Amounts cannot have more than two decimal places." }],
    };
  }
  const minor = Number(whole) * 100 + Number(fraction.padEnd(MINOR_UNIT_SCALE, "0"));
  if (!Number.isSafeInteger(minor)) {
    return { ok: false, errors: [{ field: "amount", message: "That amount is too large." }] };
  }
  if (minor < MIN_TOPUP_MINOR) {
    return {
      ok: false,
      errors: [{ field: "amount", message: "The smallest top-up is 1.00." }],
    };
  }
  if (minor > MAX_TOPUP_MINOR) {
    return {
      ok: false,
      errors: [{ field: "amount", message: "That amount is above the single-top-up limit." }],
    };
  }
  return { ok: true, value: minor };
}

/** A very loose address check: enough to catch a typo, not a delivery address. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a top-up request.
 *
 * The credits are NOT part of this input. They are computed on the
 * server from the amount and the rate, so a client cannot ask for a
 * million credits by sending a million credits.
 */
export function parseTopupRequest(body: Record<string, unknown> | null): ParseResult<TopupInput> {
  const errors: FieldError[] = [];
  const source = body ?? {};

  const amount = parseAmountToMinor(source.amount);
  if (!amount.ok) errors.push(...amount.errors);

  const currency = String(source.currency ?? CREDIT_CURRENCY).trim().toUpperCase();
  if (!(TOPUP_CURRENCIES as readonly string[]).includes(currency)) {
    errors.push({ field: "currency", message: "That currency is not available." });
  }

  const paymentMethod = String(source.paymentMethod ?? "").trim().toLowerCase();
  if (!(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    errors.push({ field: "paymentMethod", message: "Choose how you paid." });
  }

  const payerName = String(source.payerName ?? "").trim();
  if (payerName.length < 2 || payerName.length > 120) {
    errors.push({ field: "payerName", message: "Enter the name on the payment." });
  }

  const payerEmail = String(source.payerEmail ?? "").trim();
  if (!EMAIL_RE.test(payerEmail)) {
    errors.push({ field: "payerEmail", message: "Enter the email address on the payment." });
  }

  const payerAddress = String(source.payerAddress ?? "").trim();
  if (payerAddress.length > 400) {
    errors.push({ field: "payerAddress", message: "That address is too long." });
  }

  const payerPhone = String(source.payerPhone ?? "").trim();
  if (payerPhone.length > 40) {
    errors.push({ field: "payerPhone", message: "That phone number is too long." });
  }

  const paymentReference = String(source.paymentReference ?? "").trim();
  if (paymentReference.length > 120) {
    errors.push({ field: "paymentReference", message: "That reference is too long." });
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      amount: String(source.amount).trim(),
      currency: currency as TopupCurrency,
      paymentMethod: paymentMethod as PaymentMethod,
      paymentReference,
      payerName,
      payerEmail,
      payerAddress,
      payerPhone,
    },
  };
}

/**
 * Validate a free-credit grant from an admin.
 *
 * The ceiling here matches the one in the database. The database is the
 * authority — it counts the grants already made this month — but a
 * request that is obviously over the line is refused before it is sent,
 * so the console can explain itself without a round trip.
 */
export function parseGrantRequest(
  body: Record<string, unknown> | null,
): ParseResult<{ credits: number; reason: string; profileId: string }> {
  const errors: FieldError[] = [];
  const source = body ?? {};

  const rawCredits = source.credits;
  const credits = typeof rawCredits === "number" ? rawCredits : Number.parseInt(String(rawCredits ?? ""), 10);
  if (!Number.isInteger(credits) || credits <= 0) {
    errors.push({ field: "credits", message: "Enter a whole number of credits." });
  } else if (credits > MONTHLY_GRANT_LIMIT) {
    errors.push({
      field: "credits",
      message: `The monthly allowance is ${MONTHLY_GRANT_LIMIT} credits.`,
    });
  }

  const reason = String(source.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) {
    errors.push({ field: "reason", message: "Give a reason between 3 and 500 characters." });
  }

  const profileId = String(source.profileId ?? "").trim();
  if (!profileId) {
    errors.push({ field: "profileId", message: "No account was selected." });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { credits, reason, profileId } };
}

/** The freeze scopes, matching the database CHECK. */
export const FREEZE_SCOPES = ["account", "wallet", "keys"] as const;
export type FreezeScope = (typeof FREEZE_SCOPES)[number];

export function parseFreezeRequest(
  body: Record<string, unknown> | null,
): ParseResult<{ scope: FreezeScope; reason: string; profileId: string }> {
  const errors: FieldError[] = [];
  const source = body ?? {};

  const scope = String(source.scope ?? "").trim().toLowerCase();
  if (!(FREEZE_SCOPES as readonly string[]).includes(scope)) {
    errors.push({ field: "scope", message: "Choose what to freeze." });
  }

  const reason = String(source.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) {
    errors.push({ field: "reason", message: "Give a reason between 3 and 500 characters." });
  }

  const profileId = String(source.profileId ?? "").trim();
  if (!profileId) {
    errors.push({ field: "profileId", message: "No account was selected." });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { scope: scope as FreezeScope, reason, profileId } };
}

/**
 * The credits a top-up of this size is worth, at this rate.
 *
 * Floor, never round: rounding up would mint credits nobody paid for.
 * The rate is credits per one whole unit of the currency, so INR is 1
 * and a currency worth less than a credit per unit would mint nothing
 * for a small payment — which is the correct answer, not an error.
 */
export function creditsForAmount(
  amountMinor: number,
  creditsPerUnit: number,
): { credits: number; tooSmall: boolean } {
  const credits = Math.floor((amountMinor / 100) * creditsPerUnit);
  return { credits, tooSmall: credits < 1 };
}
