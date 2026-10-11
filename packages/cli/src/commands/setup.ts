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
  readKeyFromEnvFile,
  PUBLISHABLE_KEY_PATTERN as KEY_PATTERN,
} from '../verify/key-file.js';
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

  if (!isSupported(project.type)) {
    throw new SetupError(
      'Unsupported project.',
      project.reason ??
        `CLIRevenue setup supports Vite (React, Vue, Svelte or plain JavaScript) and static HTML pages. Run it from your app's root (${project.root}).`,
    );
  }

  write(`${success(describeProject(project))}\n`);
  if (!project.supportsRendering) {
    write(
      `${warn(
        'No browser page was found, so there is nowhere to mount the ad yet. The SDK renders into the DOM.',
      )}\n`,
    );
  }

  write(`${info('CLIRevenue SDK')}\n`);
  try {
    const installed = await install(project.root);
    write(
      installed.alreadyInstalled
        ? `${success(`@clirevenue/sdk@${CLIREVENUE_SDK_VERSION} is already installed`)}\n`
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
  write(`${success(`Publisher identified: ${verified.publisherId}`)}\n`);

  /*
   * Step: which coding CLIs does this project serve?
   *
   * One integration owns exactly one placement key, so asking "how many CLIs"
   * is what determines how many ads exist on the account. Slots come later and
   * are free: three ads on one page share one key.
   */
  const integrations = await provisionIntegrations({
    projectRoot: project.root,
    verified,
    write,
    choose: options.chooseIntegrations ?? chooseIntegrations,
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

  return { project, key: rawKey, verified, result, integrations, shortcutReady };
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
/** Placement key derived from a target id: `<target>-1`, `<target>-2`, … */
function placementKeyFor(targetId: string, index: number): string {
  return `${targetId}-${index}`;
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
  write: (message: string) => void;
  choose: typeof chooseIntegrations;
}

/**
 * Turn the user's choice into one placement key per integration.
 *
 * A key is derived from the *target id* (`codex-1`, `codex-2`) rather than
 * from a timestamp or the project name, so a retry after a partial failure
 * lands on the same key and the backend's uniqueness constraint turns the
 * retry into a no-op instead of a second placement.
 */
export async function provisionIntegrations(
  options: ProvisionIntegrationsOptions,
): Promise<IntegrationConfig[]> {
  const { projectRoot, verified, write, choose } = options;
  const existing = listIntegrations(projectRoot);
  const detected = detectTargets(projectRoot).map((target) => target.id);

  write(`${info('Coding CLI integrations')}\n`);
  const chosen = await choose({ projectRoot, detected, existing });
  if (chosen.length === 0) {
    write(`${info('Skipped. You can add integrations later with: clirevenue integrations add')}\n`);
    return existing;
  }

  const created: IntegrationConfig[] = [];
  for (const targetId of chosen) {
    const target = findTarget(targetId);
    if (!target) continue;

    const sameTarget = existing.filter((entry) => entry.target === targetId);
    const id = sameTarget.length === 0 ? targetId : `${targetId}-${sameTarget.length + 1}`;
    const placementKey = placementKeyFor(targetId, sameTarget.length + 1);

    const result = addIntegration(projectRoot, {
      id,
      target: targetId,
      label: sameTarget.length === 0 ? target.name : `${target.name} ${sameTarget.length + 1}`,
      placementKey,
    });
    /* A slot is always created alongside its integration: an integration with
       no slot renders nothing, which would look like the setup failed. */
    const withSlot = addSlot(projectRoot, id, {
      label: 'Ad 1',
      layout: loadLayout(projectRoot, id),
    });
    created.push(withSlot.config.integrations[id]);

    write(
      result.created
        ? `${success(`${target.name} added as "${id}" with placement key "${placementKey}"`)}\n`
        : `${success(`${target.name} was already configured as "${id}"`)}\n`,
    );
  }

  configureBindings(projectRoot, created, write);
  return created;
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
      message: 'CLIRevenue publishable key (pk_live_… or pk_test_…)',
      validate: (value: string) =>
        KEY_PATTERN.test(value.trim())
          ? true
          : 'That does not look like a CLIRevenue publishable key.',
      filter: (value: string) => value.trim(),
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
