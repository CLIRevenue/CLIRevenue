import { validateAdText } from "./adText.ts";

export const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active", "archived"],
  active: ["paused", "completed", "archived"],
  paused: ["active", "archived"],
  completed: ["archived"],
  archived: [],
};

export const MAX_BUDGET_CENTS = 10_000_000;

/* CPM is milli-cents, and the database is what proves it: apply_impression()
   assigns cpm_cents straight into spend_milli_cents, so the two are the same
   unit by construction. These two names said "cents" and the cap below was
   written as if it meant dollars-times-100 -- 10_000 milli-cents is a ten
   dollar CPM, not a hundred dollar one. A campaign quoted at anything above
   $10 was rejected as INVALID_CPM, while the form's own default of $0.01
   sailed through, so the form looked healthy until anyone typed a real
   number. The cap is now stated in the unit the value is actually in. */
export const DEFAULT_CPM_MILLI_CENTS = 10;
export const MAX_CPM_MILLI_CENTS = 10_000_000;

const CREATE_ALLOWED = new Set([
  "name",
  "headline",
  "description",
  "cta",
  "audience_id",
  "audience",
  "budget_cents",
  "budgetCents",
  "cpm_cents",
  "cpmCents",
  "landing_url",
  "landingUrl",
  "starts_at",
  "ends_at",
]);

const PATCH_ALLOWED = new Set([
  ...CREATE_ALLOWED,
  "status",
]);

const FORBIDDEN_PATCH = new Set([
  "advertiser_id",
  "spend_milli_cents",
  "spend_cents",
  "spendCents",
  "impressions_count",
  "impressions",
  "clicks_count",
  "clicks",
  "conversions_count",
  "conversions",
  "created_at",
  "createdAt",
  "id",
]);

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === "string" &&
    (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function unknownFields(body: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(body).filter((k) => !allowed.has(k));
}

export function createUnknownFields(body: Record<string, unknown>): string[] {
  return unknownFields(body, CREATE_ALLOWED);
}

export function patchUnknownFields(body: Record<string, unknown>): string[] {
  const keys = Object.keys(body);
  const unknown = keys.filter((k) => !PATCH_ALLOWED.has(k));
  const forbidden = keys.filter((k) => FORBIDDEN_PATCH.has(k));
  return [...new Set([...unknown, ...forbidden])];
}

export function parseBudgetCents(raw: unknown): { ok: true; value: number } | { ok: false; code: string; message: string } {
  const value = raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return {
      ok: false,
      code: "INVALID_BUDGET",
      message: "Budget must be a non-negative integer (cents).",
    };
  }
  if (value > MAX_BUDGET_CENTS) {
    return {
      ok: false,
      code: "INVALID_BUDGET",
      message: "Budget exceeds the maximum allowed for this environment.",
    };
  }
  return { ok: true, value };
}

export function parseBudgetCredits(raw: unknown): { ok: true; value: number } | { ok: false; code: string; message: string } {
  const value = raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return {
      ok: false,
      code: "INVALID_BUDGET",
      message: "Budget must be a non-negative integer (credits).",
    };
  }
  // Convert credits to cents (1 credit = 100 cents)
  const cents = value * 100;
  if (cents > MAX_BUDGET_CENTS) {
    return {
      ok: false,
      code: "INVALID_BUDGET",
      message: "Budget exceeds the maximum allowed for this environment.",
    };
  }
  return { ok: true, value: cents };
}

export function requireNonEmptyString(value: unknown, field: string): string | null {
  if (typeof value !== "string" || value.trim() === "") return `${field} is required.`;
  return null;
}

/* Landing URL is the advertised destination only. It is stored verbatim and
   echoed to the SDK; it is never signed and never carries attribution, so a
   loose scheme allowlist plus a shape check is the whole requirement. */
const LANDING_URL_RE = /^https?:\/\/[^\s]+$/;

export function parseLandingUrl(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; code: string; message: string } {
  if (raw === undefined) return { ok: true, value: null };
  if (raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, code: "INVALID_LANDING_URL", message: "Landing URL must be a string." };
  }
  const trimmed = raw.trim();
  if (trimmed.length > 2048) {
    return {
      ok: false,
      code: "INVALID_LANDING_URL",
      message: "Landing URL is too long.",
    };
  }
  if (!LANDING_URL_RE.test(trimmed)) {
    return {
      ok: false,
      code: "INVALID_LANDING_URL",
      message: "Landing URL must start with http:// or https://.",
    };
  }
  return { ok: true, value: trimmed };
}

export function parseCpmCents(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; code: string; message: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    return {
      ok: false,
      code: "INVALID_CPM",
      message: "CPM must be a positive integer (milli-cents per impression).",
    };
  }
  if (raw > MAX_CPM_MILLI_CENTS) {
    return { ok: false, code: "INVALID_CPM", message: "CPM exceeds the maximum allowed." };
  }
  return { ok: true, value: raw };
}

/**
 * The ad text a campaign will have once a patch has been applied.
 *
 * A patch that carries a headline replaces the stored one; a patch that does
 * not leaves the stored one in place. The stored one still has to be valid,
 * because the database re-checks the whole row on every UPDATE and the
 * constraint was added NOT VALID: a campaign written before the 60-character
 * rule existed can still hold a longer headline, and editing *any* field of
 * it would otherwise fail with a raw constraint violation.
 *
 * So the rule is: validate the headline the campaign will end up with, and
 * refuse the patch with the same code the dashboard's counter uses when it is
 * the stored headline that is wrong. The only way forward for a legacy
 * campaign is to send a shorter headline in the same request, which is
 * exactly what the constraint would demand anyway.
 */
export function effectiveAdText(
  incoming: unknown,
  stored: unknown,
): { ok: true; value: string; length: number } | {
  ok: false;
  code: string;
  message: string;
  length: number;
} {
  return validateAdText(incoming !== undefined ? incoming : stored);
}

/* campaign_activation_blockers() is the single authority on whether a campaign
   is allowed to go live. It runs in the database so the same rules apply no
   matter which caller asks, and so a rule can never drift between the Edge
   Function and the accounting RPCs. The codes below are the contract; keep
   them in sync with 000022_campaign_creatives.sql. */
export const ACTIVATION_BLOCKER_MESSAGES: Record<string, string> = {
  CAMPAIGN_NOT_FOUND: "Campaign not found.",
  ADVERTISER_NOT_ELIGIBLE: "This advertiser account is not allowed to run campaigns.",
  INVALID_AUDIENCE: "Select an audience before activating.",
  INVALID_BUDGET: "Budget must be greater than 0 to activate.",
  INVALID_CPM: "CPM must be greater than 0 to activate.",
  INVALID_SCHEDULE: "Start date must be before the end date.",
  SCHEDULE_NOT_STARTED: "This campaign is scheduled to start in the future.",
  SCHEDULE_ENDED: "This campaign's end date has passed.",
  INVALID_LANDING_URL: "Add a valid http(s) landing URL before activating.",
  BUDGET_EXCEEDED: "This campaign has already spent its full budget.",
  /* The ad text contract. These two codes are produced by the database
     blockers (the ad-text migration added them), so the API has to name them
     too: an activation refused for an over-long headline has to say so,
     not "Campaign is not ready to activate." The dashboard's copy of this
     map says the same thing in the same words. */
  AD_TEXT_REQUIRED: "Write the ad text before activating.",
  AD_TEXT_TOO_LONG: "Shorten the ad text to 60 characters or fewer before activating.",
};

export function activationBlockerMessage(code: string): string {
  return ACTIVATION_BLOCKER_MESSAGES[code] || "Campaign is not ready to activate.";
}
