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

const CREATE_ALLOWED = new Set([
  "name",
  "headline",
  "description",
  "cta",
  "audience_id",
  "audience",
  "budget_cents",
  "budgetCents",
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
