/**
 * Campaign eligibility — the rules that decide whether a campaign may be
 * served right now.
 *
 * These live apart from the delivery function for two reasons. They are pure
 * predicates with no I/O, so they can be tested directly instead of inferred
 * from a mocked response; and the selection layer that replaces per-advertiser
 * pointers will need the same rules, so having one definition avoids two
 * implementations drifting apart on the money question.
 */

/** The subset of a campaign row these predicates read. */
export type Candidate = {
  status?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  /** Spend in MILLI-cents. */
  spend_milli_cents?: number | string | null;
  /** Budget in whole cents. */
  budget_cents?: number | string | null;
};

/**
 * How many live campaigns to consider before applying schedule and budget in
 * code. The oldest can be over budget while a later one is servable, so a
 * single-row LIMIT would under-fill. Ordering is stable (created_at ASC, then
 * id ASC), so the walk is deterministic.
 */
export const CANDIDATE_WINDOW = 25;

/** Open-ended schedule fields mean "always in window". */
export function withinSchedule(c: Candidate, now: number): boolean {
  const starts = c.starts_at == null ? null : new Date(c.starts_at).getTime();
  const ends = c.ends_at == null ? null : new Date(c.ends_at).getTime();
  return (starts === null || starts <= now) && (ends === null || ends >= now);
}

/**
 * Budget check.
 *
 * budget_cents is whole cents and spend_milli_cents is milli-cents, so the
 * budget is scaled to milli-cents (x1000) and both sides are compared in the
 * same unit. This is deliberate, not a unit bug: comparing
 * spend_milli_cents < budget_cents would stop a campaign 1000x too early, and
 * dividing either side into cents would round a sub-cent remainder away and
 * hide a real spend of one cent.
 */
export function withinBudget(c: Candidate): boolean {
  return Number(c.spend_milli_cents) < Number(c.budget_cents) * 1000;
}

/** Status and schedule and budget, in that order, all required. */
export function isEligible(c: Candidate, now: number): boolean {
  if (c.status !== "active") return false;
  return withinSchedule(c, now) && withinBudget(c);
}

/**
 * First eligible candidate in the given order, or null.
 *
 * Callers are responsible for having already filtered and ordered the
 * candidate set deterministically.
 */
export function pickEligible<T extends Candidate>(
  candidates: readonly T[],
  now: number,
): T | null {
  for (const c of candidates) {
    if (isEligible(c, now)) return c;
  }
  return null;
}
