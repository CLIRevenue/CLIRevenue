import { join } from 'node:path';

import { CLIREVENUE_API_BASE_URL } from '../config.js';
import { detectProject } from '../detect/project.js';
import { ensureIntegrations, pickIntegrationId, EditorError } from '../editor/index.js';
import { addIntegration, addSlot, LEGACY_TARGET } from '../project/config.js';
import { boxToLayout } from '../project/geometry.js';
import { cellsToPixels, pixelContainerFor } from '../tui/cells.js';
import { formatCount, PanelMetrics } from '../tui/panel.js';
import { OverlayError, runOverlay } from '../tui/overlay.js';
import { colors, info, success } from '../utils/colors.js';
import { ENV_FILE, PUBLISHABLE_KEY_VAR, resolvePublisherKey } from '../verify/key-file.js';
import { verifyKey, VerifiedKey } from '../verify/key.js';

/**
 * The `/clirevenue` overlay.
 *
 * This is the path the user is told to take: one command, a panel with their
 * name and their numbers on it, and a slot placed by dragging. It sits
 * alongside `clirevenue editor` rather than replacing it. The editor remains
 * the tool for *moving and removing* an existing slot -- it can address one by
 * id, open several at once, and undo. The overlay only ever adds.
 *
 * The two share everything expensive: the same key lookup, the same
 * verification round trip, and `ensureIntegrations` for creating the first
 * placement. The overlay passes `seedSlot: false` because it positions the
 * slot itself, and a default 320x100 slot left sitting next to the one the
 * user just drew is an ad they never asked for.
 */

/** How the command was invoked. Every dependency is a seam for tests. */
export interface OverlayOptions {
  cwd?: string;
  write?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  /** Which integration to add to; defaults to the first configured. */
  integrationId?: string | null;
  /** Seam for tests, matching `editor()` and `install/sdk.ts`. */
  create?: Parameters<typeof ensureIntegrations>[0]['create'];
  /** Seam for tests: the overlay needs a real TTY, which a test cannot have. */
  run?: typeof runOverlay;
  /**
   * Seam for tests: `verifyKey` is the only network round trip this command
   * makes, and without this a test would reach the live API. Declared as a
   * seam rather than mocked at the module level so the dependency is visible
   * in the type, the same way `create` and `run` are.
   */
  verify?: typeof verifyKey;
}

export interface OverlayCommandResult {
  placementKey: string;
  created: number;
}

/**
 * The panel shows what the backend knows about this publisher.
 *
 * `slotCount` is the server's view, which is the count of placements rather
 * than of slots in `clirevenue.config.json`. The overlay bumps its own counter
 * as it places one, so the number the user watches climbing is the number of
 * things they did in this session, and the number they come back to is the
 * server's.
 */
function toPanelMetrics(verified: VerifiedKey): PanelMetrics {
  return {
    fullName: verified.fullName,
    publisherName: verified.publisherName,
    adsSeen: verified.adsSeen,
    earningsMilliCents: verified.earningsMilliCents,
    slotCount: verified.slotCount,
  };
}

export async function overlay(
  options: OverlayOptions = {},
): Promise<OverlayCommandResult | null> {
  const cwd = options.cwd ?? process.cwd();
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const run = options.run ?? runOverlay;
  const verify = options.verify ?? verifyKey;

  const project = detectProject(cwd);
  /* Same lookup order as `editor()`: the process environment first, then the
     project's `.env.local`, which is where `clirevenue setup` wrote the key.
     Reading only `process.env` was the bug behind "setup succeeded but the
     editor cannot find the key". */
  const publisherKey = resolvePublisherKey(project.root, options.env ?? process.env);

  if (!publisherKey) {
    throw new EditorError(
      'No CLIRevenue publisher key found.',
      `Run \`clirevenue setup\` first, or set ${PUBLISHABLE_KEY_VAR} in ${ENV_FILE} ` +
        `(looked in the environment and in ${join(project.root, ENV_FILE)}).`,
    );
  }

  let verified: VerifiedKey;
  try {
    verified = await verify(publisherKey, CLIREVENUE_API_BASE_URL);
  } catch (err) {
    throw new EditorError(
      err instanceof Error ? err.message : 'Could not verify the publisher key.',
      'Run `clirevenue setup` to re-verify your credentials.',
    );
  }

  const ensured = await ensureIntegrations({
    projectRoot: project.root,
    publisherKey,
    placements: verified.placements,
    seedSlot: false,
    create: options.create,
    write,
    ...(options.integrationId ? { target: options.integrationId } : {}),
  });

  let selectedId = pickIntegrationId(ensured.integrations, options.integrationId);

  if (!selectedId && verified.placements.length > 0) {
    /* A fresh clone of a project that already has placements on the server has
       nothing in clirevenue.config.json for the intersection to find. The key
       was just verified, so the server is the authority on what exists:
       register the first placement instead of telling the user they have none. */
    const placement = verified.placements[0];
    selectedId = placement.key;
    addIntegration(project.root, {
      id: placement.key,
      target: LEGACY_TARGET,
      label: placement.name || placement.key,
      placementKey: placement.key,
    });
  }

  if (!selectedId) {
    throw new EditorError(
      'No placement is available to add a slot to.',
      'Run `clirevenue setup` again, or check your publisher key in the CLIRevenue dashboard.',
    );
  }

  const projectRoot = project.root;
  /* Narrowed into a const so the `save` closure captures a non-nullable
     binding. Closures do not carry the narrowing of a mutable one, so keeping
     `selectedId` would mean a cast inside the callback. */
  const placementKey = selectedId;

  const result = await run({
    metrics: toPanelMetrics(verified),
    save: (box, viewport) => {
      /* The drag happens in terminal cells; `AdLayout` is CSS pixels. Convert
         here, once, at the boundary, so nothing downstream in this process
         ever has to know which coordinate space it is holding. The layout is
         an anchor plus offsets, so the conversion decides how big the ad draws
         and never where it sits -- which is what keeps it scaling with the
         terminal rather than pinning it to the size it was drawn at. */
      const layout = boxToLayout(cellsToPixels(box), pixelContainerFor(viewport.cols, viewport.rows));
      /* No `container`: an empty media query means the slot applies at every
         viewport, which is what someone who drew a box in their terminal
         expects. */
      addSlot(projectRoot, placementKey, { layout });
    },
  });

  write('\n');

  if (result.created === 0) {
    write(`${info('Overlay closed. Nothing was changed.')}\n`);
    return null;
  }

  const plural = result.created === 1 ? 'slot' : 'slots';
  write(`${success(`Added ${formatCount(result.created)} ${plural} to "${placementKey}".`)}\n`);
  write(
    `${colors.dim('  Start your app to see ads. Move or remove slots any time with `clirevenue editor`.')}\n`,
  );

  return { placementKey, created: result.created };
}

export { OverlayError };
