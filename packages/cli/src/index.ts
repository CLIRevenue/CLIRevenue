#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { setup, SetupError } from './commands/setup.js';
import { editor, EditorError } from './editor/index.js';
import { overlay } from './commands/overlay.js';
import { OverlayError } from './tui/overlay.js';
import { install, remove, status } from './keybindings/manage.js';
import { KEYBINDING_TARGETS, findTarget, detectTargets } from './keybindings/targets.js';
import {
  addIntegration,
  addSlot,
  listIntegrations,
  removeIntegration,
  removeSlot,
  type IntegrationConfig,
} from './project/config.js';
import { colors, error as errorLine, success, info, warn } from './utils/colors.js';
import { CLI_NAME, CLI_VERSION } from './version.js';

const program = new Command();

program
  .name(CLI_NAME)
  .description('CLIRevenue — install the SDK and configure ad delivery.')
  .version(CLI_VERSION);

/* With no subcommand, print help and succeed. Commander's default for a
   subcommand-only program is to write help to stderr and exit 1, which
   reads as a failure when the user simply typed `clirevenue`.

   Registering a default action does mean an unrecognised word arrives here
   instead of being rejected, so a bare word is still reported as an unknown
   command — a typo must never look like a success. */
program.action(function (this: Command, ..._args: unknown[]) {
  const unknown = (this as Command).args?.filter((arg: unknown) =>
    typeof arg === 'string' && !arg.startsWith('-'),
  ) ?? [];

  if (unknown.length > 0) {
    program.error(`unknown command '${unknown[0]}'`);
  }

  program.outputHelp();
});

/* Commander requires the handler to resolve to void, so the result of
   `setup()` is awaited and discarded here rather than returned. */
program
  .command('setup')
  .description('Run project setup: install the SDK, verify the key, wire up the project.')
  .action(async () => {
    await setup();
  });

/*
 * The editor runs its own local server and blocks until the user saves or
 * cancels, which is what makes it launchable from a keypress — the process
 * stays alive for exactly as long as the browser is open.
 */
program
  .command('editor')
  .description('Open the visual placement editor (drag, resize, save).')
  .option('-p, --placement <key>', 'Edit a specific placement instead of the default.')
  .option('-i, --integration <id>', 'Open a specific CLI integration instead of the default.')
  .action(async (options: { placement?: string; integration?: string }) => {
    await editor({ placementKey: options.placement, integrationId: options.integration });
  });

/* ------------------------------------------------------------------ *
 * The overlay
 * ------------------------------------------------------------------ */

/**
 * `clirevenue overlay` — the terminal-native flow.
 *
 * No browser: the panel is drawn in the terminal and the slot is placed by
 * dragging with the mouse, which reaches the process through SGR mouse
 * reporting. The command is also reachable as `clirevenue /clirevenue`, since
 * that is how it is described to developers on the dashboard, and `clirevenue`
 * is what they will type.
 */
program
  .command('overlay')
  .alias('/clirevenue')
  .description('Show your publisher panel and add an ad slot by dragging in this terminal.')
  .option('-i, --integration <id>', 'Add the slot to a specific CLI integration instead of the default.')
  .action(async (options: { integration?: string }) => {
    await overlay({ integrationId: options.integration });
  });

/* ------------------------------------------------------------------ *
 * Integrations and slots
 *
 * The lifecycle commands sit next to the keybinding commands because they
 * answer the same question from the other side: a binding is what *launches*
 * the editor, an integration is *what* the editor positions ads for. Neither
 * implies the other, and configuring one without the other leaves a project
 * that looks set up but does nothing.
 * ------------------------------------------------------------------ */

function describeIntegration(integration: IntegrationConfig, indent = '  '): string {
  const slotCount = Object.keys(integration.slots).length;
  const enabled = Object.values(integration.slots).filter((slot) => slot.enabled).length;
  const target = findTarget(integration.target);
  const launch = target ? target.alternativeCommand : 'clirevenue editor';
  return (
    `${indent}${integration.label}  (${integration.id})\n` +
    `${indent}  target    ${target ? target.name : integration.target}\n` +
    `${indent}  key       ${integration.placementKey}\n` +
    `${indent}  slots     ${enabled}/${slotCount} enabled\n` +
    `${indent}  launch    ${launch}`
  );
}

const integrations = program
  .command('integrations')
  .description('List, add, or remove the CLI integrations configured in this project.');

integrations
  .command('list')
  .alias('ls')
  .description('Show every CLI integration configured in this project.')
  .action(() => {
    const configured = listIntegrations(process.cwd());
    if (configured.length === 0) {
      process.stdout.write(
        `${info('No CLI integrations are configured in this project yet.')}\n` +
          `${colors.dim('  Run: clirevenue setup, or clirevenue integrations add')}\n`,
      );
      return;
    }
    process.stdout.write(
      `${colors.bold(`CLIRevenue integrations (${configured.length})`)}\n\n${configured
        .map((integration) => describeIntegration(integration))
        .join('\n\n')}\n`,
    );
  });

integrations
  .command('add')
  .description('Add a CLI integration. Each one gets its own placement key.')
  .argument('[target]', `one of: ${KEYBINDING_TARGETS.map((entry) => entry.id).join(', ')}`)
  .argument('[key]', 'placement key for this integration (defaults to <target>-1)')
  .action((targetId: string | undefined, keyArg: string | undefined) => {
    if (!targetId) {
      const detected = detectTargets(process.cwd())
        .filter((entry) => entry.id !== 'local')
        .map((entry) => entry.id);
      throw new SetupError(
        'Which CLI integration should be added?',
        detected.length > 0
          ? `Detected in this project: ${detected.join(', ')}. Try: clirevenue integrations add ${detected[0]}`
          : `Available targets: ${KEYBINDING_TARGETS.map((entry) => entry.id).join(', ')}`,
      );
    }
    const target = findTarget(targetId);
    if (!target) {
      throw new SetupError(
        `Unknown integration "${targetId}".`,
        `Available targets: ${KEYBINDING_TARGETS.map((entry) => entry.id).join(', ')}`,
      );
    }

    const configured = listIntegrations(process.cwd());
    const id = configured.some((entry) => entry.target === target.id)
      ? `${target.id}-${configured.filter((entry) => entry.target === target.id).length + 1}`
      : target.id;

    /* The key is derived from the target, not the project name. A stable key
       means re-running this command after a partial failure lands on the same
       key, so the backend's uniqueness constraint turns the retry into a
       no-op instead of a second placement. */
    const key = (keyArg ?? `${target.id}-1`).trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(key)) {
      throw new SetupError(
        `"${key}" is not a usable placement key.`,
        'Use 2-64 characters: lowercase letters, digits, hyphen or underscore, starting with a letter or digit.',
      );
    }

    const result = addIntegration(process.cwd(), {
      id,
      target: target.id,
      label: target.name,
      placementKey: key,
    });

    if (!result.created) {
      process.stdout.write(`${info(`Integration "${result.config.integrations[id]?.id ?? id}" is already configured — nothing changed.`)}\n`);
      return;
    }

    const added = result.config.integrations[id];
    process.stdout.write(`${success(`Added ${target.name} as "${id}" with placement key "${key}".`)}\n`);
    process.stdout.write(`${colors.dim(describeIntegration(added))}\n`);
    process.stdout.write(
      `\n${colors.dim('  Add its first ad slot with:')} clirevenue add-slot ${id}\n` +
        `${colors.dim('  Then position it with:')} clirevenue editor\n`,
    );
  });

integrations
  .command('remove')
  .description('Remove a CLI integration from this project (the backend placement is kept).')
  .argument('<id>', 'integration id, as shown by clirevenue integrations list')
  .action((id: string) => {
    const result = removeIntegration(process.cwd(), id);
    if (!result.removed) {
      process.stdout.write(`${info(`No integration "${id}" is configured in this project.`)}\n`);
      return;
    }
    process.stdout.write(
      `${success(`Removed "${result.removed.id}" (${Object.keys(result.removed.slots).length} slot(s)) from clirevenue.config.json.`)}\n`,
    );
    /* Being explicit about the consequence matters more than being brief:
       the key stays live on the server, so a user who deletes an integration
       by accident needs to know the ad is not gone. */
    process.stdout.write(
      `${colors.dim(`  The placement "${result.removed.placementKey}" still exists on your CLIRevenue account.`)}\n` +
        `${colors.dim('  Delete it from the dashboard if you no longer want it served.')}\n`,
    );
  });

program
  .command('add-slot')
  .description('Add another ad slot to an integration. Shares that integration\'s placement key.')
  .argument('<integration>', 'integration id, as shown by clirevenue integrations list')
  .argument('[label]', 'a name for this slot, shown in the editor')
  .action((integrationId: string, label: string | undefined) => {
    const result = addSlot(process.cwd(), integrationId, { label });
    process.stdout.write(
      `${success(`Added slot "${result.slot.id}" to "${integrationId}".`)}\n` +
        `${colors.dim('  Slots share the integration\'s placement key, so no new ad was created on the server.')}\n` +
        `${colors.dim('  Position it with:')} clirevenue editor\n`,
    );
  });

program
  .command('remove-slot')
  .description('Remove one ad slot. Other slots and integrations are untouched.')
  .argument('<integration>', 'integration id')
  .argument('<slot>', 'slot id, as shown by clirevenue integrations list')
  .action((integrationId: string, slotId: string) => {
    const result = removeSlot(process.cwd(), integrationId, slotId);
    process.stdout.write(
      result.removed
        ? `${success(`Removed slot "${slotId}" from "${integrationId}".`)}\n`
        : `${info(`No slot "${slotId}" on integration "${integrationId}".`)}\n`,
    );
  });

const keybindings = program
  .command('keybindings')
  .description('Register or remove a keybinding that launches the placement editor.');

/*
 * Keybinding management is explicit and project-local. Installing this npm
 * package must never, on its own, edit a user's editor configuration — so
 * nothing here runs unless the user names a target.
 */
keybindings
  .command('status')
  .description('Show which editors are detected and which have a CLIRevenue binding.')
  .action(() => {
    const statuses = status(process.cwd());
    if (statuses.length === 0) {
      process.stdout.write(`${warn('No supported editor configuration found in this project.')}\n`);
      return;
    }

    for (const entry of statuses) {
      const state = entry.conflicting
        ? colors.yellow('conflict')
        : entry.installed
          ? colors.green(entry.shortcut ? 'ready' : 'installed (no key)')
          : colors.dim('not installed');
      process.stdout.write(
        `${colors.bold(entry.target.name.padEnd(30))} ${state}\n${colors.dim(`  ${entry.path}`)}\n`,
      );
      for (const warning of entry.warnings) {
        process.stdout.write(`  ${colors.dim(warning)}\n`);
      }
    }

    const ready = statuses.some((entry) => entry.installed && entry.shortcut && !entry.conflicting);
    process.stdout.write(
      `\n${
        ready
          ? colors.green('Ctrl+I will launch the CLIRevenue editor in this project.')
          : warn('Ctrl+I is not registered yet. Run: clirevenue keybindings install <target>')
      }\n`,
    );
  });

keybindings
  .command('install')
  .description('Add the Ctrl+I binding for a detected editor to this project.')
  .argument('[target]', `one of: ${KEYBINDING_TARGETS.map((target) => target.id).join(', ')}`)
  .option('-f, --force', 'Replace an existing user binding for the same key.')
  .action((targetId: string | undefined, options: { force?: boolean }) => {
    if (!targetId) {
      const statuses = status(process.cwd());
      const detected = statuses.filter((entry) => entry.detected).map((entry) => entry.target.id);
      throw new SetupError(
        'Which editor should the binding be installed for?',
        detected.length > 0
          ? `Detected here: ${detected.join(', ')}. Try: clirevenue keybindings install ${detected[0]}`
          : `Available targets: ${KEYBINDING_TARGETS.map((target) => target.id).join(', ')}`,
      );
    }

    const result = install(process.cwd(), targetId, { force: options.force });

    switch (result.outcome) {
      case 'installed':
      case 'updated':
        process.stdout.write(`${success(`Binding written to ${result.path}`)}\n`);
        break;
      case 'unchanged':
        process.stdout.write(`${info(`Already set up in ${result.path} — nothing changed.`)}\n`);
        break;
      case 'conflict':
        throw new SetupError(
          `${findTarget(targetId)?.name ?? targetId} already has a Ctrl+I binding in ${result.path}.`,
          `Nothing was overwritten. Review it yourself, or re-run with --force to replace it.\n${result.conflict ?? ''}`,
        );
      case 'unsupported':
        process.stdout.write(`${warn(result.reason ?? 'That target is not supported.')}\n`);
        /*
         * `unsupported` covers two very different situations: a target that
         * CAN be wired up but has no hotkey for it (OpenCode gets a slash
         * command, Neovim a snippet) and a target that exposes no mechanism at
         * all (Kilo). Only the first wrote a file, and `result.path` is
         * populated either way because it is just `configPathFor(root, target)`.
         * Claiming "Wrote …" unconditionally is how the CLI ends up claiming to
         * have set up an integration that does not exist -- exactly what
         * Kilo's user would have been told, for a file that was never created.
         */
        if (result.path && existsSync(result.path)) {
          process.stdout.write(`${colors.dim(`  Wrote ${result.path}`)}\n`);
        }
        if (result.hint) process.stdout.write(`${colors.dim(result.hint)}\n`);
        break;
    }
  });

keybindings
  .command('remove')
  .description('Remove the CLIRevenue binding from this project.')
  .argument('[target]', `one of: ${KEYBINDING_TARGETS.map((target) => target.id).join(', ')}`)
  .action((targetId: string | undefined) => {
    if (!targetId) {
      throw new SetupError(
        'Which editor should the binding be removed from?',
        `Available targets: ${KEYBINDING_TARGETS.map((target) => target.id).join(', ')}`,
      );
    }

    const result = remove(process.cwd(), targetId);
    switch (result.outcome) {
      case 'removed':
        process.stdout.write(`${success(`Removed the CLIRevenue binding from ${result.path}`)}\n`);
        break;
      case 'file-removed':
        process.stdout.write(`${success(`Removed ${result.path} — it held nothing else.`)}\n`);
        break;
      case 'absent':
        process.stdout.write(`${info('No CLIRevenue binding was installed there.')}\n`);
        break;
      case 'unsupported':
        process.stdout.write(`${warn(`${findTarget(result.target)?.name ?? result.target} has nothing to remove -- there is no CLIRevenue file for it.`)}\n`);
        break;
    }
  });

/* `parseAsync`, not `parse`.
   The setup command is async — it awaits prompts, a network call and an
   install. Commander's synchronous `parse()` fires the action and returns
   immediately, so any rejection after the last `await` escaped as an
   unhandled rejection and Node terminated the process with a raw stack
   trace. That is what looked like the terminal crashing. */
program
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    /* Every failure the CLI raises on purpose arrives here already
       carrying a message meant for a person. Anything else is a bug, so
       it is still reported as a failure with a non-zero exit code — but
       the stack is kept behind an explicit flag rather than dumped over
       the terminal by default. */
    const debug = process.env.CLIREVENUE_DEBUG === '1';
    const message =
      error instanceof Error ? error.message : 'CLIRevenue setup failed for an unknown reason.';
    const hint =
      error instanceof SetupError ||
      error instanceof EditorError ||
      error instanceof OverlayError
        ? error.hint
        : undefined;

    process.stderr.write(`${errorLine(message)}\n`);
    if (hint) {
      process.stderr.write(`${colors.dim(hint)}\n`);
    }

    if (!(error instanceof Error)) {
      process.stderr.write(`${colors.dim(String(error))}\n`);
    } else if (debug && error.stack) {
      process.stderr.write(`${colors.dim(error.stack)}\n`);
    } else {
      process.stderr.write(`${colors.dim('Re-run with CLIREVENUE_DEBUG=1 for the full stack.')}\n`);
    }

    /* `exitCode`, not `process.exit()`: exiting here would truncate any
       buffered stdout on a pipe and can leave a terminal looking
       truncated. Setting the code lets Node finish writing and exit 1. */
    process.exitCode = 1;
  });