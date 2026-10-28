/**
 * Setup makes a placement that exists.
 *
 * The promise this suite pins is the whole point of the redesign: after
 * `clirevenue setup` reports success, the project is pointing at a placement
 * the backend actually has, and running setup again changes nothing.
 *
 * Both halves used to be false. Setup wrote a placement key into
 * `clirevenue.config.json` that nothing had ever created server-side, so the
 * SDK's delivery request 204'd forever while setup printed "setup complete";
 * and a second run added a *second* integration for the same CLI, with a
 * second placement key and a second ad, because the id and the key were
 * derived from a count that grew on every pass.
 *
 * The seams are the ones setup already had — `install`, `verify` and now
 * `createPlacement` — so the whole flow runs offline.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { setup, SetupError, type SetupOptions } from '../src/commands/setup.js';
import { planPlacements, nextPlacementKey } from '../src/verify/placementPlan.js';
import { PlacementCreateError, type CreatedPlacement } from '../src/verify/placement.js';
import type { InstallResult } from '../src/install/sdk.js';
import type { VerifiedKey } from '../src/verify/key.js';

const KEY = 'pk_test_0123456789abcdefghijABCDEFGHIJ012345';

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clirevenue-setup-placement-'));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function viteProject(): string {
  const root = scratch();
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'demo-app',
      version: '1.0.0',
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: { vite: '^8.0.0' },
    }),
  );
  writeFileSync(join(root, 'vite.config.js'), 'export default {};\n');
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>\n');
  writeFileSync(join(root, '.env.local'), `VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
  return root;
}

function recorder(): { lines: string[]; text: () => string; write: (m: string) => void } {
  const lines: string[] = [];
  return { lines, text: () => lines.join(''), write: (m: string) => void lines.push(m) };
}

const fakeInstall = async (): Promise<InstallResult> => ({
  packageManager: 'npm',
  command: 'npm install @clirevenue/sdk@2.0.0',
  alreadyInstalled: false,
});

/**
 * A fake backend.
 *
 * `placements` is the server's own state, and it is the only thing that
 * decides whether a create is a create or a no-op — exactly as the real
 * endpoint behaves, because the real endpoint reads the row back on a unique
 * violation and answers `created: false`.
 */
function fakeBackend(initial: Array<{ key: string; name: string; enabled?: boolean }> = []) {
  const placements = new Map(
    initial.map((placement) => [
      placement.key,
      {
        id: `p_${placement.key}`,
        key: placement.key,
        name: placement.name,
        enabled: placement.enabled !== false,
        allowedAudienceId: null,
      },
    ]),
  );
  const calls: Array<{ placementKey: string; name: string | null }> = [];

  const create = async (_rawKey: string, options: { placementKey?: string; name?: string | null } = {}) => {
    const placementKey = options.placementKey ?? 'home';
    const name = options.name ?? null;
    calls.push({ placementKey, name });
    const existing = placements.get(placementKey);
    if (existing) {
      return { ...existing, created: false, publisherId: 'pub_123' } as CreatedPlacement;
    }
    const row = {
      id: `p_${placementKey}`,
      key: placementKey,
      name,
      enabled: true,
      allowedAudienceId: null,
    };
    placements.set(placementKey, row);
    return { ...row, created: true, publisherId: 'pub_123' } as CreatedPlacement;
  };

  const list = (): VerifiedKey['placements'] =>
    [...placements.values()].map((placement) => ({
      id: placement.id,
      key: placement.key,
      name: placement.name ?? '',
      enabled: placement.enabled,
      allowedAudienceId: null,
    }));

  return { placements, calls, create, list };
}

function options(
  cwd: string,
  write: (m: string) => void,
  backend: ReturnType<typeof fakeBackend>,
  extra: Partial<SetupOptions> = {},
): SetupOptions {
  return {
    cwd,
    write,
    install: fakeInstall,
    createPlacement: backend.create,
    verify: async () => ({
      publisherId: 'pub_123',
      fullName: 'Ada Lovelace',
      publisherName: 'Untitled publisher',
      adsSeen: 0,
      earningsMilliCents: 0,
      slotCount: 0,
      placements: backend.list(),
    }),
    chooseIntegrations: async () => ['codex'],
    ...extra,
  };
}

function readConfig(root: string) {
  return JSON.parse(readFileSync(join(root, 'clirevenue.config.json'), 'utf8'));
}

describe('setup: the placement it points at exists', () => {
  it('creates the placement on the account before writing it locally', async () => {
    const root = viteProject();
    const backend = fakeBackend();
    const out = recorder();

    const outcome = await setup(options(root, out.write, backend));

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].placementKey).toBe('codex-1');
    /* The local configuration names the placement that was just created. */
    expect(readConfig(root).integrations.codex.placementKey).toBe('codex-1');
    expect(outcome.placements.map((entry) => entry.action)).toEqual(['created']);
  });

  it('adopts a placement the publisher already has instead of minting another', async () => {
    const root = viteProject();
    const backend = fakeBackend([{ key: 'home-top', name: 'Home top' }]);
    const out = recorder();

    await setup(options(root, out.write, backend));

    /* Nothing was created: the publisher's own placement is used, so the ad
       they already set up in the dashboard is the ad that renders. */
    expect(backend.calls).toHaveLength(0);
    expect(readConfig(root).integrations.codex.placementKey).toBe('home-top');
  });

  it('prefers an enabled placement when the publisher has several', async () => {
    const root = viteProject();
    const backend = fakeBackend([
      { key: 'old-one', name: 'Old', enabled: false },
      { key: 'live-one', name: 'Live' },
    ]);
    const out = recorder();

    await setup(options(root, out.write, backend));

    expect(readConfig(root).integrations.codex.placementKey).toBe('live-one');
  });

  it('fails loudly, and writes nothing, when the placement cannot be created', async () => {
    const root = viteProject();
    const backend = fakeBackend();
    const out = recorder();

    await expect(
      setup(
        options(root, out.write, backend, {
          createPlacement: async () => {
            throw new PlacementCreateError('The CLIRevenue API is rate limiting placement creation.', 'rate_limited');
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SetupError);

    /* The failure is reported, not swallowed into a "setup complete". */
    expect(out.text()).not.toContain('CLIRevenue setup complete.');
  });

  it('verifies the placements after provisioning them', async () => {
    const root = viteProject();
    const backend = fakeBackend();
    const out = recorder();

    await setup(options(root, out.write, backend));

    expect(out.text()).toContain('Verified 1 placement on your account');
  });

  it('fails when a placement the project points at is not on the account', async () => {
    const root = viteProject();
    const backend = fakeBackend();
    const out = recorder();

    /* The backend forgets the placement between the create and the check —
       exactly the race a retry or a deleted row would produce. */
    let verified = 0;
    await expect(
      setup(
        options(root, out.write, backend, {
          verify: async () => {
            verified += 1;
            return {
              publisherId: 'pub_123',
              fullName: 'Ada Lovelace',
              publisherName: 'Untitled publisher',
              adsSeen: 0,
              earningsMilliCents: 0,
              slotCount: 0,
              placements: verified === 1 ? backend.list() : [],
            };
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SetupError);

    expect(out.text()).not.toContain('CLIRevenue setup complete.');
  });

  it('warns, without failing, when the placement exists but is switched off', async () => {
    const root = viteProject();
    const backend = fakeBackend([{ key: 'paused', name: 'Paused', enabled: false }]);
    const out = recorder();

    const outcome = await setup(options(root, out.write, backend));

    expect(out.text()).toContain('is switched off on your account');
    expect(outcome.placements[0].enabled).toBe(false);
  });
});

describe('setup: running it twice changes nothing', () => {
  it('does not add a second integration, a second slot or a second placement', async () => {
    const root = viteProject();
    const backend = fakeBackend();
    const out = recorder();

    await setup(options(root, out.write, backend));
    const first = readFileSync(join(root, 'clirevenue.config.json'), 'utf8');

    await setup(options(root, out.write, backend));
    const second = readFileSync(join(root, 'clirevenue.config.json'), 'utf8');

    expect(second).toBe(first);
    expect(Object.keys(readConfig(root).integrations)).toEqual(['codex']);
    expect(Object.keys(readConfig(root).integrations.codex.slots)).toEqual(['slot-1']);
    /* The one placement that was created the first time is still the one. */
    expect(backend.calls).toHaveLength(1);
  });

  it('says so, rather than claiming to have added something', async () => {
    const root = viteProject();
    const backend = fakeBackend();
    const out = recorder();

    await setup(options(root, out.write, backend));
    out.lines.length = 0;
    await setup(options(root, out.write, backend));

    expect(out.text()).toContain('was already configured');
  });
});

describe('setup: a project that is already half-configured', () => {
  it('creates the placement the project already names when the account does not have it', async () => {
    /* The state a project is left in when the first setup created the
       placement locally but the account never got it — a half-finished run,
       or a placement deleted from the dashboard. The project names a
       placement that does not exist, so setup has to create *that* one and
       not mint a second key beside it. */
    const root = viteProject();
    writeFileSync(
      join(root, 'clirevenue.config.json'),
      JSON.stringify({
        version: 2,
        integrations: {
          codex: {
            id: 'codex',
            target: 'codex',
            label: 'OpenAI Codex CLI',
            placementKey: 'codex-1',
            slots: {
              'slot-1': {
                id: 'slot-1',
                label: 'Ad 1',
                layout: {
                  size: { width: 320, height: 100 },
                  position: { anchor: 'center', offsetX: 0, offsetY: 0 },
                },
                enabled: true,
              },
            },
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    );
    const backend = fakeBackend();
    const out = recorder();

    const outcome = await setup(options(root, out.write, backend));

    /* The key the project already names is the one that is created — and it
       is the only one. */
    expect(backend.calls.map((call) => call.placementKey)).toEqual(['codex-1']);
    expect([...backend.placements.keys()]).toEqual(['codex-1']);
    expect(readConfig(root).integrations.codex.placementKey).toBe('codex-1');
    expect(outcome.placements.map((entry) => entry.action)).toEqual(['created']);
  });

  it('does not mint a second placement when an existing integration occupies the id', async () => {
    /* The configuration is keyed by integration id, and `addIntegration`
       leaves an existing entry alone rather than overwriting it. A legacy
       configuration (v1 `placements` migrated to v2) produces exactly this
       shape: the id is the old placement key and the target is `legacy`.

       Before this was handled, the plan proposed a fresh placement for the
       chosen target, the file kept pointing at the old one, and setup then
       failed its own verification — after creating a placement nobody had
       asked for. */
    const root = viteProject();
    writeFileSync(
      join(root, 'clirevenue.config.json'),
      JSON.stringify({
        version: 2,
        integrations: {
          codex: {
            id: 'codex',
            target: 'legacy',
            label: 'Codex',
            placementKey: 'codex',
            slots: {
              'slot-1': {
                id: 'slot-1',
                label: 'Ad 1',
                layout: {
                  size: { width: 320, height: 100 },
                  position: { anchor: 'center', offsetX: 0, offsetY: 0 },
                },
                enabled: true,
              },
            },
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    );
    const backend = fakeBackend();
    const out = recorder();

    const outcome = await setup(options(root, out.write, backend));

    /* One placement: the one the file names. No orphan beside it. */
    expect(backend.calls.map((call) => call.placementKey)).toEqual(['codex']);
    expect([...backend.placements.keys()]).toEqual(['codex']);
    expect(readConfig(root).integrations.codex.placementKey).toBe('codex');
    expect(outcome.placements.map((entry) => entry.placementKey)).toEqual(['codex']);
  });

  it('does not claim that nothing changed when the project file was written', async () => {
    /* The project file *is* written before the verification runs, so the
       failure message must not say "nothing was changed" — it would be a
       lie about the state the user is left in. */
    const root = viteProject();
    const backend = fakeBackend();
    const out = recorder();

    let caught: unknown = null;
    try {
      await setup(
        options(root, out.write, backend, {
          verify: async () => ({
            publisherId: 'pub_123',
            fullName: 'Ada Lovelace',
            publisherName: 'Untitled publisher',
            adsSeen: 0,
            earningsMilliCents: 0,
            slotCount: 0,
            placements: [],
          }),
        }),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SetupError);
    const hint = (caught as SetupError).hint ?? '';
    expect(hint).not.toContain('Nothing was changed');
    expect(hint).toContain('Create it in your dashboard');
  });
});

describe('the placement plan', () => {
  const server = [
    { key: 'home-top', name: 'Home top', enabled: true },
    { key: 'sidebar', name: 'Sidebar', enabled: false },
  ];

  it('keeps the project\'s own integration when it has one', () => {
    const plans = planPlacements({
      chosen: [{ id: 'codex', name: 'OpenAI Codex CLI' }],
      existing: [
        {
          id: 'codex',
          target: 'codex',
          label: 'OpenAI Codex CLI',
          placementKey: 'codex-1',
          slots: {},
        },
      ],
      serverPlacements: server,
      claimedKeys: ['codex-1'],
    });

    expect(plans[0].action).toBe('reuse-local');
    expect(plans[0].placementKey).toBe('codex-1');
  });

  it('adopts a free placement from the account', () => {
    const plans = planPlacements({
      chosen: [{ id: 'codex', name: 'OpenAI Codex CLI' }],
      existing: [],
      serverPlacements: server,
      claimedKeys: [],
    });

    expect(plans[0].action).toBe('reuse-server');
    expect(plans[0].placementKey).toBe('home-top');
  });

  it('mints a key that nothing else is using when there is nothing to adopt', () => {
    const plans = planPlacements({
      chosen: [{ id: 'codex', name: 'OpenAI Codex CLI' }],
      existing: [],
      serverPlacements: [],
      claimedKeys: [],
    });

    expect(plans[0].action).toBe('create');
    expect(plans[0].placementKey).toBe('codex-1');
  });

  it('gives two integrations two different placements', () => {
    const plans = planPlacements({
      chosen: [
        { id: 'codex', name: 'OpenAI Codex CLI' },
        { id: 'claude-code', name: 'Claude Code' },
      ],
      existing: [],
      serverPlacements: [],
      claimedKeys: [],
    });

    const keys = plans.map((plan) => plan.placementKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('mints a key the backend will accept', () => {
    /* The backend's own rule: lowercase letters, digits, hyphens and
       underscores, starting with a letter or a digit. */
    expect(nextPlacementKey('codex', [])).toMatch(/^[a-z0-9][a-z0-9_-]{1,63}$/);
    expect(nextPlacementKey('Codex CLI', [])).toMatch(/^[a-z0-9][a-z0-9_-]{1,63}$/);
  });

  it('skips a key that is already taken', () => {
    expect(nextPlacementKey('codex', ['codex-1'])).toBe('codex-2');
    expect(nextPlacementKey('codex', ['codex-1', 'codex-2'])).toBe('codex-3');
  });
});
