/**
 * The publisher's own numbers, for the panel `clirevenue` draws in a terminal.
 *
 * Everything the overlay shows about "you" lives here: the display name and
 * the two counters. It is a separate module because it is the first thing the
 * delivery path has to read that is *not* about authenticating a key, and
 * because the interesting question is not "how do I sum impressions" but
 * "what do I do when this database has never heard of this function".
 *
 * That second question is the reason this file exists in the shape it does.
 *
 * `publisher_summary` is created by migration 000025. Every environment that
 * has not run 000025 yet will answer a call to it with a PostgREST error - the
 * routine-not-found code, PGRST202 - and the name of the error says nothing
 * useful to the person running `clirevenue setup`. The obvious implementation,
 * `rpc()` and trust it, turns an unfinished migration into a setup that cannot
 * get past the welcome banner. So the fallback below is not defensive
 * programming in the abstract; it is the normal path for every developer whose
 * database has not been migrated yet, and it has to be the graceful one.
 *
 * The degraded answer is: the publisher's own `name` column, and zeroed
 * counters. Zero rather than null, because "0 ads seen" is a true statement
 * about a publisher who has just signed up, and `null` would force every
 * renderer to invent its own placeholder for a number that is genuinely zero.
 */
import type { adminClient } from "../_shared/auth.ts";

/** PostgREST "function not found in schema cache". A 000025-less database. */
const ROUTINE_NOT_FOUND = "PGRST202";

export type PublisherSummary = {
  /** What the overlay puts under the CLIRevenue title. */
  fullName: string | null;
  /** The publisher record's own name, kept separately: 000016 auto-creates
   *  publishers called "Untitled publisher", so this is the fallback when the
   *  developer has not filled in `profiles.full_name`. */
  publisherName: string | null;
  adsSeen: number;
  earningsMilliCents: number;
  slotCount: number;
};

type AdminClient = ReturnType<typeof adminClient>;

/** A number that is a number. The RPC returns jsonb; jsonb numbers arrive as
 *  JS numbers, but a hand-edited row or a future cast could make them
 *  something else, and `NaN` in a terminal panel is worse than a zero. */
function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Parse the RPC's jsonb without trusting its shape.
 *
 * An absent or malformed row yields the degraded summary rather than null, so
 * the caller's single `??` at the end covers both "no such publisher" and
 * "the function answered something unexpected".
 */
export function parsePublisherSummary(data: unknown): PublisherSummary {
  const degraded: PublisherSummary = {
    fullName: null,
    publisherName: null,
    adsSeen: 0,
    earningsMilliCents: 0,
    slotCount: 0,
  };
  if (!data || typeof data !== "object") return degraded;
  const row = data as Record<string, unknown>;
  return {
    fullName: asText(row.fullName),
    publisherName: asText(row.publisherName),
    adsSeen: asCount(row.adsSeen),
    earningsMilliCents: asCount(row.earningsMilliCents),
    slotCount: asCount(row.slotCount),
  };
}

/**
 * Read the summary, falling back to the publisher row alone.
 *
 * Ordering matters. The publisher's own row is read *first* and unconditionally,
 * because `publishers.name` is what the degraded answer needs and that table
 * predates everything here. The RPC is only consulted when there is a reason to
 * believe it exists.
 */
export async function fetchPublisherSummary(
  admin: AdminClient,
  publisherId: string,
): Promise<PublisherSummary> {
  const { data: publisherRow, error: publisherError } = await admin
    .from("publishers")
    .select("name")
    .eq("id", publisherId)
    .limit(1)
    .maybeSingle();

  const publisherName = asText(
    (publisherRow as { name?: unknown } | null | undefined)?.name,
  );

  if (publisherError) {
    console.error("publishers name query failed:", publisherError.message);
    return {
      fullName: null,
      publisherName: null,
      adsSeen: 0,
      earningsMilliCents: 0,
      slotCount: 0,
    };
  }

  const { data, error } = await admin.rpc("publisher_summary", {
    p_publisher_id: publisherId,
  });

  if (error) {
    // Expected on every database that has not run 000025. Logged at info
    // level by being a plain console.log rather than console.error, because it
    // is a migration state and not a fault.
    if (error.code === ROUTINE_NOT_FOUND) {
      console.log("publisher_summary unavailable (migration 000025 not applied)");
      return {
        fullName: null,
        publisherName,
        adsSeen: 0,
        earningsMilliCents: 0,
        slotCount: 0,
      };
    }
    console.error("publisher_summary query failed:", error.message);
    return {
      fullName: null,
      publisherName,
      adsSeen: 0,
      earningsMilliCents: 0,
      slotCount: 0,
    };
  }

  const summary = parsePublisherSummary(data);
  return { ...summary, publisherName: summary.publisherName ?? publisherName };
}