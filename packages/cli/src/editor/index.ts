import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  addIntegration,
  addSlot,
  listIntegrations,
  loadLayout,
  saveSlot,
  LEGACY_TARGET,
} from '../project/config.js';
import { detectProject } from '../detect/project.js';
import { verifyKey, type VerifiedKey } from '../verify/key.js';
import {
  ENV_FILE,
  PUBLISHABLE_KEY_VAR,
  resolvePublisherKey,
} from '../verify/key-file.js';
import {
  createPlacement as createPlacementRequest,
  PlacementCreateError,
  type CreatedPlacement,
} from '../verify/placement.js';
import { CLIREVENUE_API_BASE_URL } from '../config.js';
import { EditorError, startEditor, type EditorSession } from './server.js';
import { renderEditorPage, type EditorIntegration, type EditorSlot } from './page.js';

export { EditorError };

/**
 * `clirevenue editor` — launch the placement editor.
 *
 * The editor is a real, saveable surface rather than a preview: the browser
 * page runs in a temporary loopback server owned by this process, and a save
 * is a `POST` back to it that lands in the project's `clirevenue.config.json`
 * — the same file the generated integration reads at runtime. Nothing about
 * it is mocked, and no credential is ever handed to the page.
 *
 * The reason it is a browser rather than a TUI is a technical one, not a
 * preference: free-positioning a rectangle by dragging with live pixel
 * feedback is not expressible in a terminal prompt, and terminal graphics
 * protocols do not carry pointer events. A loopback page is the only approach
 * that gives real dragging, real handles, and real assistive-tech semantics
 * without shipping a native module.
 */

/**
 * What the editor is allowed to render.
 *
 * Placement keys and labels come from the publisher's own API response. The
 * publisher key never appears here: it stays in the environment, and the
 * browser only ever receives geometry plus identifiers it already knows.
 */
export type { EditorIntegration, EditorSlot };

/**
 * Project integrations plus verified publisher ownership into the shape the
 * page renders.
 *
 * Ownership is intersected on purpose: an integration whose placement key is
 * not in the verified response is dropped rather than offered. The config file
 * is editable by hand, so it is not proof of ownership — the API is. Without
 * this the editor could point a project at a creative belonging to somebody
 * else, which is the one failure mode the ownership rule exists to prevent.
 */
function toEditorIntegrations(
  projectRoot: string,
  placements: VerifiedKey['placements'],
): EditorIntegration[] {
  const owned = new Set(placements.map((p) => p.key));
  return listIntegrations(projectRoot)
    .filter((integration) => owned.has(integration.placementKey))
    .map((integration) => ({
      id: integration.id,
      label: integration.label,
      target: integration.target,
      placementKey: integration.placementKey,
      slots: Object.values(integration.slots).map((slot) => ({
        integrationId: integration.id,
        slotId: slot.id,
        label: slot.label,
        placementKey: integration.placementKey,
        layout: slot.layout,
        enabled: slot.enabled,
        ...(slot.container ? { container: slot.container } : {}),
      })),
    }));
}

/**
 * Default simulated viewport for the preview surface.
 *
 * The editor needs a host box to resolve the ad against, and a real browser
 * window is not reliably measurable before the page loads. These are the
 * dimensions of a common laptop viewport; the page then re-resolves against
 * its actual host on every resize, so the stored layout is correct for
 * whatever the user's window really is.
 */
const DEFAULT_HOST_WIDTH = 1280;
const DEFAULT_HOST_HEIGHT = 800;

export interface OpenEditorOptions {
  projectRoot: string;
  integrations: EditorIntegration[];
  /** Which integration to open first. Defaults to the first configured. */
  selectedId?: string | null;
  /** Pre-resolved placement, used to decide whether to print instructions. */
  hostWidth?: number;
  hostHeight?: number;
  /** Injected in tests; defaults to the platform's browser launcher. */
  openBrowser?: (url: string) => void;
}

/**
 * Turn a placement-creation failure into something the user can act on.
 *
 * Each backend code gets its own recovery, because the four of them mean
 * genuinely different things: a bad key, a request aimed at the wrong
 * publisher, a throttle, and a backend that is not answering. Collapsing them
 * into "something went wrong" would be the same as the old behaviour of
 * sending every new publisher to a dashboard for a manual step.
 */
function createFailureHint(err: PlacementCreateError): string {
  switch (err.code) {
    case 'invalid_key':
      return 'Your publisher key was rejected. Run `clirevenue setup` to re-verify your credentials.';
    case 'forbidden':
      return 'That request did not belong to the publisher this key owns. Check which account the key belongs to in the CLIRevenue dashboard.';
    case 'rate_limited':
      return err.retryAfterMs
        ? `Wait ${Math.ceil(err.retryAfterMs / 1000)}s, then run \`clirevenue editor\` again.`
        : 'Wait a moment, then run `clirevenue editor` again.';
    case 'invalid_request':
      return 'The CLIRevenue API rejected the placement details. Run `clirevenue setup` to refresh your configuration, then try again.';
    default:
      return 'The CLIRevenue API could not be reached. Check your network connection, then try again.';
  }
}

export interface EnsurePlacementOptions {
  projectRoot: string;
  publisherKey: string;
  placements: VerifiedKey['placements'];
  /**
   * Seam for tests, matching the convention already used by
   * `install/sdk.ts` and `commands/setup.ts`. Defaults to the real request;
   * nothing in the shipped CLI can be told to skip creating a placement.
   */
  create?: typeof createPlacementRequest;
  write?: (line: string) => void;
  /** An explicitly requested placement is also the key that gets created. */
  placementKey?: string;
  /** Capability-registry id recorded when an integration is created here. */
  target?: string;
  /**
   * Skip the "every slotless integration gets one default-sized slot" step.
   *
   * The browser editor needs it: it opens showing geometry and the user drags
   * from there. The `/clirevenue` overlay does not -- the user draws the slot
   * themselves, so seeding a default 320x100 one first would leave them with
   * two ads, one they placed and one they never asked for. Defaults to on, so
   * the editor's behaviour is unchanged.
   */
  seedSlot?: boolean;
}

/**
 * Make sure there is at least one placement to position.
 *
 * A publisher reaching the editor for the first time has none, and stopping
 * there meant the very first thing setup sent them to do was leave the
 * terminal and open a dashboard. `POST /cli/placements` exists so the CLI can
 * create that first placement itself — the backend still decides which
 * publisher owns it, from the key hash, and the geometry the user is about to
 * drag is still saved only in the project.
 *
 * When the publisher already has placements nothing is created: the editor
 * must never invent a second placement behind the user's back.
 */
export async function ensureIntegrations(
  options: EnsurePlacementOptions,
): Promise<{ integrations: EditorIntegration[]; created: CreatedPlacement | null }> {
  const seed = options.seedSlot !== false;

  if (options.placements.length > 0) {
    const integrations = toEditorIntegrations(options.projectRoot, options.placements);
    for (const integration of integrations) {
      if (integration.slots.length > 0) continue;
      if (!seed) break;
      /* An integration exists but has nowhere to put its ad. Give it exactly
         one slot rather than failing: a project configured for two CLIs but
         positioned for none is a normal halfway state, not an error. */
      addSlot(options.projectRoot, integration.id, {
        label: 'Ad 1',
        layout: loadLayout(options.projectRoot, integration.id),
      });
    }
    return {
      integrations: toEditorIntegrations(options.projectRoot, options.placements),
      created: null,
    };
  }

  const create = options.create ?? createPlacementRequest;
  const write = options.write ?? ((line: string) => process.stdout.write(line));

  let created: CreatedPlacement;
  try {
    created = await create(options.publisherKey, {
      ...(options.placementKey ? { placementKey: options.placementKey } : {}),
    });
  } catch (err) {
    throw new EditorError(
      err instanceof Error ? err.message : 'Could not create a placement.',
      err instanceof PlacementCreateError ? createFailureHint(err) : undefined,
    );
  }

  write(
    created.created
      ? `Created placement "${created.key}". Positioning it now.\n`
      : `Placement "${created.key}" already exists. Positioning it now.\n`,
  );

  /* Record the freshly created placement as an integration so it is
     positioned and re-opened by name, rather than existing only in the
     backend and vanishing from the project on the next read. */
  addIntegration(options.projectRoot, {
    id: created.key,
    target: options.target ?? LEGACY_TARGET,
    label: created.name ?? created.key,
    placementKey: created.key,
  });
  if (seed) addSlot(options.projectRoot, created.key, { label: 'Ad 1' });

  return {
    integrations: [
      {
        id: created.key,
        label: created.name ?? created.key,
        target: options.target ?? LEGACY_TARGET,
        placementKey: created.key,
        /* Withhold the synthetic slot when none was seeded: reporting one that
           is not in clirevenue.config.json would make the caller count an ad
           the runtime will never render. */
        slots: seed
          ? [
              {
                integrationId: created.key,
                slotId: 'slot-1',
                label: 'Ad 1',
                placementKey: created.key,
                layout: loadLayout(options.projectRoot, created.key),
                enabled: true,
              },
            ]
          : [],
      },
    ],
    created,
  };
}

/**
 * Start the editor server and hand it a URL.
 *
 * Returns the live session. Callers either await `session.result` (the
 * interactive command) or close it immediately (status checks).
 */
export async function openEditor(options: OpenEditorOptions): Promise<EditorSession> {
  const session = await startEditor({
    projectRoot: options.projectRoot,
    integrations: options.integrations,
    selectedId: options.selectedId,
    hostWidth: options.hostWidth ?? DEFAULT_HOST_WIDTH,
    hostHeight: options.hostHeight ?? DEFAULT_HOST_HEIGHT,
  });

  if (options.openBrowser) {
    options.openBrowser(session.url);
  } else {
    launchBrowser(session.url);
  }

  return session;
}

/**
 * Open a URL in the user's default browser.
 *
 * Every platform has a different launcher and none is guaranteed to exist;
 * when one does not, the caller still gets a URL to paste, which is why
 * `launchBrowser` returns a boolean instead of throwing.
 */
export function launchBrowser(url: string): boolean {
  const platform = process.platform;
  const command =
    platform === 'darwin'
      ? { bin: 'open', args: [url] }
      : platform === 'win32'
        ? { bin: 'cmd', args: ['/c', 'start', '""', url.replace(/&/g, '^&')] }
        : { bin: 'xdg-open', args: [url] };

  try {
    const child = spawn(command.bin, command.args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* No browser launcher — the URL is printed either way. */
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve which placement the editor should open.
 *
 * Preferring an explicitly saved placement over the first available one
 * matters for the common case of a project with several placements: the user
 * reopens the editor to adjust the one they were just working on.
 */
export function pickIntegrationId(
  integrations: EditorIntegration[],
  requested?: string | null,
): string | null {
  if (requested && integrations.some((entry) => entry.id === requested)) return requested;
  return integrations[0]?.id ?? null;
}

/** The layout the editor should open with: saved geometry, else SDK defaults. */
export function layoutFor(projectRoot: string, integrationId: string, slotId?: string) {
  return loadLayout(projectRoot, integrationId, slotId);
}

/**
 * The full `clirevenue editor` command.
 *
 * The publisher key is read from the environment, not prompted for: the
 * editor is launched from a keybinding in a terminal the user already set
 * up, and re-prompting for a credential on every launch would make the
 * shortcut unusable and would train the user to paste keys casually.
 */
export async function editor(options: {
  cwd?: string;
  write?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  openBrowser?: (url: string) => void;
  /** Open this placement instead of the auto-detected one. */
  placementKey?: string;
  /** Which integration to open; defaults to the first configured. */
  integrationId?: string | null;
  /**
   * Seam for tests, matching the convention already used by
   * `install/sdk.ts` and `commands/setup.ts`. Defaults to the real request.
   */
  create?: typeof createPlacementRequest;
} = {}): Promise<{ placementKey: string; layout: ReturnType<typeof layoutFor> } | null> {
  const cwd = options.cwd ?? process.cwd();
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const project = detectProject(cwd);
  /* The key is looked for in the process environment first and in the
     project's `.env.local` second, because that is where a previous
     `clirevenue setup` put it. Reading only `process.env` here was the bug
     behind "setup succeeded but the editor cannot find the key": the file was
     written, nobody read it back, and the command a keybinding invokes was
     the one place that never looked. `resolvePublisherKey` keeps the
     environment ahead of the file, so an explicitly supplied variable is
     never overwritten by a value on disk. */
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
    verified = await verifyKey(publisherKey, CLIREVENUE_API_BASE_URL);
  } catch (err) {
    throw new EditorError(
      err instanceof Error ? err.message : 'Could not verify the publisher key.',
      'Run `clirevenue setup` to re-verify your credentials.',
    );
  }

  const { integrations } = await ensureIntegrations({
    projectRoot: project.root,
    publisherKey,
    placements: verified.placements,
    create: options.create,
    write,
    ...(options.placementKey ? { placementKey: options.placementKey } : {}),
    ...(options.integrationId ? { target: options.integrationId } : {}),
  });

  const selectedId = pickIntegrationId(integrations, options.integrationId);
  if (!selectedId) {
    /* Unreachable while ensureIntegrations always returns at least one entry;
       kept so a future change that breaks that invariant fails loudly rather
       than opening an editor with nothing selected. */
    throw new EditorError(
      'No integration is available to position.',
      'Run `clirevenue editor` again, or check your publisher key in the CLIRevenue dashboard.',
    );
  }

  const session = await openEditor({
    projectRoot: project.root,
    integrations,
    selectedId,
    openBrowser: options.openBrowser,
  });

  const slotCount = integrations.reduce((total, entry) => total + entry.slots.length, 0);
  write(`Placement editor running at ${session.url}\n`);
  write(
    slotCount === 1
      ? 'Drag or resize the ad, then press Save. Press Cancel to discard.\n'
      : `Choose one of the ${slotCount} slots, drag or resize it, then press Save.\n`,
  );

  const result = await session.result;
  session.close();

  if (result === 'saved') {
    const savedLayout = loadLayout(project.root, selectedId);
    write(`\n✓ Saved slots for "${selectedId}" to clirevenue.config.json\n`);
    return { placementKey: selectedId, layout: savedLayout };
  }

  write('\nPlacement editor cancelled. Nothing was changed.\n');
  return null;
}

export { renderEditorPage, saveSlot };
export type { EditorSession };
