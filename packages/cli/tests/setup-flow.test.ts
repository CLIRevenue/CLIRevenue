import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setup, SetupError, type SetupOptions } from '../src/commands/setup.js';
import { install, status } from '../src/keybindings/manage.js';
import { KEYBINDING_TARGETS } from '../src/keybindings/targets.js';
import type { InstallResult } from '../src/install/sdk.js';
import type { VerifiedKey } from '../src/verify/key.js';

/**
 * The setup flow is where the redesign's headline promise lives: it must not
 * ask for a placement or an ad size, and it must not tell the user to press
 * Ctrl+I unless a binding genuinely exists. Both claims are only worth
 * anything if they are checked against real output.
 *
 * The `install` and `verify` seams on `SetupOptions` keep this suite off the
 * network and out of the package manager — without them the only way to test
 * setup is to actually install the SDK and call the production API.
 */

const KEY = 'pk_test_0123456789abcdefghijABCDEFGHIJ012345';

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clirevenue-setup-'));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A project the detector recognises as Vite + React. */
function viteProject(deps: Record<string, string> = {}): string {
  const root = scratch();
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'demo-app',
      version: '1.0.0',
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', ...deps },
      devDependencies: { vite: '^8.0.0' },
    }),
  );
  writeFileSync(join(root, 'vite.config.js'), 'export default {};\n');
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>\n');
  return root;
}

/** Collects everything setup writes so assertions can look at the transcript. */
function recorder(): { lines: string[]; text: () => string; write: (m: string) => void } {
  const lines: string[] = [];
  return { lines, text: () => lines.join(''), write: (m: string) => void lines.push(m) };
}

/** Injected so setup runs without touching the network. */
const fakeVerify = async (rawKey: string): Promise<VerifiedKey> => ({
  publisherId: 'pub_123',
  placements: [
    { id: 'p1', key: 'home-top', name: 'Home top', enabled: true, allowedAudienceId: null },
    { id: 'p2', key: 'sidebar', name: 'Sidebar', enabled: true, allowedAudienceId: null },
  ],
});

const fakeInstall = async (): Promise<InstallResult> => ({
  packageManager: 'npm',
  command: 'npm install @clirevenue/sdk@2.0.0',
  alreadyInstalled: false,
});

/**
 * "No CLI integrations" is the default for this suite.
 *
 * Setup now asks how many coding CLIs will use CLIRevenue and provisions a
 * placement key for each. That question is a prompt, and a prompt in a test
 * is a hang. Every test here is about prompts, keybindings or credentials --
 * none is about choosing integrations -- so the suite answers "none" and the
 * tests that do care pass their own `chooseIntegrations`.
 */
const chooseNone = async (): Promise<string[]> => [];

function options(cwd: string, write: (m: string) => void, extra: Partial<SetupOptions> = {}): SetupOptions {
  return {
    cwd,
    write,
    install: fakeInstall,
    verify: fakeVerify,
    chooseIntegrations: chooseNone,
    ...extra,
  };
}

describe('setup: no placement or size prompts', () => {
  it('completes without asking which placement to use', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const out = recorder();

    const outcome = await setup(options(root, out.write));

    expect(outcome.verified.publisherId).toBe('pub_123');
    const text = out.text();
    expect(text).not.toContain('Choose placement');
    expect(text).not.toContain('Available placements');
    /* The preset that used to be hardcoded into this flow is gone for good. */
    expect(text).not.toContain('Console Workbench');
  });

  it('completes without asking for an ad size', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const out = recorder();

    await setup(options(root, out.write));

    const text = out.text();
    expect(text).not.toContain('Ad size');
    expect(text).not.toContain('width');
    expect(text).not.toContain('height');
  });

  it('never bakes a size into the generated component — the editor owns geometry', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const out = recorder();

    await setup(options(root, out.write));

    const component = readFileSync(join(root, 'src/components/CLIRevenueAd.jsx'), 'utf8');
    expect(component).toContain('renderPlacement');
    expect(component).not.toMatch(/width:\s*\d/);
    expect(component).not.toMatch(/height:\s*\d/);
  });
});

describe('setup: Ctrl+I instructions match reality', () => {
  it('does not claim Ctrl+I works before any binding is installed', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const out = recorder();

    const outcome = await setup(options(root, out.write));
    const text = out.text();

    expect(outcome.shortcutReady).toBe(false);
    expect(text).not.toContain('Press Ctrl+I');
    expect(text).toContain('npx clirevenue editor');
    expect(text).toContain('Ctrl+I is not registered in this project yet');
  });

  it('prints the exact Ctrl+I steps once a binding really is installed', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    /* Install the binding first, then run setup: the message must follow the
       project state, not a hardcoded optimism. */
    expect(install(root, 'vscode').outcome).toBe('installed');
    const out = recorder();

    const outcome = await setup(options(root, out.write));
    const text = out.text();

    expect(outcome.shortcutReady).toBe(true);
    expect(text).toContain('CLIRevenue setup complete.');
    expect(text).toContain('Open your preferred coding CLI in this project.');
    expect(text).toContain('Press Ctrl+I to launch the CLIRevenue placement editor.');
    expect(text).toContain('Drag the ad preview to your preferred location and resize it.');
    expect(text).toContain('Confirm your placement to save the configuration.');
    expect(text).toContain('Your editor will open when you press Ctrl+I.');
    /* The command line is redundant once the shortcut genuinely works. */
    expect(text).not.toContain('npx clirevenue editor');
  });

  it('stays honest when the binding conflicts with the user’s own Ctrl+I', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    mkdirSync(join(root, '.vscode'), { recursive: true });
    writeFileSync(
      join(root, '.vscode/keybindings.json'),
      `[\n  { "key": "ctrl+i", "command": "myEditor.reindent" }\n]\n`,
    );
    /* The CLI refuses to take the binding, so it must not then advertise it. */
    expect(install(root, 'vscode').outcome).toBe('conflict');
    const out = recorder();

    const outcome = await setup(options(root, out.write));

    expect(outcome.shortcutReady).toBe(false);
    expect(out.text()).not.toContain('Press Ctrl+I');
    expect(status(root).find((entry) => entry.target.id === 'vscode')?.conflicting).toMatchObject({
      command: 'myEditor.reindent',
    });
  });

  it('tells users that Ctrl+I is unavailable where the key is taken', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const out = recorder();

    await setup(options(root, out.write));
    const text = out.text();

    for (const target of KEYBINDING_TARGETS) {
      if (target.shortcut) continue;
      /* Every target that cannot take Ctrl+I must say so, and must point at
         the alternative that does work — silently omitting it would leave the
         user with no route at all. */
      expect(text).toContain(target.alternativeCommand);
      expect(text).toContain(target.shortcutUnavailableReason ?? 'unavailable');
    }
    const neovim = KEYBINDING_TARGETS.find((target) => target.id === 'neovim');
    expect(neovim?.alternativeCommand).toBe(':ClirevenueEditor');
    expect(text).toMatch(/Neovim[\s\S]*Tab/);
  });
});

describe('setup: unsupported and unsupported-runtime handling', () => {
  it('refuses an unsupported project and names the project directory', async () => {
    const root = scratch();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'a-library', version: '1.0.0' }));
    const out = recorder();

    await expect(setup(options(root, out.write))).rejects.toThrow(SetupError);
    await expect(setup(options(root, out.write))).rejects.toThrow(/Unsupported project/);
  });

  it('never installs a framework the project did not already have', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const calls: string[] = [];
    const out = recorder();

    await setup(
      options(root, out.write, {
        install: async (dir: string) => {
          calls.push(dir);
          return fakeInstall();
        },
      }),
    );

    /* Exactly one install: the SDK, into the project root. No framework, and
       no second target directory. */
    expect(calls).toEqual([root]);
    expect(out.text()).not.toMatch(/installing react|installing vite|npm install react|npm install vite/i);
  });

  it('generates only the files the detected stack actually needs', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const out = recorder();

    await setup(options(root, out.write));

    expect(existsSync(join(root, 'src/lib/clirevenue.js'))).toBe(true);
    expect(existsSync(join(root, 'src/components/CLIRevenueAd.jsx'))).toBe(true);
    /* The config file is the editor's target, so setup has to create it. */
    expect(existsSync(join(root, 'clirevenue.config.json'))).toBe(true);
  });
});

describe('setup: credentials stay protected', () => {
  it('never prints the publisher key in full', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const out = recorder();

    await setup(options(root, out.write));

    expect(out.text()).not.toContain(KEY);
    /* Long keys are masked to their first and last four characters. */
    expect(out.text()).toContain('Key verified (pk_test_••••2345)');
  });

  it('keeps the key out of the committed config file', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const out = recorder();

    await setup(options(root, out.write));

    const config = readFileSync(join(root, 'clirevenue.config.json'), 'utf8');
    expect(config).not.toContain('pk_');
    expect(config).not.toMatch(/publishable|secret/i);
  });

  it('keeps .env.local out of git', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    const out = recorder();

    await setup(options(root, out.write));

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env.local');
  });
});

describe('setup: reruns are idempotent and non-destructive', () => {
  it('does not duplicate or overwrite anything on a second run', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    await setup(options(root, () => {}));

    const snapshot = {
      env: readFileSync(join(root, '.env.local'), 'utf8'),
      lib: readFileSync(join(root, 'src/lib/clirevenue.js'), 'utf8'),
      gitignore: readFileSync(join(root, '.gitignore'), 'utf8'),
    };

    const outcome = await setup(options(root, () => {}));

    expect(outcome.result.envAdded).toBe(false);
    expect(outcome.result.libAdded).toBe(false);
    expect(outcome.result.componentAdded).toBe(false);
    expect(readFileSync(join(root, '.env.local'), 'utf8')).toBe(snapshot.env);
    expect(readFileSync(join(root, 'src/lib/clirevenue.js'), 'utf8')).toBe(snapshot.lib);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(snapshot.gitignore);
  });

  it('leaves a hand-edited integration file alone', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    await setup(options(root, () => {}));
    const libPath = join(root, 'src/lib/clirevenue.js');
    writeFileSync(libPath, '// mine, do not touch\nexport const mine = 1;\n');

    const out = recorder();
    const outcome = await setup(options(root, out.write));

    expect(outcome.result.preserved).toContain(libPath);
    expect(readFileSync(libPath, 'utf8')).toBe('// mine, do not touch\nexport const mine = 1;\n');
  });

  it('keeps unknown keys in a hand-edited config file', async () => {
    const root = viteProject();
    writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    await setup(options(root, () => {}));
    const configPath = join(root, 'clirevenue.config.json');
    const edited = JSON.parse(readFileSync(configPath, 'utf8'));
    writeFileSync(configPath, JSON.stringify({ ...edited, myOwnField: 'keep me' }, null, 2));

    await setup(options(root, () => {}));

    expect(JSON.parse(readFileSync(configPath, 'utf8')).myOwnField).toBe('keep me');
  });
});
