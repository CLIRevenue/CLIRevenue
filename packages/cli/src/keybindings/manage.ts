import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileExists, readFile, writeFile } from '../utils/files.js';
import {
  KEYBINDING_TARGETS,
  findTarget,
  terminalOwnsKeybindings,
  vscodeBinding,
  type KeybindingTarget,
} from './targets.js';

/**
 * Idempotent, conflict-aware keybinding management.
 *
 * Everything here operates strictly inside the user's project. No function
 * writes to `~/.config`, `~/.vscode`, `$HOME`, or any global editor
 * directory, because a CLI that edits global editor config on install is
 * indistinguishable from malware and deserves the distrust.
 *
 * The three properties the tests pin down:
 *
 * - **Idempotent.** Running `install` twice produces a byte-identical file.
 *   Installation is expressed as a delimited, self-describing block, so
 *   re-running replaces exactly that block and leaves every other byte alone.
 * - **Non-destructive.** The user's file is never parsed and re-serialised.
 *   `.vscode/keybindings.json` is JSONC — it routinely contains comments and
 *   trailing commas, and a round-trip through `JSON.parse`/`stringify` would
 *   delete them. We append or replace a marked region as text instead.
 * - **Conflict-aware.** If the user already binds `ctrl+i` themselves, we
 *   refuse and say so. Overriding a binding is a decision only they can make.
 */

export const MARKER_START = '// >>> clirevenue keybinding >>>';
export const MARKER_END = '// <<< clirevenue keybinding <<<';

/** The string a user-supplied binding would contain, used to detect ourselves. */
export const MANAGED_MARKER = 'clirevenue keybinding';

export type InstallOutcome =
  /** The block was added for the first time. */
  | 'installed'
  /** The block was already present and is unchanged. */
  | 'unchanged'
  /** An existing block was updated (e.g. the command changed). */
  | 'updated'
  /** Refused: the shortcut is already bound by the user. */
  | 'conflict'
  /** Refused: the target cannot bind the shortcut at all. */
  | 'unsupported';

export interface InstallResult {
  target: string;
  outcome: InstallOutcome;
  path: string;
  /** Set when `outcome === 'conflict'`: the user's own binding, verbatim. */
  conflict?: Record<string, unknown>;
  reason?: string;
  hint?: string;
}

function managedBlock(target: KeybindingTarget): string {
  const body = vscodeBinding();
  const pretty = JSON.stringify(body, null, 2)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return [
    MARKER_START,
    '// Managed by `clirevenue keybindings install`. Edit outside this block freely;',
    '// this block is replaced wholesale when the CLI is re-run.',
    '// Removes with `clirevenue keybindings remove`.',
    ...(target.shortcutUnavailableReason ? ['// NOTE: Ctrl+I is unavailable here; see status output.'] : []),
    pretty,
    MARKER_END,
  ].join('\n');
}

/** The managed block if the file has one, else `null`. */
export function readManagedBlock(path: string): string | null {
  if (!fileExists(path)) return null;
  const text = readFile(path);
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + MARKER_END.length);
}

/**
 * Find the user's own `ctrl+i` binding, if any.
 *
 * We scan text rather than parsing JSON, for the same reason we append rather
 * than re-serialise: the file is JSONC and a strict parse would fail on a
 * perfectly normal commented file. This is a conservative textual scan — it
 * can miss an exotic formatting of the key, and it deliberately over-reports
 * rather than silently overwriting.
 */
export function findUserBinding(path: string, key: string): Record<string, unknown> | null {
  if (!fileExists(path)) return null;
  const text = readFile(path);
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END);
  const withoutManaged = start === -1 ? text : text.slice(0, start) + text.slice(end + MARKER_END.length);

  const pattern = new RegExp(`"key"\\s*:\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i');
  const match = pattern.exec(withoutManaged);
  if (!match) return null;

  /* Recover the enclosing object so the user sees their real command, not
     just the fact that something matched. */
  const objectStart = withoutManaged.lastIndexOf('{', match.index);
  const objectEnd = withoutManaged.indexOf('}', match.index);
  if (objectStart === -1 || objectEnd === -1) return { key };

  try {
    return JSON.parse(withoutManaged.slice(objectStart, objectEnd + 1)) as Record<string, unknown>;
  } catch {
    return { key };
  }
}

/** Where a target's binding file lives for a given project root. */
export function configPathFor(root: string, target: KeybindingTarget): string {
  return join(root, target.configPath);
}

/**
 * Install the keybinding for one target.
 *
 * `force` is the explicit consent to displace an existing binding. Without
 * it a conflict is reported, never overwritten.
 */
export function install(root: string, targetId: string, options: { force?: boolean } = {}): InstallResult {
  const target = findTarget(targetId);
  if (!target) {
    return {
      target: targetId,
      outcome: 'unsupported',
      path: join(root, 'keybindings.json'),
      reason: `Unknown editor "${targetId}". Known: ${KEYBINDING_TARGETS.map((t) => t.id).join(', ')}.`,
    };
  }

  /* An unresolved target has no config path, so `configPathFor` would hand
     back the project root itself. Refuse before any path is built: writing
     to (or reading) the root because a product could not be identified is
     exactly the sort of thing that destroys a user's directory. */
  if (!target.configPath) {
    return {
      target: target.id,
      outcome: 'unsupported',
      path: '',
      reason: target.shortcutUnavailableReason ?? 'Not enough is known to write a config file.',
      hint: 'Run `clirevenue editor` instead.',
    };
  }

  const path = configPathFor(root, target);

  if (target.shortcut === null) {
    const outcome: InstallResult = {
      target: target.id,
      outcome: 'unsupported',
      path,
      reason: target.shortcutUnavailableReason ?? 'This editor cannot bind the requested shortcut.',
      hint: `Run \`${target.alternativeCommand}\` instead.`,
    };
    /* A target with a snippet still gets its project-local file written,
       because that file is inert until the user chooses to source or invoke
       it. A target without one (Kilo, which exposes nothing to register with)
       gets no file at all: an inert file that looks like an integration is
       worse than an honest absence. */
    if (target.snippet) writeFile(path, target.snippet());
    return outcome;
  }

  const conflict = findUserBinding(path, target.shortcut);
  if (conflict && !options.force) {
    return {
      target: target.id,
      outcome: 'conflict',
      path,
      conflict,
      reason: `Ctrl+I is already bound in ${target.configPath}.`,
      hint: `Re-run with --force to take precedence, or run \`${target.alternativeCommand}\` and keep your binding.`,
    };
  }

  const block = managedBlock(target);
  const existing = readManagedBlock(path);

  if (existing === block) return { target: target.id, outcome: 'unchanged', path };
  if (existing === null) {
    const prefix = fileExists(path) ? readFile(path) : '[]';
    const trimmed = prefix.trimEnd();
    if (!trimmed.endsWith(']')) {
      writeFile(path, `[\n${block}\n]\n`);
      return { target: target.id, outcome: 'installed', path };
    }
    /* Drop the closing bracket and any dangling comma the user left behind,
       then decide whether our entry still needs a separator. An empty array
       has nothing to separate from, and emitting `[,` would produce a file
       VS Code refuses to parse. */
    const head = trimmed.slice(0, -1).replace(/,\s*$/, '');
    const needsComma = head.trim() !== '[';
    /* A conflicting entry the user owns is deliberately left in place. We
       append after it, and VS Code resolves duplicate keybindings last-wins,
       so ours takes precedence while theirs stays recoverable: removing our
       block restores their original behaviour exactly. Excising someone
       else's binding out of a JSONC file is the destructive option. */
    writeFile(path, `${head}${needsComma ? ',' : ''}\n${block}\n]\n`);
    return { target: target.id, outcome: 'installed', path };
  }

  const text = readFile(path);
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END) + MARKER_END.length;
  writeFile(path, text.slice(0, start) + block + text.slice(end));
  return { target: target.id, outcome: 'updated', path };
}

export type RemoveOutcome = 'removed' | 'absent' | 'unsupported' | 'file-removed';

export interface RemoveResult {
  target: string;
  outcome: RemoveOutcome;
  path: string;
}

/** Remove our block, leaving every other byte of the file intact. */
export function remove(root: string, targetId: string): RemoveResult {
  const target = findTarget(targetId);
  const path = target ? configPathFor(root, target) : join(root, 'keybindings.json');

  if (!target) return { target: targetId, outcome: 'unsupported', path };
  /* Same guard as install: an unresolved target has no path, and building one
     anyway would point at the project root. */
  if (!target.configPath) return { target: target.id, outcome: 'absent', path: '' };

  /* Snippet targets own a whole file rather than a block inside a shared one,
     so removing them means deleting that file — and only that file. */
  if (target.snippet) {
    if (!existsSync(path)) return { target: target.id, outcome: 'absent', path };
    rmSync(path);
    return { target: target.id, outcome: 'file-removed', path };
  }

  if (!fileExists(path)) return { target: target.id, outcome: 'absent', path };
  const existing = readManagedBlock(path);
  if (existing === null) return { target: target.id, outcome: 'absent', path };

  const text = readFile(path);
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END) + MARKER_END.length;
  let next = (text.slice(0, start) + text.slice(end)).replace(/\n{3,}/g, '\n\n').trimEnd();

  /* Leaving behind `[]` or an empty array is worse than removing a file we
     created; but a file the user had before us is theirs to keep. */
  if (/^\[\s*\]$/.test(next) || next === '') {
    rmSync(path);
    return { target: target.id, outcome: 'file-removed', path };
  }

  writeFile(path, `${next}\n`);
  return { target: target.id, outcome: 'removed', path };
}

export interface TargetStatus {
  target: KeybindingTarget;
  installed: boolean;
  path: string;
  shortcut: string | null;
  detected: boolean;
  /** Present when the shortcut is bound by the user rather than by us. */
  conflicting?: Record<string, unknown>;
  /** Non-fatal problems the user should know about. */
  warnings: string[];
}

/**
 * Report, per target, whether Ctrl+I is actually live.
 *
 * `setup` calls this rather than printing fixed instructions, because the
 * instructions are only true when the binding exists — and a message that
 * claims Ctrl+I works when it does not is the single worst thing this CLI
 * could do.
 */
export function status(root: string): TargetStatus[] {
  return KEYBINDING_TARGETS.map((target) => {
    /* An unresolved target has no config path at all. `join(root, '')` is
       the root directory, and reading that throws EISDIR -- so it has to be
       skipped here rather than papered over further down. */
    if (!target.configPath) {
      return {
        target,
        installed: false,
        path: '',
        shortcut: target.shortcut,
        detected: false,
        warnings: [target.shortcutUnavailableReason ?? 'Not enough is known to write a config file.'],
      };
    }
    const path = configPathFor(root, target);
    const warnings: string[] = [];

    /* Snippet targets (vim/lua/markdown) are not managed JSON blocks — they
       are whole files we either wrote or did not. */
    const installed = target.snippet ? fileExists(path) : readManagedBlock(path) !== null;
    const detected = target.detect(root);
    const conflicting =
      target.shortcut !== null && !installed ? findUserBinding(path, target.shortcut) ?? undefined : undefined;

    if (target.shortcut === null && target.shortcutUnavailableReason) {
      warnings.push(target.shortcutUnavailableReason);
    }
    if (target.id === 'vscode' && terminalOwnsKeybindings(root)) {
      warnings.push(
        'terminal.integrated.sendKeybindingsToShell is true in .vscode/settings.json, so Ctrl+I reaches the shell instead of the keymap. Set it to false for Ctrl+I to work.',
      );
    }
    if (!detected) {
      warnings.push(`No ${target.name} configuration found in this project.`);
    }

    return { target, installed, path, shortcut: target.shortcut, detected, conflicting, warnings };
  });
}

/** `true` when at least one target currently has a working Ctrl+I. */
export function hasWorkingShortcut(statuses: TargetStatus[]): boolean {
  return statuses.some((entry) => entry.installed && entry.shortcut !== null);
}

export function dirnameOf(path: string): string {
  return dirname(path);
}
