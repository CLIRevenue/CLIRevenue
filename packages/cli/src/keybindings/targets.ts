import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Which coding CLIs can honestly offer a `Ctrl+I` placement editor.
 *
 * The registry exists because "installing an npm package gives you Ctrl+I" is
 * false. Nothing in this table is registered globally, and nothing is written
 * outside the user's project unless they ask for it. Each entry states the
 * *real* mechanism it drives, and refuses outright where the shortcut is
 * already spoken for.
 *
 * The Ctrl+I trap is the reason this is a table and not a constant. Most
 * terminal input protocols deliver `0x09` for Ctrl+I, which is what most
 * programs (readline, tmux, Vim's normal mode) mean by Tab. In Vim, `Ctrl+I`
 * literally *is* `<Tab>`, so binding it there would silently break indentation
 * — an editor that hijacks Tab is worse than no editor, so Neovim is listed
 * as feasible-with-alternative rather than pretended into parity.
 */
export interface KeybindingTarget {
  /** Stable id used on the command line. */
  id: string;
  /** Human name shown to the user. */
  name: string;
  /** Project-relative file the binding is written to. */
  configPath: string;
  /** The shortcut we ask for, or `null` when it cannot be bound. */
  shortcut: string | null;
  /**
   * Why the shortcut cannot be used, in the user's terms. `null` means the
   * shortcut is genuinely available. Never invent a shortcut to fill this in.
   */
  shortcutUnavailableReason: string | null;
  /** What the user runs instead when the shortcut is unavailable. */
  alternativeCommand: string;
  /** How the binding invokes the editor, for documentation output. */
  mechanism: string;
  /**
   * What to write to `configPath` when there is no shortcut to bind.
   *
   * Omit it when the application exposes no way to register the command at
   * all — then `install` writes nothing and says so, rather than dropping an
   * inert file that looks like it does something. A file the user has to
   * wire up themselves is still worth writing, because the write is what
   * makes it available to wire up.
   */
  snippet?: () => string;
  /** Rough likelihood the user runs this CLI in this project. */
  detect(root: string): boolean;
}

/**
 * VS Code and its forks share one keybinding format and one keybinding file,
 * so they are one target rather than three: the same JSON works in VS Code,
 * Cursor, Windsurf and VSCodium.
 *
 * The mechanism is a real one. VS Code resolves a user keybinding before it
 * forwards keys to the integrated terminal, so `ctrl+i` reaches the keymap
 * instead of the shell — unless `terminal.integrated.sendKeybindingsToShell`
 * is enabled, which `status()` reports on rather than silently working
 * around.
 */
const vscode: KeybindingTarget = {
  id: 'vscode',
  name: 'VS Code / Cursor / Windsurf / VSCodium',
  configPath: '.vscode/keybindings.json',
  shortcut: 'ctrl+i',
  shortcutUnavailableReason: null,
  alternativeCommand: 'clirevenue editor',
  mechanism:
    'A project-scoped .vscode/keybindings.json entry that sends "clirevenue editor" to the integrated terminal.',
  detect(root) {
    return (
      existsSync(join(root, '.vscode')) ||
      existsSync(join(root, '.cursor')) ||
      existsSync(join(root, '.windsurf'))
    );
  },
};

/**
 * Neovim, honestly.
 *
 * `Ctrl+I` is `<Tab>` in Vim normal mode and Neovim inherits that. Binding it
 * would break indentation for every user, so we do not offer it; we ship a
 * project-local snippet with a `:ClirevenueEditor` command and leave adding it
 * to the user's `init.lua` as their decision.
 */
const neovim: KeybindingTarget = {
  id: 'neovim',
  name: 'Neovim',
  configPath: '.clirevenue/keybindings.vim',
  shortcut: null,
  shortcutUnavailableReason:
    'Ctrl+I is <Tab> in Neovim normal mode, so binding it would break indentation.',
  alternativeCommand: ':ClirevenueEditor',
  mechanism:
    'A project-local snippet defining :ClirevenueEditor, which you add to your init.lua yourself.',
  snippet: neovimSnippet,
  detect(root) {
    return existsSync(join(root, '.nvim.lua')) || existsSync(join(root, 'init.vim'));
  },
};

/**
 * OpenCode, honestly.
 *
 * OpenCode 1.18.35 *does* have a keybinding system, but it is not a key
 * system in the usual sense: `keybinds` in `tui.json` is a map from a key
 * combination to one of a **closed set of 184 named actions**, and not one of
 * them runs a shell command. There is no `shell`, `exec` or `palette` action.
 * So no amount of configuration can make Ctrl+I launch `clirevenue editor` in
 * OpenCode, and shipping a binding that looks like it does would be a lie
 * with a keyboard shortcut attached.
 *
 * What OpenCode does support is project-local custom commands: a markdown
 * file under `.opencode/command/` or `.opencode/commands/` with YAML
 * frontmatter, invoked as `/<name>`. That is a slash command, not a hotkey,
 * and the body is a prompt handed to the agent rather than an exec — the
 * agent is the thing that ends up running `clirevenue editor`. `mechanism`
 * says so, and the file we write tells the agent to run it in the background,
 * because the editor process stays alive until the user saves or cancels.
 */
const opencode: KeybindingTarget = {
  id: 'opencode',
  name: 'OpenCode',
  configPath: '.opencode/commands/clirevenue-editor.md',
  shortcut: null,
  shortcutUnavailableReason:
    "OpenCode's keybinds can only re-point a key at one of its own built-in actions (the `keybinds` map in tui.json is a closed set of 184 action names, none of which run a command), so no key can launch the editor.",
  alternativeCommand: '/clirevenue-editor',
  mechanism:
    'A project-local OpenCode slash command that asks the agent to run `clirevenue editor` and surface the editor URL.',
  snippet: opencodeCommand,
  detect(root) {
    return existsSync(join(root, '.opencode')) || existsSync(join(root, 'opencode.json'));
  },
};

/**
 * Kilo Code CLI, honestly — and the reason is a bare "nothing was written".
 *
 * This is not a VS Code extension; it is a standalone agent CLI. Its config
 * is a repo-local `kilo.json` that configures instructions and agent
 * behaviour, and searching the shipped binary for `keybind`/`hotkey`/`keymap`
 * turns up exactly one key combination (`ctrl+p`) plus a documentation index
 * heading and an unrelated LRU cache. There is no keybinding mechanism to
 * register with, so this target deliberately writes **no file**: there is
 * nothing for the user to wire up, and an inert file that looks like an
 * integration is worse than an honest absence.
 */
const kilo: KeybindingTarget = {
  id: 'kilo',
  name: 'Kilo Code CLI',
  configPath: '.clirevenue/kilo.md',
  shortcut: null,
  shortcutUnavailableReason:
    'Kilo Code CLI has no keybinding or command-registration mechanism, so Ctrl+I cannot be bound and nothing was written. Run `clirevenue editor` in a terminal.',
  alternativeCommand: 'clirevenue editor',
  mechanism: 'No project file: Kilo exposes nothing to register a command in.',
  detect(root) {
    return existsSync(join(root, 'kilo.json')) || existsSync(join(root, '.kilocode'));
  },
};

/** tmux only matters if we are running inside one, and it is rarely the editor. */
const tmux: KeybindingTarget = {
  id: 'tmux',
  name: 'tmux',
  configPath: '.clirevenue/tmux.conf',
  shortcut: null,
  shortcutUnavailableReason:
    'Ctrl+I reaches the pane as Tab in tmux, and binding it would collide with prefix handling.',
  alternativeCommand: 'clirevenue editor',
  mechanism: 'A tmux snippet that runs "clirevenue editor" as a split-pane command.',
  detect() {
    return Boolean(process.env.TMUX);
  },
};

/* ------------------------------------------------------------------ *
 * Agent CLIs that support a slash command but no hotkey
 * ------------------------------------------------------------------ */

/**
 * Claude Code.
 *
 * `.claude/commands/<name>.md` is a documented project-local command invoked
 * as `/<name>`. The docs also note that custom commands have been merged into
 * skills, so `.claude/skills/<name>/SKILL.md` is the newer spelling of the
 * same thing; the commands directory is still supported and is what this
 * writes, because it is a single file rather than a directory plus a manifest.
 *
 * There is no hotkey mechanism: `~/.claude/settings.json` on this machine has
 * only `permissions` and `hooks`, and a command is a prompt the agent runs,
 * not something a keystroke can execute.
 */
const claudeCode: KeybindingTarget = {
  id: 'claude-code',
  name: 'Claude Code',
  configPath: '.claude/commands/clirevenue-editor.md',
  shortcut: null,
  shortcutUnavailableReason:
    'Claude Code has no hotkey mechanism for commands. Use /clirevenue-editor instead.',
  alternativeCommand: '/clirevenue-editor',
  mechanism: 'A project command in .claude/commands/, run by the agent.',
  snippet: claudeCodeCommand,
  detect: (root) => existsSync(join(root, '.claude')) || existsSync(join(root, 'CLAUDE.md')),
};

/**
 * Gemini CLI.
 *
 * Unlike the markdown-command CLIs, Gemini expects TOML: `.gemini/commands/
 * <name>.toml` with a required `prompt` key and an optional `description`.
 * The body supports `{{args}}` substitution and `!{...}` for inline shell.
 * Neither is needed here, so the snippet stays deliberately minimal — a TOML
 * file with a key Gemini does not recognise is a file Gemini refuses to load.
 */
const gemini: KeybindingTarget = {
  id: 'gemini',
  name: 'Gemini CLI',
  configPath: '.gemini/commands/clirevenue-editor.toml',
  shortcut: null,
  shortcutUnavailableReason:
    'Gemini CLI has no hotkey mechanism for custom commands. Use /clirevenue-editor instead.',
  alternativeCommand: '/clirevenue-editor',
  mechanism: 'A project command in .gemini/commands/, run by the agent.',
  snippet: geminiCommand,
  detect: (root) => existsSync(join(root, '.gemini')) || existsSync(join(root, 'GEMINI.md')),
};

/**
 * OpenAI Codex CLI.
 *
 * `.codex/prompts/<name>.md`, invoked as `/prompts:<name>` — the namespace is
 * part of the invocation, not an accident of the file layout.
 */
const codex: KeybindingTarget = {
  id: 'codex',
  name: 'OpenAI Codex CLI',
  configPath: '.codex/prompts/clirevenue-editor.md',
  shortcut: null,
  shortcutUnavailableReason:
    'Codex CLI has no hotkey mechanism for prompts. Use /prompts:clirevenue-editor instead.',
  alternativeCommand: '/prompts:clirevenue-editor',
  mechanism: 'A project prompt in .codex/prompts/, run by the agent.',
  snippet: codexPrompt,
  detect: (root) => existsSync(join(root, '.codex')) || existsSync(join(root, 'AGENTS.md')),
};

/* ------------------------------------------------------------------ *
 * Targets with no verifiable mechanism
 * ------------------------------------------------------------------ */

/**
 * Aider.
 *
 * Aider's configuration is `.aider.conf.yml`, a settings file for the model,
 * repository and editor choices. It has no custom-command or plugin surface,
 * so there is nothing to register a command in and nothing honest to write.
 */
const aider: KeybindingTarget = {
  id: 'aider',
  name: 'Aider',
  configPath: '.aider.conf.yml',
  shortcut: null,
  shortcutUnavailableReason:
    'Aider has no custom-command or plugin mechanism, so nothing can be registered.',
  alternativeCommand: 'clirevenue editor',
  mechanism: 'No project file: Aider exposes no command surface to write into.',
  detect: (root) => existsSync(join(root, '.aider.conf.yml')) || existsSync(join(root, 'CONVENTIONS.md')),
};

/**
 * Cline.
 *
 * Cline is a VS Code extension, so the `.vscode/keybindings.json` mechanism
 * from the `vscode` target is the correct one — but the command id must come
 * from the extension's own `contributes.commands` in its `package.json`. Cline
 * is not installed on this machine, so that id cannot be read and must not be
 * guessed: a keybinding pointing at a command id the extension does not
 * define is a silent no-op, which is exactly the bug this registry exists to
 * prevent.
 */
const cline: KeybindingTarget = {
  id: 'cline',
  name: 'Cline (VS Code extension)',
  configPath: '.vscode/keybindings.json',
  shortcut: null,
  shortcutUnavailableReason:
    'Cline is a VS Code extension, so a keybinding is possible, but it must target the command id ' +
    'Cline publishes in its own package.json. CLIRevenue does not guess that id: read it from the ' +
    'installed extension and add the entry by hand, or run clirevenue editor directly.',
  alternativeCommand: 'clirevenue editor',
  mechanism: 'No project file: the extension command id must be read from the installed extension.',
  detect: (root) => existsSync(join(root, '.cline')) || existsSync(join(root, '.clinerules')),
};

/**
 * A CLI the user names themselves.
 *
 * The escape hatch for anything not in this table. It writes nothing, because
 * CLIRevenue cannot know where such a tool reads its commands from, and a
 * file in an invented location is worse than no file.
 */
const local: KeybindingTarget = {
  id: 'local',
  name: 'Another CLI (configured by you)',
  configPath: '.clirevenue/local.md',
  shortcut: null,
  shortcutUnavailableReason:
    'CLIRevenue cannot know how an unlisted CLI registers commands, so nothing is written for it.',
  alternativeCommand: 'clirevenue editor',
  mechanism: 'No project file: the mechanism is specific to each CLI.',
  detect: () => false,
};

/**
 * Freebuff — deliberately unresolved.
 *
 * More than one product could be meant by this name, and the cost of guessing
 * is high: writing a config file in the wrong format into someone's project
 * is worse than not offering the integration. It stays here, inert and
 * undocumented in the table, until the exact product is identified. See the
 * note on `UNRESOLVED_TARGETS`.
 */
const freebuff: KeybindingTarget = {
  id: 'freebuff',
  name: 'Freebuff (unidentified)',
  configPath: '',
  shortcut: null,
  shortcutUnavailableReason:
    'Freebuff could not be identified with confidence, so CLIRevenue does not claim to support it.',
  alternativeCommand: 'clirevenue editor',
  mechanism: 'No project file: the product behind this name is not confirmed.',
  detect: () => false,
};

/**
 * Targets CLIRevenue knows about but cannot honestly integrate yet.
 *
 * `configPath: ''` is the marker: `install` refuses a target with no config
 * path, and `status` reports it as unresolved rather than "not installed",
 * which keeps a question ("what did you mean by Freebuff?") visible instead
 * of silently degrading.
 */
export const UNRESOLVED_TARGETS: KeybindingTarget[] = [freebuff];

export const KEYBINDING_TARGETS: KeybindingTarget[] = [
  vscode,
  claudeCode,
  opencode,
  codex,
  gemini,
  neovim,
  tmux,
  cline,
  kilo,
  aider,
  local,
  ...UNRESOLVED_TARGETS,
];

export function findTarget(id: string): KeybindingTarget | null {
  return KEYBINDING_TARGETS.find((target) => target.id === id) ?? null;
}

/** Every target whose editor looks installed in this project. */
export function detectTargets(root: string): KeybindingTarget[] {
  return KEYBINDING_TARGETS.filter((target) => target.detect(root));
}

/** Targets we are willing to bind automatically. */
export function bindableTargets(): KeybindingTarget[] {
  return KEYBINDING_TARGETS.filter((target) => target.shortcut !== null);
}

/**
 * The Neovim snippet. Written to the project, never to `~/.config/nvim`:
 * a CLI that silently edits a user's global editor config is a CLI users
 * have to be careful running, and there is no consent prompt at install time
 * that makes "just rewrite my init.lua" acceptable.
 */
export function neovimSnippet(): string {
  return [
    '" CLIRevenue placement editor — project-local snippet.',
    '" Add to your init.lua with:',
    '"   :source <sfile>:p:h/.clirevenue/keybindings.vim',
    'command! -nargs=0 ClirevenueEditor execute "!clirevenue editor"',
    '',
  ].join('\n');
}

/**
 * The OpenCode slash command.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * The body is a **prompt for the agent**, not a shell script. OpenCode hands
 * the markdown to the model and lets the model run the command, so the file
 * has to tell the agent what to do rather than doing it.
 *
 * And the editor process does not exit on its own — it serves a local page
 * and waits until the user saves or cancels. An agent that runs
 * `clirevenue editor` synchronously would block its own turn forever, so the
 * command tells it to background the process and read the printed URL. This
 * is the same reason the editor prints its URL instead of assuming a browser
 * appeared.
 */
export function opencodeCommand(): string {
  return [
    '---',
    'description: Open the CLIRevenue placement editor to position and size the ad.',
    '---',
    '',
    'Open the CLIRevenue placement editor for this project.',
    '',
    '## Steps',
    '',
    '1. Start the editor in the background. It stays alive until the user saves',
    '   or cancels, so do not run it in the foreground or you will block:',
    '',
    '   ```sh',
    '   npx clirevenue editor > "$(mktemp -t clirevenue-editor).log" 2>&1 &',
    '   ```',
    '',
    '2. Read that log file. It contains the editor URL, which looks like',
    '   `http://127.0.0.1:<port>/editor?token=<random>`.',
    '',
    '3. Give the user that URL and tell them: drag the ad to position it, drag',
    '   a corner to resize it, then press **Save**.',
    '',
    '4. When the user reports they are done, read `clirevenue.config.json` and',
    '   tell them the saved width, height, anchor and offsets.',
    '',
    '## Notes',
    '',
    '- Do not edit `clirevenue.config.json` yourself. The editor writes it, and',
    '  hand-editing it means the placement the user placed is not the placement',
    '  that ships.',
    '- If the command reports no publisher key, the project has not been set up',
    '  yet. Run `npx clirevenue setup` first.',
    '',
  ].join('\n');
}

/**
 * The VS Code keybinding entry.
 *
 * `sendSequence` types the command into the active terminal rather than
 * spawning a new one, so the editor lands in the pane the user is already
 * working in and their shell history keeps working.
 */
/**
 * The body shared by every agent-CLI command file.
 *
 * These files are *prompts*, not scripts: the agent reads them and decides to
 * run the commands. That is why the wording is imperative and step-by-step
 * rather than a shell script — the agent cannot `exec` a file it did not
 * choose to run, and a file that assumed otherwise would do nothing at all.
 *
 * The step to background the editor is not optional. `clirevenue editor`
 * stays alive until the user saves or cancels, so running it in the foreground
 * would hang the agent's turn forever.
 */
const EDITOR_COMMAND_BODY = [
  '## Steps',
  '',
  '1. Start the editor in the background. It stays alive until the user saves',
  '   or cancels, so do not run it in the foreground or you will block:',
  '',
  '   ```sh',
  '   npx clirevenue editor > "$(mktemp -t clirevenue-editor).log" 2>&1 &',
  '   ```',
  '',
  '2. Read that log file. It contains the editor URL, which looks like',
  '   `http://127.0.0.1:<port>/editor?token=<random>`.',
  '',
  '3. Give the user that URL and tell them: drag the ad to position it, drag',
  '   a corner to resize it, then press **Save**.',
  '',
  '4. When the user reports they are done, read `clirevenue.config.json` and',
  '   tell them the saved width, height, anchor and offsets.',
  '',
  '## Notes',
  '',
  '- Do not edit `clirevenue.config.json` yourself. The editor writes it, and',
  '  hand-editing it means the placement the user placed is not the placement',
  '  that ships.',
  '- If the command reports no publisher key, the project has not been set up',
  '  yet. Run `npx clirevenue setup` first.',
  '',
];

/** Claude Code's `.claude/commands/<name>.md`. */
export function claudeCodeCommand(): string {
  return [
    '---',
    'description: Open the CLIRevenue placement editor to position and size the ad.',
    '---',
    '',
    'Open the CLIRevenue placement editor for this project.',
    '',
    ...EDITOR_COMMAND_BODY,
  ].join('\n');
}

/**
 * Gemini CLI's `.gemini/commands/<name>.toml`.
 *
 * TOML, and only the keys Gemini documents: `prompt` is required,
 * `description` is optional. Nothing else — an unknown key can make Gemini
 * reject the file, which would look to the user like the integration is
 * broken rather than like CLIRevenue wrote something invalid.
 */
export function geminiCommand(): string {
  const prompt = [
    'Open the CLIRevenue placement editor for this project.',
    '',
    ...EDITOR_COMMAND_BODY,
  ].join('\n');
  /* A multi-line TOML basic string is delimited by three quotes. The prompt
     contains no backslashes, so escaping would be noise; if that ever
     changes, this must become a literal string instead. */
  return [
    'description = "Open the CLIRevenue placement editor to position and size the ad."',
    '',
    'prompt = """',
    prompt,
    '"""',
    '',
  ].join('\n');
}

/** Codex CLI's `.codex/prompts/<name>.md`. */
export function codexPrompt(): string {
  return [
    'Open the CLIRevenue placement editor for this project.',
    '',
    ...EDITOR_COMMAND_BODY,
  ].join('\n');
}

export function vscodeBinding(): Record<string, unknown> {
  return {
    key: 'ctrl+i',
    command: 'workbench.action.terminal.sendSequence',
    args: { text: 'clirevenue editor\n' },
    when: 'terminalFocus',
  };
}

/**
 * True when `keybindings.json` exists but hands Ctrl+I to the shell.
 *
 * This is the single most common reason a VS Code binding appears not to
 * work, and it is invisible to the user, so `status()` surfaces it as a
 * warning instead of letting them conclude the CLI is broken.
 */
export function terminalOwnsKeybindings(root: string): boolean {
  const settings = join(root, '.vscode', 'settings.json');
  if (!existsSync(settings)) return false;
  try {
    return /"terminal\.integrated\.sendKeybindingsToShell"\s*:\s*true/.test(readFileSync(settings, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Find an existing binding for a key that is not ours.
 *
 * Returns the conflicting entry so the caller can show the user exactly what
 * they are about to displace, instead of a vague "conflict detected".
 */
export function findConflict(
  bindings: Array<Record<string, unknown>>,
  key: string,
  managedMarker: string,
): Record<string, unknown> | null {
  return (
    bindings.find(
      (binding) =>
        typeof binding?.key === 'string' &&
        binding.key.toLowerCase() === key.toLowerCase() &&
        !JSON.stringify(binding).includes(managedMarker),
    ) ?? null
  );
}
