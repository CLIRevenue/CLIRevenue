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
export const DEFAULT_CPM_CENTS = 10;
export const MAX_CPM_CENTS = 10_000;

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
  if (raw > MAX_CPM_CENTS) {
    return { ok: false, code: "INVALID_CPM", message: "CPM exceeds the maximum allowed." };
  }
  return { ok: true, value: raw };
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
  CREATIVE_MISSING:
    "Upload and validate a creative before activating this campaign.",
};

export function activationBlockerMessage(code: string): string {
  return ACTIVATION_BLOCKER_MESSAGES[code] || "Campaign is not ready to activate.";
}
