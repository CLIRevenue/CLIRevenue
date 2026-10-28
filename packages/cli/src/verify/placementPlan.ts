import type { IntegrationConfig } from '../project/config.js';

/**
 * Deciding which backend placement each local integration should point at.
 *
 * This is the decision setup used to skip. It wrote a placement key into
 * `clirevenue.config.json` — `codex-1`, `codex-2` — that nothing had ever
 * created on the server. The SDK then asked for a placement that did not
 * exist, got a 204, and rendered nothing, while setup printed "setup
 * complete". A configuration that names a thing which does not exist is not a
 * configuration; it is a promise nobody kept.
 *
 * So the placement is now resolved *before* it is written, and the resolution
 * has three answers:
 *
 *   - `reuse-local`  the project already has an integration for this CLI, so
 *                    its placement key is the answer. The key is reused
 *                    verbatim, which is what makes a second run of setup a
 *                    no-op rather than a second ad.
 *   - `reuse-server` the publisher already has a placement this project is
 *                    not using. Reusing it means the ad they already set up in
 *                    the dashboard starts rendering without them having to go
 *                    there first — which is the whole point of a CLI.
 *   - `create`       neither exists, so a deterministic key is minted and the
 *                    backend is asked to create it.
 *
 * Every function here is pure. The plan is computed from the local config and
 * the placement list the backend returned, and it can be tested without a
 * network, a filesystem or a database.
 */

export type PlacementAction = 'reuse-local' | 'reuse-server' | 'create';

export interface ServerPlacement {
  key: string;
  name: string | null;
  enabled: boolean;
}

export interface PlacementPlan {
  targetId: string;
  targetName: string;
  /** The id of the local integration that will own the placement. */
  integrationId: string;
  /** The placement key the local configuration will reference. */
  placementKey: string;
  /** The name shown in the dashboard for a placement this run creates. */
  placementName: string;
  action: PlacementAction;
}

export interface PlanPlacementsInput {
  /** The chosen targets, in the order the user chose them. */
  chosen: Array<{ id: string; name: string }>;
  /** Integrations already present in the project. */
  existing: IntegrationConfig[];
  /** Every placement the publisher owns. */
  serverPlacements: ServerPlacement[];
  /** Placement keys already claimed by an integration in this project. */
  claimedKeys: string[];
}

/**
 * Plan one placement per chosen target.
 *
 * The order of the answers matters, and it is the order of how much the plan
 * is willing to change:
 *
 *   1. The project already has an integration for this target. Its key wins,
 *      always. Nothing else is considered, because a local integration is a
 *      decision the user already made and re-deciding it would duplicate the
 *      ad. The same answer is given to an integration that already occupies
 *      the *id* this target would use, even if its recorded target differs —
 *      the configuration is keyed by id, so that entry is the one the file
 *      will keep.
 *   2. The publisher has a placement this project is not using. It is
 *      adopted, so an advertiser who set an ad up in the dashboard sees it
 *      here without a second step.
 *   3. A new placement is minted.
 *
 * Placements that are disabled are only adopted when there is nothing else,
 * and they are reported as disabled by the caller — an ad behind a disabled
 * placement is a configuration problem the user can see and fix, not a
 * failure to hide.
 */
export function planPlacements(input: PlanPlacementsInput): PlacementPlan[] {
  const plans: PlacementPlan[] = [];
  const claimed = new Set<string>(input.claimedKeys);

  for (const target of input.chosen) {
    /* The local configuration is keyed by *integration id*, and `addIntegration`
       leaves an existing entry alone rather than overwriting it. So an
       integration that already occupies the id this target would use is the
       one the file will keep — whether or not its `target` field matches.

       Looking it up by id as well as by target keeps the plan and the file in
       agreement. Without it, the plan could ensure one placement on the
       account while the file kept pointing at another, and the verification
       that ends setup would then fail on the placement the run had just
       created — after having created a second, orphaned placement. */
    const existing =
      input.existing.find((entry) => entry.target === target.id) ??
      input.existing.find((entry) => entry.id === target.id) ??
      null;

    if (existing) {
      claimed.add(existing.placementKey);
      plans.push({
        targetId: target.id,
        targetName: target.name,
        integrationId: existing.id,
        placementKey: existing.placementKey,
        placementName: existing.label || target.name,
        action: 'reuse-local',
      });
      continue;
    }

    const reusable = pickReusablePlacement(input.serverPlacements, claimed);
    if (reusable) {
      claimed.add(reusable.key);
      plans.push({
        targetId: target.id,
        targetName: target.name,
        integrationId: target.id,
        placementKey: reusable.key,
        placementName: reusable.name || target.name,
        action: 'reuse-server',
      });
      continue;
    }

    const placementKey = nextPlacementKey(target.id, [
      ...claimed,
      ...input.serverPlacements.map((placement) => placement.key),
    ]);
    claimed.add(placementKey);
    plans.push({
      targetId: target.id,
      targetName: target.name,
      integrationId: target.id,
      placementKey,
      placementName: target.name,
      action: 'create',
    });
  }

  return plans;
}

/**
 * The best existing placement to adopt: enabled first, then disabled, and
 * stable in the order the backend returned them so two runs of setup make the
 * same choice.
 */
function pickReusablePlacement(
  placements: ServerPlacement[],
  claimed: Set<string>,
): ServerPlacement | null {
  const free = placements.filter((placement) => !claimed.has(placement.key));
  if (free.length === 0) return null;
  const enabled = free.find((placement) => placement.enabled);
  return enabled ?? free[0];
}

/**
 * The next free placement key for a target.
 *
 * The key is derived from the target id rather than from a clock or the
 * project name, so a retry after a failure lands on the same key and the
 * backend's uniqueness constraint turns the retry into a no-op rather than a
 * second placement. The suffix is the smallest number that is free both
 * locally and on the server.
 *
 * The shape is constrained by the backend's own rule for placement keys —
 * lowercase letters, digits, hyphens and underscores — so a key minted here
 * is never rejected by the API that has to accept it.
 */
export function nextPlacementKey(targetId: string, taken: string[]): string {
  const used = new Set(taken);
  const prefix = targetId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${prefix}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  /* Unreachable in practice: a thousand integrations of one target in one
     project is not a state this tool can reach. Returning the prefixed key
     keeps the function total, and the backend will refuse a duplicate with a
     message that names the conflict. */
  return prefix;
}
