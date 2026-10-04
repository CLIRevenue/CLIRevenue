#!/usr/bin/env node
import { Command } from 'commander';
import { setup, SetupError } from './commands/setup.js';
import { colors, error as errorLine } from './utils/colors.js';

const program = new Command();

program
  .name('clirevenue')
  .description('CLIRevenue — install the SDK and configure ad delivery.')
  .version('1.0.0');

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
  .description('Run interactive project setup.')
  .action(async () => {
    await setup();
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
    const hint = error instanceof SetupError ? error.hint : undefined;

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