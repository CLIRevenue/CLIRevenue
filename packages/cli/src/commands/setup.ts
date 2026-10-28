import { join } from 'node:path';
import inquirer from 'inquirer';
import {
  detectProject,
  describeProject,
  isSupported,
  type ProjectInfo,
} from '../detect/project.js';
import { installSdk } from '../install/sdk.js';
import { verifyKey, KeyVerificationError, type VerifiedKey } from '../verify/key.js';
import {
  createPlacement as createPlacementOnServer,
  PlacementCreateError,
  type CreatedPlacement,
} from '../verify/placement.js';
import {
  planPlacements,
  type PlacementPlan,
  type ServerPlacement,
} from '../verify/placementPlan.js';
import {
  readKeyFromEnvFile,
  PUBLISHABLE_KEY_PATTERN as KEY_PATTERN,
} from '../verify/key-file.js';
import { describeKeyProblem } from '../verify/keyFormat.js';
import { generateIntegration, type GenerateResult } from '../generate/integration.js';
import { colors, banner, success, warn, info } from '../utils/colors.js';
import { CLIREVENUE_API_BASE_URL, CLIREVENUE_SDK_VERSION } from '../config.js';
import { status as keybindingStatus, hasWorkingShortcut, install as installBinding } from '../keybindings/manage.js';
import { KEYBINDING_TARGETS, detectTargets, findTarget } from '../keybindings/targets.js';
import {
  addIntegration,
  addSlot,
  listIntegrations,
  loadLayout,
  type IntegrationConfig,
} from '../project/config.js';

/**
 * Setup: detect, configure, integrate, then hand off to the editor.
 *
 * What deliberately does *not* happen here matters as much as what does.
 * Setup never asks which placement to use, and never asks for an ad size.
 * Both are visual decisions, and asking for them as text prompts — before
 * the user has seen their own page — is precisely how a project ends up with
 * a hardcoded "Console Workbench" at 320×100 that nobody chose. The editor
 * owns both questions, because it is the only surface that can ask them
 * properly.
 */

export class SetupError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'SetupError';
  }
}


export interface SetupOptions {
  cwd?: string;
  write?: (message: string) => void;
  /**
   * Seam for tests, matching the `InstallOptions` convention already used by
   * `install/sdk.ts`. Defaults to the real implementation: nothing in the
   * shipped CLI can be told to skip installing the SDK or to trust an
   * unverified key.
   */
  install?: typeof installSdk;
  verify?: (rawKey: string) => Promise<VerifiedKey>;
  /**
   * Seam for tests, following the same convention as `install` and `verify`.
   * Defaults to the real implementation, which asks the user which coding CLIs
   * they use and provisions one placement key per integration.
   */
  chooseIntegrations?: typeof chooseIntegrations;
  /**
   * Seam for tests, following the same convention as `install` and `verify`.
   * Defaults to the real implementation, which asks the backend to create the
   * placement. Nothing in the shipped CLI can be told to skip it: a local
   * configuration that names a placement the server does not have is a
   * configuration that renders nothing.
   */
  createPlacement?: typeof createPlacementOnServer;
}

export interface SetupOutcome {
  project: ProjectInfo;
  key: string;
  verified: VerifiedKey;
  result: GenerateResult;
  /** One entry per CLI integration this project positions ads for. */
  integrations: IntegrationConfig[];
  /** True only when a working Ctrl+I binding is actually registered here. */
  shortcutReady: boolean;
  /**
   * What happened to each placement this run touched.
   *
   * `created` means the backend did not have it. `reused` means it did, and
   * the local configuration now points at it. `verified` is a separate fact:
   * the placement was read back from the backend after it was written, and it
   * is there.
   */
  placements: PlacementOutcome[];
}

/** The fate of one placement during setup. */
export interface PlacementOutcome {
  integrationId: string;
  placementKey: string;
  action: 'created' | 'reused';
  /** False when the backend has the placement but it is switched off. */
  enabled: boolean;
}

export async function setup(options: SetupOptions = {}): Promise<SetupOutcome> {
  const write = options.write ?? ((message: string) => process.stdout.write(message));
  const install = options.install ?? installSdk;
  const verify = options.verify ?? ((rawKey: string) => verifyWith(rawKey));

  /*
   * The user's working directory, never the CLI's own package directory.
   * `npx` runs from its cache directory, so trusting `import.meta.url` here
   * would detect and then modify the CLI's own install — the worst possible
   * outcome for a `setup` command.
   */
  const cwd = options.cwd ?? process.cwd();

  write(`${banner('CLIRevenue setup')}\n`);
  write(`${info('Detecting project...')}\n`);

  const project = detectProject(cwd);

  /* An unfamiliar project is not a reason to stop.

     This used to throw "Unsupported project" for anything that was not
     Vite or a static HTML page, which is precisely the wrong response to
     somebody who is installing a CLI for the first time: it told them
     their project was not supported without saying what was supported,
     where to run it, or what to do next. Every one of those is a question
     the person asking it came here with.

     So an unknown project keeps going. The SDK installs, the key is
     verified, placements are provisioned, and the integration is
     generated. What changes is only what we tell them at the end: that we
     could not recognise their stack, that setup did not change their
     dependencies beyond the SDK, and that the one thing left is pointing
     a surface at the placement we just made.

     Nothing here needs a browser. A browser is where an ad renders, and
     that is their application's business, not the installer's. */
  const recognised = isSupported(project.type);
  write(`${success(describeProject(project))}\n`);
  if (!recognised) {
    write(
      `${warn(
        `I could not recognise this project${project.reason ? `: ${project.reason}` : ''}. Carrying on anyway — nothing below depends on knowing what your stack is.`,
      )}\n`,
    );
  }
  if (!project.supportsRendering) {
    write(
      `${warn(
        'No page was found here, so setup will not have anywhere to mount the ad for you. That is fine and is the last step, not a blocker.',
      )}\n`,
    );
  }

  write(`${info('CLIRevenue SDK')}\n`);
  try {
    const installed = await install(project.root);
    write(
      installed.alreadyInstalled
        ? `${success(`@clirevenue/sdk ${CLIREVENUE_SDK_VERSION} or newer is already installed`)}\n`
        : `${success(
            `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION} installed with ${installed.packageManager}`,
          )}\n`,
    );
  } catch (err) {
    throw new SetupError(
      err instanceof Error ? err.message : 'The SDK could not be installed.',
      `Install ${`@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`} manually with your package manager, then run setup again.`,
    );
  }

  write(`${info('Verifying key...')}\n`);
  const existingKey = getExistingKey(project.root);
  const rawKey = existingKey ?? (await promptForKey());
  const verified = await verify(rawKey);

  /* Never echo the credential, only enough of it to confirm which key was used. */
  write(`${success(`Key verified (${maskKey(rawKey)})`)}\n`);

  /*
   * The name is the point of verification. A 200 on its own proves the string
   * is a live capability; the name proves it resolves to a person, which is
   * what a developer pasting a key into a setup prompt actually needs to see.
   * It is printed here, before any file is written, so that a key pasted into
   * the wrong project is caught while there is still nothing to undo.
   *
   * The `||` chain rather than `??`: the two fields are strings that can be
   * empty, and a banner reading "Welcome! " is worse than one reading
   * "Welcome! CLIRevenue publisher".
   */
  const welcomeName = verified.fullName || verified.publisherName || 'CLIRevenue publisher';
  write(`\n${banner(`Welcome! ${welcomeName}`)}\n`);
  write(`${info(`Publisher: ${verified.publisherId}`)}\n`);
  if (!verified.fullName) {
    write(
      `${colors.dim('  Set a display name in your dashboard and it will appear here next time.')}\n`,
    );
  }

  /*
   * Step: which coding CLIs does this project serve?
   *
   * One integration owns exactly one placement key, so asking "how many CLIs"
   * is what determines how many ads exist on the account. Slots come later and
   * are free: three ads on one page share one key.
   */
  const { integrations, placements } = await provisionIntegrations({
    projectRoot: project.root,
    verified,
    rawKey,
    write,
    choose: options.chooseIntegrations ?? chooseIntegrations,
    createPlacement: options.createPlacement ?? createPlacementOnServer,
  });

  /*
   * The last thing setup does is check its own work.
   *
   * Everything above is a claim: the placement was created, the configuration
   * points at it. A claim is only worth what a check is worth, so the
   * placements are read back from the backend and compared against what the
   * local configuration now references. A mismatch is reported as a failure,
   * not a warning, because "setup complete" over a configuration that cannot
   * serve an ad is the one outcome this command must never produce.
   */
  const verification = await verifyPlacements({
    rawKey,
    integrations,
    placements,
    verify,
    write,
  });

  write(`${info('Configuring project...')}\n`);
  const result = generateIntegration({
    projectRoot: project.root,
    publisherKey: rawKey,
    baseUrl: CLIREVENUE_API_BASE_URL,
    projectType: project.type,
    sdkVersion: CLIREVENUE_SDK_VERSION,
  });

  write(`${success('Environment configured')}\n`);
  for (const path of result.updated) write(`${colors.green(`  Updated ${path}`)}\n`);
  for (const path of result.preserved) {
    write(
      `${colors.yellow(`  Kept ${path} — it was not generated by CLIRevenue, so it was left untouched.`)}\n`,
    );
  }
  if (result.configAdded) write(`${colors.green(`  Created ${result.configFile}`)}\n`);

  const shortcutReady = reportNextSteps(project, write);

  return {
    project,
    key: rawKey,
    verified,
    result,
    integrations,
    shortcutReady,
    placements: verification.outcomes,
  };
}

/**
 * Read the placements back and check them against the local configuration.
 *
 * The check is deliberately narrow and mechanical: every placement key the
 * project references must exist on the publisher's account. A placement that
 * exists but is switched off is reported as a warning, because that is a
 * state the user can fix in the dashboard and it is not a broken setup — but
 * it is worth saying out loud, because an ad behind a disabled placement
 * never appears and looks exactly like a bug.
 */
async function verifyPlacements(options: {
  rawKey: string;
  integrations: IntegrationConfig[];
  placements: PlacementOutcome[];
  verify: (rawKey: string) => Promise<VerifiedKey>;
  write: (message: string) => void;
}): Promise<{ outcomes: PlacementOutcome[] }> {
  const { rawKey, integrations, placements, verify, write } = options;

  if (integrations.length === 0) return { outcomes: [] };

  let live: VerifiedKey;
  try {
    live = await verify(rawKey);
  } catch (err) {
    throw new SetupError(
      err instanceof Error ? err.message : 'The placements could not be read back.',
      'Setup could not confirm that the placements exist. Nothing was changed — try again when you are online.',
    );
  }

  const byKey = new Map(live.placements.map((placement) => [placement.key, placement]));
  const outcomes: PlacementOutcome[] = [];
  const missing: string[] = [];
  const disabled: string[] = [];

  for (const integration of integrations) {
    const placement = byKey.get(integration.placementKey);
    if (!placement) {
      missing.push(integration.placementKey);
      continue;
    }
    const enabled = placement.enabled !== false;
    if (!enabled) disabled.push(integration.placementKey);
    /* The action is what provisioning decided — created or reused — and the
       check does not get to relabel it. Only the live state of the
       placement is new information here. */
    const known = placements.find((entry) => entry.placementKey === integration.placementKey);
    outcomes.push({
      integrationId: integration.id,
      placementKey: integration.placementKey,
      action: known?.action ?? 'reused',
      enabled,
    });
  }

  if (missing.length > 0) {
    throw new SetupError(
      `The backend does not have the placement${missing.length > 1 ? 's' : ''} ${missing
        .map((key) => `"${key}"`)
        .join(', ')}.`,
      /* The project file *has* been written by this point — the
         integration and its slot are in it — so "nothing was changed" would
         be a lie. What is true is that the project now points at a
         placement the account does not have, and the fix is the same
         either way: put the placement on the account, then run setup
         again. */
      'Your project now points at a placement your account does not have. Create it in your dashboard, then run setup again.',
    );
  }

  for (const key of disabled) {
    write(
      `${warn(
        `Placement "${key}" is switched off on your account, so it will not serve an ad. Turn it on in your dashboard to see it.`,
      )}\n`,
    );
  }

  if (outcomes.length > 0) {
    write(
      `${success(
        `Verified ${outcomes.length} placement${outcomes.length > 1 ? 's' : ''} on your account`,
      )}\n`,
    );
  }

  return { outcomes };
}

export interface ChooseIntegrationsOptions {
  projectRoot: string;
  detected: string[];
  existing: IntegrationConfig[];
  ask?: (questions: unknown[]) => Promise<Record<string, unknown>>;
}

/**
 * Ask which coding CLIs this project serves.
 *
 * The count is asked before the list on purpose. "How many CLIs?" is the
 * question that determines how many ads the publisher ends up with, and
 * asking it first means the selection list is sized for the answer instead of
 * inviting a single choice by default.
 */
export async function chooseIntegrations(options: ChooseIntegrationsOptions): Promise<string[]> {
  const ask = options.ask ?? ((questions: unknown[]) => inquirer.prompt(questions as never[]));
  const usable = KEYBINDING_TARGETS.filter(
    (target) => target.id !== 'local' && target.configPath !== '',
  );
  const already = new Set(options.existing.map((entry) => entry.target));
  const candidates = usable.filter(
    (target) => !already.has(target.id) || options.existing.some((e) => e.target === target.id),
  );

  const { count } = (await ask([
    {
      type: 'number',
      name: 'count',
      message: 'How many coding CLIs will use CLIRevenue in this project?',
      default: Math.max(1, options.detected.length),
      validate: (value: number) =>
        Number.isInteger(value) && value > 0 && value <= usable.length
          ? true
          : `Choose between 1 and ${usable.length}.`,
    },
  ])) as { count: number };

  const total = Math.min(count, candidates.length);
  const { chosen } = (await ask([
    {
      type: 'checkbox',
      name: 'chosen',
      message: `Select the ${total} CLI integration${total === 1 ? '' : 's'} to set up:`,
      choices: candidates.map((target) => ({
        name: target.name,
        value: target.id,
        checked: options.detected.includes(target.id) || already.has(target.id),
      })),
      validate: (value: string[]) =>
        value.length === total ? true : `Select exactly ${total}.`,
    },
  ])) as { chosen: string[] };

  return chosen;
}

export interface ProvisionIntegrationsOptions {
  projectRoot: string;
  verified: VerifiedKey;
  rawKey: string;
  write: (message: string) => void;
  choose: typeof chooseIntegrations;
  createPlacement: typeof createPlacementOnServer;
}

/**
 * Turn the user's choice into one working integration per CLI.
 *
 * "Working" is the operative word. An integration is not a line in a config
 * file; it is a local record *and* a backend placement the SDK can actually
 * ask for. So this function does four things, in this order:
 *
 *   1. Asks which coding CLIs the project serves.
 *   2. Plans the placement for each: reuse the project's own integration for
 *      that CLI, else adopt a placement the publisher already has, else mint
 *      a new key.
 *   3. Makes sure the backend has every planned placement, creating the ones
 *      it is missing.
 *   4. Writes the local configuration, reusing the existing integration and
 *      its slot when they are already there.
 *
 * The order matters because steps 3 and 4 are the difference between a setup
 * that works and a setup that claims to work. A placement that was never
 * created server-side produces a 204 on every delivery, and a 204 is
 * indistinguishable from "no ad sold" to the person looking at their page.
 */
export async function provisionIntegrations(
  options: ProvisionIntegrationsOptions,
): Promise<{ integrations: IntegrationConfig[]; placements: PlacementOutcome[] }> {
  const { projectRoot, verified, rawKey, write, choose, createPlacement } = options;
  const existing = listIntegrations(projectRoot);
  const detected = detectTargets(projectRoot).map((target) => target.id);

  write(`${info('Coding CLI integrations')}\n`);
  const chosen = await choose({ projectRoot, detected, existing });
  if (chosen.length === 0) {
    write(`${info('Skipped. You can add integrations later with: clirevenue integrations add')}\n`);
    return { integrations: existing, placements: [] };
  }

  const serverPlacements: ServerPlacement[] = verified.placements.map((placement) => ({
    key: placement.key,
    name: placement.name ?? null,
    enabled: placement.enabled !== false,
  }));

  const plans = planPlacements({
    chosen: chosen.map((id) => {
      const target = findTarget(id);
      return { id, name: target?.name ?? id };
    }),
    existing,
    serverPlacements,
    claimedKeys: existing.map((entry) => entry.placementKey),
  });

  const placements = await ensurePlacements({
    plans,
    rawKey,
    serverPlacements,
    createPlacement,
  });

  const configured: IntegrationConfig[] = [];
  for (const plan of plans) {
    const sameTarget = existing.filter((entry) => entry.target === plan.targetId);
    const id = plan.integrationId;
    const placementKey = plan.placementKey;

    const result = addIntegration(projectRoot, {
      id,
      target: plan.targetId,
      label: sameTarget.length === 0 ? plan.targetName : `${plan.targetName} ${sameTarget.length + 1}`,
      placementKey,
    });

    /* A slot is always created alongside its integration: an integration with
       no slot renders nothing, which would look like the setup failed. But a
       slot is only created once — re-running setup must not stack a second
       "Ad 2" on top of the first one, because that is a second ad the user
       never asked for. */
    const current = result.config.integrations[id];
    const hasSlot = current && Object.keys(current.slots).length > 0;
    if (!hasSlot) {
      addSlot(projectRoot, id, {
        label: 'Ad 1',
        layout: loadLayout(projectRoot, id),
      });
    }
    configured.push(listIntegrations(projectRoot).find((entry) => entry.id === id)!);

    const outcome = placements.find((entry) => entry.placementKey === placementKey);
    write(
      outcome?.action === 'created'
        ? `${success(`${plan.targetName} added as "${id}" with placement "${placementKey}" (created on your account)`)}\n`
        : `${success(`${plan.targetName} ${result.created ? 'added' : 'was already configured'} as "${id}" with placement "${placementKey}"`)}\n`,
    );
  }

  configureBindings(projectRoot, configured, write);
  return { integrations: configured, placements };
}

/**
 * Make sure the backend has every planned placement.
 *
 * A placement the backend already has is adopted without a write — the read
 * that produced the list was the proof. A placement it is missing is created,
 * and the create is idempotent server-side, so a request that times out and is
 * retried lands on the same placement rather than a second one.
 */
async function ensurePlacements(options: {
  plans: PlacementPlan[];
  rawKey: string;
  serverPlacements: ServerPlacement[];
  createPlacement: typeof createPlacementOnServer;
}): Promise<PlacementOutcome[]> {
  const { plans, rawKey, serverPlacements, createPlacement } = options;
  const known = new Map(serverPlacements.map((placement) => [placement.key, placement]));
  const outcomes: PlacementOutcome[] = [];

  for (const plan of plans) {
    const existing = known.get(plan.placementKey);
    if (existing) {
      outcomes.push({
        integrationId: plan.integrationId,
        placementKey: plan.placementKey,
        action: 'reused',
        enabled: existing.enabled !== false,
      });
      continue;
    }

    let created: CreatedPlacement;
    try {
      created = await createPlacement(rawKey, {
        placementKey: plan.placementKey,
        name: plan.placementName,
      });
    } catch (err) {
      /* A placement that could not be created is a failure, and it is
         reported as one. Writing the key into the config anyway would produce
         exactly the silent no-ad this whole path exists to prevent. */
      throw new SetupError(
        err instanceof PlacementCreateError
          ? err.message
          : 'The placement could not be created on your account.',
        'Your project was not changed. Check your publisher key and your connection, then run setup again.',
      );
    }

    outcomes.push({
      integrationId: plan.integrationId,
      placementKey: created.key,
      action: created.created ? 'created' : 'reused',
      enabled: created.enabled !== false,
    });
    known.set(created.key, { key: created.key, name: created.name, enabled: created.enabled });
  }

  return outcomes;
}

/**
 * Offer to register the activation method each target actually supports.
 *
 * Nothing here decides whether a shortcut *will* work — that is still
 * `reportNextSteps`' job, gated on `hasWorkingShortcut`. This step only
 * installs what the user confirms, and it asks before writing to a file
 * inside their project. For a target with no mechanism at all, `install`
 * writes nothing and returns a reason, which is printed verbatim.
 */
function configureBindings(
  projectRoot: string,
  integrations: IntegrationConfig[],
  write: (message: string) => void,
): void {
  const wanted = integrations.map((entry) => entry.target);
  if (wanted.length === 0) return;

  write(`\n${info('Activation methods')}\n`);
  for (const integration of integrations) {
    const target = findTarget(integration.target);
    if (!target) continue;
    const result = installBinding(projectRoot, target.id);
    if (result.outcome === 'installed' || result.outcome === 'updated' || result.outcome === 'unchanged') {
      write(`${success(`${target.name}: ${target.alternativeCommand}`)}\n`);
      continue;
    }
    if (result.reason) write(`${warn(`${target.name}: ${result.reason}`)}\n`);
    if (result.hint) write(`${colors.dim(`  ${result.hint}`)}\n`);
  }
}

/**
 * Print the closing instructions.
 *
 * The Ctrl+I lines are printed **only** when `clirevenue keybindings install`
 * has actually left a working binding in this project — decided from real
 * project state via `keybindingStatus`, never assumed. Telling users to press
 * a key that does nothing is the easiest way to ship a CLI that lies, so the
 * fallback below prints the real command instead and lists what to install to
 * get the shortcut.
 */
function reportNextSteps(project: ProjectInfo, write: (message: string) => void): boolean {
  const statuses = keybindingStatus(project.root);
  const working = statuses.find(
    (entry) => entry.installed && entry.shortcut && !entry.conflicting,
  );
  const ready = hasWorkingShortcut(statuses);

  write(`\n${banner('CLIRevenue setup complete.')}\n`);

  if (ready && working) {
    write(`\n${colors.bold('Next steps:')}\n`);
    write(`1. Open your preferred coding CLI in this project.\n`);
    write(`2. Press Ctrl+I to launch the CLIRevenue placement editor.\n`);
    write(`3. Drag the ad preview to your preferred location and resize it.\n`);
    write(`4. Confirm your placement to save the configuration.\n`);
    write(`\nYour editor will open when you press Ctrl+I.\n`);
    return true;
  }

  write(`\n${colors.bold('Next steps:')}\n`);
  write(`1. Position your ad in the visual editor:\n`);
  write(`   ${colors.cyan('npx clirevenue editor')}\n`);
  write(`   It opens a drag-and-resize preview in your browser and saves the\n`);
  write(`   placement to clirevenue.config.json in your project.\n`);
  /*
   * Some editors CAN be wired up, just not with a keypress: OpenCode gets a
   * `/clirevenue-editor` slash command. If the user has actually installed one
   * of those, naming it is more useful than making them reinstall it, and it
   * keeps the promise narrow -- these are commands, not shortcuts, so the
   * Ctrl+I language is never borrowed for them.
   */
  const installedCommands = statuses.filter((entry) => entry.installed && !entry.shortcut);
  if (installedCommands.length > 0) {
    write(`\n2. Already registered in this project, as commands rather than shortcuts:\n`);
    for (const entry of installedCommands) {
      write(`   ${colors.cyan(entry.target.alternativeCommand)} ${colors.dim(`(${entry.target.name})`)}\n`);
    }
  }

  write(`\n${installedCommands.length > 0 ? '3' : '2'}. To launch it with a keypress instead, register a binding for your editor:\n`);
  for (const target of KEYBINDING_TARGETS) {
    write(`   ${colors.cyan(`npx clirevenue keybindings install ${target.id}`)}\n`);
    write(
      `     ${colors.dim(
        target.shortcut
          ? `${target.name} → Ctrl+I`
          : `${target.name} → ${target.alternativeCommand} (Ctrl+I is unavailable: ${target.shortcutUnavailableReason})`,
      )}\n`,
    );
  }
  write(
    `\n${warn(
      'Ctrl+I is not registered in this project yet, so it will not launch the editor on its own.',
    )}\n`,
  );
  return false;
}

/**
 * Reuse the key a previous setup wrote, so a re-run is not a re-prompt.
 *
 * Only the publishable key is ever read here. It is a credential by design —
 * it belongs in the browser — but it is still the user's, and silently
 * re-verifying someone else's key would be worse than asking.
 */
function getExistingKey(root: string): string | null {
  /* One reader, shared with `editor`. These two used to parse `.env.local`
     independently, and when they drifted the editor stopped finding the key
     that setup had just written. */
  return readKeyFromEnvFile(root);
}

async function promptForKey(): Promise<string> {
  const { publisherKey } = await inquirer.prompt([
    {
      type: 'input',
      name: 'publisherKey',
      message: 'CLIRevenue publishable key (clirevenue_ads_…)',
      /* Collapsed, not trimmed. A key that wrapped across two lines when it
         was copied out of a rendered element keeps the newline inside it,
         and `.trim()` never sees that. */
      filter: (value: string) => String(value ?? '').replace(/\s+/g, ''),
      validate: (value: string) => {
        const key = String(value ?? '').replace(/\s+/g, '');
        return KEY_PATTERN.test(key) ? true : describeKeyProblem(key);
      },
    },
  ]);
  return publisherKey;
}

async function verifyWith(rawKey: string): Promise<VerifiedKey> {
  try {
    return await verifyKey(rawKey, CLIREVENUE_API_BASE_URL);
  } catch (err) {
    if (err instanceof KeyVerificationError) {
      throw new SetupError(
        err.message,
        'Check the key in your dashboard, then run setup again. Nothing was changed.',
      );
    }
    throw new SetupError(
      err instanceof Error ? err.message : 'The key could not be verified.',
      'The CLIRevenue API could not be reached. Nothing was changed — try again when you are online.',
    );
  }
}

/** Show enough of a credential to confirm which one was used, and no more. */
function maskKey(key: string): string {
  if (key.length <= 16) return `${key.slice(0, 4)}••••${key.slice(-4)}`;
  return `${key.slice(0, 8)}••••${key.slice(-4)}`;
}
