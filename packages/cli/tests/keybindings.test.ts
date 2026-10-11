import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KEYBINDING_TARGETS, findTarget, detectTargets, bindableTargets, vscodeBinding, terminalOwnsKeybindings, neovimSnippet } from '../src/keybindings/targets.js';
import { MARKER_END, MARKER_START, install, remove, status, hasWorkingShortcut, findUserBinding, configPathFor } from '../src/keybindings/manage.js';

describe('keybinding targets', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'clirevenue-kb-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.TMUX;
  });

  it('claims Ctrl+I only for targets where it is genuinely free', () => {
    /* The honest core of this feature. vscode is the one target where Ctrl+I
       is unbound by default and interceptable. Neovim has Ctrl+I as <Tab> and
       tmux delivers Tab to the pane, so both report null and explain why
       rather than shipping a binding that would break indentation. */
    expect(findTarget('vscode')?.shortcut).toBe('ctrl+i');
    expect(findTarget('neovim')?.shortcut).toBeNull();
    expect(findTarget('neovim')?.shortcutUnavailableReason).toMatch(/Tab/);
    expect(findTarget('tmux')?.shortcut).toBeNull();

    expect(bindableTargets().map((t) => t.id)).toEqual(['vscode']);
    for (const target of KEYBINDING_TARGETS) {
      if (target.shortcut === null) {
        expect(target.shortcutUnavailableReason).toBeTruthy();
        expect(target.alternativeCommand).toBeTruthy();
      }
    }
  });

  it('detects the editor that is actually present in the project', () => {
    expect(detectTargets(root)).toEqual([]);
    mkdirSync(join(root, '.vscode'), { recursive: true });
    expect(detectTargets(root).map((t) => t.id)).toContain('vscode');
  });

  it('sends the editor command through the focused terminal', () => {
    expect(vscodeBinding()).toMatchObject({ key: 'ctrl+i', when: 'terminalFocus' });
    expect(vscodeBinding().args.text).toContain('clirevenue editor');
  });

  it('warns when the terminal already owns ctrl+i', () => {
    mkdirSync(join(root, '.vscode'), { recursive: true });
    expect(terminalOwnsKeybindings(root)).toBe(false);
    writeFileSync(
      join(root, '.vscode/settings.json'),
      JSON.stringify({ 'terminal.integrated.sendKeybindingsToShell': true }),
      'utf8',
    );
    expect(terminalOwnsKeybindings(root)).toBe(true);
  });
});

describe('keybinding install / status / remove', () => {
  let root: string;
  let keybindingsPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'clirevenue-kb-'));
    keybindingsPath = join(root, '.vscode/keybindings.json');
    mkdirSync(join(root, '.vscode'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates a keybindings file that actually invokes the editor', () => {
    const result = install(root, 'vscode');
    expect(result.outcome).toBe('installed');
    expect(existsSync(keybindingsPath)).toBe(true);

    const content = readFileSync(keybindingsPath, 'utf8');
    expect(content).toContain('"ctrl+i"');
    expect(content).toContain('clirevenue editor');
    expect(content).toContain(MARKER_START);
    expect(content).toContain(MARKER_END);
  });

  it('is idempotent — re-installing changes no bytes', () => {
    install(root, 'vscode');
    const first = readFileSync(keybindingsPath, 'utf8');
    const again = install(root, 'vscode');

    expect(again.outcome).toBe('unchanged');
    expect(readFileSync(keybindingsPath, 'utf8')).toBe(first);
  });

  it('refuses to overwrite an existing user Ctrl+I binding', () => {
    const original = `[
  { "key": "ctrl+i", "command": "myEditor.reindent" }
]
`;
    writeFileSync(keybindingsPath, original, 'utf8');

    const result = install(root, 'vscode');
    expect(result.outcome).toBe('conflict');
    expect(result.conflict?.command).toBe('myEditor.reindent');
    /* The critical guarantee: the user's file is byte-identical afterwards. */
    expect(readFileSync(keybindingsPath, 'utf8')).toBe(original);
  });

  it('takes precedence over a conflict only when explicitly forced', () => {
    /* Forced means "win", not "delete the user's entry". VS Code resolves
       duplicate keybindings last-wins, so appending after theirs takes effect
       while leaving their binding recoverable once our block is removed. */
    writeFileSync(keybindingsPath, `[\n  { "key": "ctrl+i", "command": "myEditor.reindent" }\n]\n`, 'utf8');
    const forced = install(root, 'vscode', { force: true });

    expect(forced.outcome).toBe('installed');
    const after = readFileSync(keybindingsPath, 'utf8');
    expect(after).toContain('clirevenue editor');
    expect(after.indexOf('clirevenue editor')).toBeGreaterThan(after.indexOf('myEditor.reindent'));

    /* And removing ours hands the shortcut straight back to them. */
    remove(root, 'vscode');
    expect(readFileSync(keybindingsPath, 'utf8')).toContain('myEditor.reindent');
    expect(readFileSync(keybindingsPath, 'utf8')).not.toContain('clirevenue editor');
  });

  it('preserves unrelated bindings, comments and JSONC formatting', () => {
    /* .vscode/keybindings.json is JSONC. A parse/re-serialise round trip
       would silently drop the comments and trailing commas a user wrote. */
    const original = `[
  // my own shortcut
  { "key": "ctrl+k", "command": "workbench.action.files.save" },
  { "key": "ctrl+b", "command": "toggleSidebar" },
]
`;
    writeFileSync(keybindingsPath, original, 'utf8');

    install(root, 'vscode', { force: true });
    const after = readFileSync(keybindingsPath, 'utf8');

    expect(after).toContain('// my own shortcut');
    expect(after).toContain('workbench.action.files.save');
    expect(after).toContain('toggleSidebar');
    expect(after).toContain('clirevenue editor');
  });

  it('reports installed status and a working shortcut afterwards', () => {
    expect(hasWorkingShortcut(status(root))).toBe(false);

    install(root, 'vscode');
    const statuses = status(root);

    expect(statuses.find((s) => s.target.id === 'vscode')?.installed).toBe(true);
    expect(statuses.find((s) => s.target.id === 'vscode')?.conflicting).toBeUndefined();
    expect(hasWorkingShortcut(statuses)).toBe(true);
  });

  it('surfaces a conflict in status rather than reporting success', () => {
    writeFileSync(keybindingsPath, `[\n  { "key": "ctrl+i", "command": "mine" }\n]\n`, 'utf8');
    const statuses = status(root);
    expect(statuses.find((s) => s.target.id === 'vscode')?.conflicting?.command).toBe('mine');
    expect(hasWorkingShortcut(statuses)).toBe(false);
  });

  it('reports Neovim as installed but without a usable shortcut', () => {
    install(root, 'neovim');
    const neo = status(root).find((s) => s.target.id === 'neovim');

    expect(neo?.installed).toBe(true);
    expect(neo?.shortcut).toBeNull();
    expect(neo?.warnings.join(' ')).toMatch(/Tab/);
    expect(hasWorkingShortcut(status(root))).toBe(false);
  });

  it('writes a Neovim command rather than a broken key binding', () => {
    install(root, 'neovim');
    const content = readFileSync(configPathFor(root, findTarget('neovim')!), 'utf8');

    expect(content).toContain('ClirevenueEditor');
    expect(content).toContain('clirevenue editor');
    /* It must not pretend to map C-i, which is <Tab> in Neovim. */
    expect(content).not.toMatch(/nnoremap\s+<C-i>/i);
    expect(neovimSnippet()).toContain('ClirevenueEditor');
  });

  it('rejects an unknown target instead of guessing', () => {
    const result = install(root, 'emacs');
    expect(result.outcome).toBe('unsupported');
  });

  it('removes only its own block and keeps the rest', () => {
    writeFileSync(keybindingsPath, `[\n  { "key": "ctrl+k", "command": "save" }\n]\n`, 'utf8');
    install(root, 'vscode');
    expect(readFileSync(keybindingsPath, 'utf8')).toContain('clirevenue editor');

    const removed = remove(root, 'vscode');
    expect(removed.outcome).toBe('removed');
    expect(readFileSync(keybindingsPath, 'utf8')).toContain('ctrl+k');
    expect(readFileSync(keybindingsPath, 'utf8')).not.toContain('clirevenue editor');
  });

  it('reports absent when there is nothing to remove', () => {
    expect(remove(root, 'vscode').outcome).toBe('absent');
  });

  it('deletes a file it created once the file is otherwise empty', () => {
    install(root, 'vscode');
    const removed = remove(root, 'vscode');
    expect(removed.outcome).toBe('file-removed');
    expect(existsSync(keybindingsPath)).toBe(false);
  });

  it('does not treat its own managed block as a user conflict', () => {
    install(root, 'vscode');
    expect(findUserBinding(keybindingsPath, 'ctrl+i')).toBeNull();
    expect(install(root, 'vscode').outcome).toBe('unchanged');
  });

  it('status alone never writes to disk', () => {
    const before = existsSync(keybindingsPath);
    status(root);
    expect(existsSync(keybindingsPath)).toBe(before);
  });
});

describe('agent CLIs that are not keybindable', () => {
  /*
   * The two integrations where Ctrl+I was actually reported as "did nothing".
   * Both are terminal agent CLIs with their own configuration systems, not
   * VS Code extensions. These tests exist so a future "just add the binding"
   * change fails here instead of shipping a shortcut that silently does
   * nothing.
   */
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'clirevenue-agentcli-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('does not claim Ctrl+I for any non-VS-Code application', () => {
    expect(bindableTargets().map((t) => t.id)).toEqual(['vscode']);
    for (const target of KEYBINDING_TARGETS) {
      if (target.id === 'vscode') continue;
      expect(target.shortcut).toBeNull();
    }
  });

  it('explains that OpenCode has no way to bind a shell command to a key', () => {
    const opencode = findTarget('opencode')!;
    expect(opencode.shortcut).toBeNull();
    expect(opencode.shortcutUnavailableReason).toMatch(/key|command/i);
    expect(opencode.alternativeCommand).toBe('/clirevenue-editor');
  });

  it('installs an OpenCode slash command that runs the real editor', () => {
    const result = install(root, 'opencode');
    const path = configPathFor(root, findTarget('opencode')!);
    const content = readFileSync(path, 'utf8');

    expect(existsSync(path)).toBe(true);
    /* 'unsupported' because there is no shortcut to install -- not a failure. */
    expect(result.outcome).toBe('unsupported');
    expect(result.reason).toMatch(/key|command/i);
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/description: /);
    expect(content).toContain('clirevenue editor');
    /* It must not smuggle in a keybinding it cannot honour. */
    expect(content).not.toMatch(/keybind|ctrl\+i/i);
    expect(install(root, 'opencode').outcome).toBe('unsupported');
    expect(status(root).find((s) => s.target.id === 'opencode')?.installed).toBe(true);
    /* A slash command is still not a shortcut, so setup must not claim Ctrl+I. */
    expect(hasWorkingShortcut(status(root))).toBe(false);
    expect(remove(root, 'opencode').outcome).toBe('file-removed');
    expect(existsSync(path)).toBe(false);
  });

  it('detects OpenCode from the directory it actually uses', () => {
    expect(detectTargets(root)).toEqual([]);
    mkdirSync(join(root, '.opencode/commands'), { recursive: true });
    expect(detectTargets(root).map((t) => t.id)).toContain('opencode');
  });

  it('writes nothing at all for Kilo, which exposes no mechanism to write to', () => {
    /* Kilo CLI has no keybinding config and no command registration. Creating
       a file here would leave the user believing something was wired up that
       cannot work, so the honest outcome is an explanation and no file. */
    const kilo = findTarget('kilo')!;
    expect(kilo.shortcut).toBeNull();
    expect(kilo.alternativeCommand).toBe('clirevenue editor');
    expect(kilo.shortcutUnavailableReason).toMatch(/no keybinding|no mechanism/i);

    const result = install(root, 'kilo');

    expect(result.outcome).toBe('unsupported');
    expect(result.reason).toBeTruthy();
    expect(result.hint).toContain('clirevenue editor');
    expect(existsSync(join(root, '.clirevenue'))).toBe(false);
    expect(existsSync(configPathFor(root, kilo))).toBe(false);
    expect(status(root).find((s) => s.target.id === 'kilo')?.installed).toBe(false);
    expect(remove(root, 'kilo').outcome).toBe('absent');
    expect(hasWorkingShortcut(status(root))).toBe(false);
  });
});

/**
 * A regression suite for a message that used to be a lie.
 *
 * `clirevenue keybindings install kilo` reported `Wrote <path>/.clirevenue/kilo.md`
 * on a project where no `.clirevenue` directory was ever created, because the
 * `unsupported` outcome covers both "wired up, just no hotkey" (OpenCode,
 * Neovim) and "no mechanism exists at all" (Kilo) while `result.path` is
 * populated either way. The CLI is allowed to say it did not do the thing --
 * it is not allowed to say it did.
 *
 * These assertions are on the *file system*, not on stdout, because the real
 * fix is that the path only exists when something was written. The stdout text
 * is asserted through the built binary in the journey check.
 */
describe('install only claims what it actually wrote', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'clirevenue-wrote-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports a path that exists for a target it really wired up', () => {
    const result = install(root, 'opencode');
    /* The outcome is still `unsupported` -- there is no hotkey to install --
       but this one DID write its slash command. */
    expect(result.outcome).toBe('unsupported');
    expect(existsSync(result.path)).toBe(true);
  });

  it('reports a path that does NOT exist for a target it declined to wire up', () => {
    const result = install(root, 'kilo');
    expect(result.outcome).toBe('unsupported');
    /* This is the assertion that would have caught the lie: the caller must be
       able to test `existsSync(result.path)` and get an honest answer. */
    expect(existsSync(result.path)).toBe(false);
    expect(existsSync(join(root, '.clirevenue'))).toBe(false);
  });
});
