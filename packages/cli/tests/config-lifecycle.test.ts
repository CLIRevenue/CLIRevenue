/**
 * Configuration migration and lifecycle.
 *
 * `clirevenue.config.json` is the file the whole product rests on: it holds
 * which coding CLI each ad serves, which backend placement key that CLI owns,
 * and the geometry the editor dragged. Two things could quietly corrupt it --
 * a migration that loses a placement, and a lifecycle operation that reaches
 * across and edits something it was not asked to edit. Both are silent, and
 * both look like "the ad moved itself".
 *
 * These tests drive the public config API the way the commands drive it, and
 * assert against the bytes on disk rather than against return values, because
 * the file is what the next process reads.
 *
 * Every test builds its own temp project. Nothing here reads or writes a real
 * project, and no credential appears in any fixture: the config file is
 * documented to never hold one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONFIG_FILE,
  CONFIG_VERSION,
  LEGACY_TARGET,
  ConfigError,
  readConfig,
  writeConfig,
  addIntegration,
  getIntegration,
  listIntegrations,
  removeIntegration,
  addSlot,
  getSlot,
  listSlots,
  removeSlot,
  saveSlot,
  loadLayout,
  nextSlotId,
  ensureConfigFile,
} from '../src/project/config.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clirevenue-config-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const configPath = () => join(root, CONFIG_FILE);

const onDisk = () => JSON.parse(readFileSync(configPath(), 'utf8'));

function writeRaw(contents: string): void {
  writeFileSync(configPath(), contents);
}

function layout(width: number, height: number, anchor = 'center') {
  return { size: { width, height }, position: { anchor, offsetX: 0, offsetY: 0 } };
}

/**
 * A v1 config exactly as CLI 1.1.0 wrote it: a flat map keyed by placement
 * key, each entry carrying its own geometry.
 */
const LEGACY_V1 = JSON.stringify(
  {
    version: 1,
    placements: {
      'home-top': {
        placementKey: 'home-top',
        name: 'Home top',
        layout: layout(728, 90, 'top-center'),
        container: '#ad-slot',
        updatedAt: '2026-01-02T03:04:05.000Z',
      },
      sidebar: {
        placementKey: 'sidebar',
        name: 'Sidebar',
        layout: layout(300, 250, 'bottom-right'),
      },
    },
    myOwnField: 'keep me',
  },
  null,
  2,
);

describe('migrating a legacy v1 configuration', () => {
  it('turns every placement into an integration that keeps its key and geometry', () => {
    writeRaw(LEGACY_V1);
    const config = readConfig(root);

    expect(config.version).toBe(CONFIG_VERSION);

    const ids = Object.keys(config.integrations);
    expect(ids.sort()).toEqual(['home-top', 'sidebar']);

    /* The identifier survives: the backend placement key is what the SDK
       fetches a creative for, so losing it would silently stop the ad. */
    expect(config.integrations['home-top'].placementKey).toBe('home-top');
    expect(config.integrations.sidebar.placementKey).toBe('sidebar');

    /* So does the geometry, on a first slot. */
    const migrated = config.integrations['home-top'].slots['slot-1'];
    expect(migrated.layout).toEqual(layout(728, 90, 'top-center'));
    expect(migrated.container).toBe('#ad-slot');
    expect(migrated.enabled).toBe(true);
    expect(migrated.updatedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(config.integrations.sidebar.slots['slot-1'].layout).toEqual(
      layout(300, 250, 'bottom-right'),
    );
  });

  it('labels a migrated integration so the user can tell what it was', () => {
    writeRaw(LEGACY_V1);
    const config = readConfig(root);
    /* `target: 'legacy'` is the honest answer: CLIRevenue did not know which
       coding CLI this placement belonged to, and guessing would put a keybind
       in an editor the user never chose. */
    expect(config.integrations['home-top'].target).toBe(LEGACY_TARGET);
    expect(config.integrations['home-top'].label).toBe('Home top');
    expect(config.integrations.sidebar.label).toBe('Sidebar');
  });

  it('falls back to the map key when the old entry has no name', () => {
    writeRaw(JSON.stringify({ version: 1, placements: { 'no-name': { layout: layout(300, 250) } } }));
    const config = readConfig(root);
    expect(config.integrations['no-name'].label).toBe('no-name');
    /* And when the entry has no placementKey, the map key IS the key. */
    expect(config.integrations['no-name'].placementKey).toBe('no-name');
  });

  it('preserves fields the user added that CLIRevenue knows nothing about', () => {
    writeRaw(LEGACY_V1);
    expect(readConfig(root).myOwnField).toBe('keep me');

    /* And they survive the rewrite that follows a write. */
    addIntegration(root, { id: 'codex', target: 'codex', label: 'Codex', placementKey: 'codex-1' });
    expect(onDisk().myOwnField).toBe('keep me');
  });

  it('does not rewrite the file just because it was read', () => {
    const before = LEGACY_V1;
    writeRaw(before);

    readConfig(root);
    readConfig(root);

    /* Reading is not consent to change the user's file. The migration is
       applied in memory and only lands on disk when something else is written,
       so a user who downgrades after merely running `editor` still finds
       their v1 file exactly as they left it. */
    expect(readFileSync(configPath(), 'utf8')).toBe(before);
  });

  it('rewrites the legacy file in v2 form only after a subsequent write', () => {
    writeRaw(LEGACY_V1);
    readConfig(root);
    expect(JSON.parse(readFileSync(configPath(), 'utf8')).version).toBe(1);

    addSlot(root, 'home-top', { label: 'Second slot', layout: layout(300, 250) });

    const after = onDisk();
    expect(after.version).toBe(CONFIG_VERSION);
    expect(after.placements).toBeUndefined();
    expect(Object.keys(after.integrations).sort()).toEqual(['home-top', 'sidebar']);
    expect(Object.keys(after.integrations['home-top'].slots).sort()).toEqual([
      'slot-1',
      'slot-2',
    ]);
  });

  it('is stable: migrating an already-migrated file changes nothing', () => {
    writeRaw(LEGACY_V1);
    addSlot(root, 'home-top', { label: 'Second slot', layout: layout(300, 250) });
    const once = readFileSync(configPath(), 'utf8');

    readConfig(root);
    addSlot(root, 'sidebar', { label: 'Also a slot', layout: layout(970, 120) });
    const twice = readFileSync(configPath(), 'utf8');

    /* The original migration output survived verbatim inside the second write,
       so a half-migrated file cannot drift into a third shape. */
    expect(JSON.parse(twice).integrations['home-top']).toEqual(
      JSON.parse(once).integrations['home-top'],
    );
  });

  it('leaves an unreadable legacy file completely alone', () => {
    const broken = '{ "version": 1, "placements": { oops';
    writeRaw(broken);

    expect(() => readConfig(root)).toThrow(ConfigError);
    expect(readFileSync(configPath(), 'utf8')).toBe(broken);
  });
});

describe('one placement key per integration', () => {
  beforeEach(() => {
    addIntegration(root, { id: 'vscode', target: 'vscode', label: 'VS Code', placementKey: 'vscode-1' });
    addIntegration(root, { id: 'codex', target: 'codex', label: 'Codex', placementKey: 'codex-1' });
  });

  it('keeps two integrations on distinct keys', () => {
    expect(listIntegrations(root).map((i) => i.placementKey).sort()).toEqual([
      'codex-1',
      'vscode-1',
    ]);
  });

  it('refuses to let a second integration claim a key that is already taken', () => {
    expect(() =>
      addIntegration(root, { id: 'claude', target: 'claude-code', label: 'Claude', placementKey: 'vscode-1' }),
    ).toThrow(ConfigError);

    /* Nothing was written, and the message names both parties so the user can
       act on it rather than guess which of their integrations is wrong. */
    expect(listIntegrations(root).map((i) => i.id).sort()).toEqual(['codex', 'vscode']);
    try {
      addIntegration(root, { id: 'claude', target: 'claude-code', label: 'Claude', placementKey: 'vscode-1' });
      expect.unreachable('addIntegration should have thrown');
    } catch (err) {
      expect((err as ConfigError).code).toBe('duplicate-placement-key');
      expect((err as Error).message).toContain('vscode-1');
      expect((err as Error).message).toContain('vscode');
    }
  });

  it('rejects a duplicate that arrives by hand-editing the file', () => {
    /* Checked on read as well as on write, so a hand-edited violation fails
       where it is read instead of rendering the same creative twice. */
    writeConfig(root, readConfig(root));
    const raw = onDisk();
    raw.integrations.codex.placementKey = 'vscode-1';
    writeRaw(JSON.stringify(raw, null, 2));

    expect(() => readConfig(root)).toThrow(/both use placement key "vscode-1"/i);
  });

  it('lets the same target be integrated twice under different keys', () => {
    addIntegration(root, { id: 'codex-2', target: 'codex', label: 'Codex (2nd)', placementKey: 'codex-2' });
    const codex = listIntegrations(root).filter((i) => i.target === 'codex');
    expect(codex.map((i) => i.placementKey).sort()).toEqual(['codex-1', 'codex-2']);
  });

  it('treats re-adding the same id as a no-op rather than a second copy', () => {
    const result = addIntegration(root, { id: 'vscode', target: 'vscode', label: 'Renamed', placementKey: 'vscode-1' });
    expect(result.created).toBe(false);
    expect(listIntegrations(root)).toHaveLength(2);
  });
});

describe('many slots, one placement key', () => {
  beforeEach(() => {
    addIntegration(root, { id: 'vscode', target: 'vscode', label: 'VS Code', placementKey: 'vscode-1' });
  });

  it('adds three slots that all share the single integration key', () => {
    addSlot(root, 'vscode', { label: 'Leaderboard', layout: layout(728, 90, 'top-center') });
    addSlot(root, 'vscode', { label: 'Sidebar', layout: layout(300, 250, 'bottom-right') });
    addSlot(root, 'vscode', { label: 'Footer', layout: layout(970, 120, 'bottom-center') });

    const integration = getIntegration(readConfig(root), 'vscode')!;
    expect(Object.keys(integration.slots)).toEqual(['slot-1', 'slot-2', 'slot-3']);
    /* One key, three slots -- that is the whole point. The backend never sees
       a second placement, so nothing was provisioned twice. */
    expect(listIntegrations(root)).toHaveLength(1);
    expect(getSlot(root, 'vscode', 'slot-2')!.layout).toEqual(layout(300, 250, 'bottom-right'));
  });

  it('gives every slot its own geometry', () => {
    addSlot(root, 'vscode', { label: 'One', layout: layout(728, 90, 'top-center') });
    addSlot(root, 'vscode', { label: 'Two', layout: layout(300, 250, 'bottom-right') });

    expect(loadLayout(root, 'vscode', 'slot-1')).toEqual(layout(728, 90, 'top-center'));
    expect(loadLayout(root, 'vscode', 'slot-2')).toEqual(layout(300, 250, 'bottom-right'));
  });

  it('never reuses a slot id, even after the last one is removed', () => {
    addSlot(root, 'vscode', { label: 'One', layout: layout(300, 250) });
    addSlot(root, 'vscode', { label: 'Two', layout: layout(300, 250) });
    removeSlot(root, 'vscode', 'slot-2');
    removeSlot(root, 'vscode', 'slot-1');

    expect(Object.keys(getIntegration(readConfig(root), 'vscode')!.slots)).toEqual([]);

    /* Reusing slot-1 would point generated code at a different ad than the
       one it was generated for. The id is the slot's identity; it is never
       recycled. */
    const fresh = addSlot(root, 'vscode', { label: 'Replacement', layout: layout(300, 250) });
    expect(fresh.slot.id).toBe('slot-3');
  });

  it('reports the next id without creating anything', () => {
    addSlot(root, 'vscode', { layout: layout(300, 250) });
    expect(nextSlotId(getIntegration(readConfig(root), 'vscode')!)).toBe('slot-2');
    expect(Object.keys(getIntegration(readConfig(root), 'vscode')!.slots)).toEqual(['slot-1']);
  });

  it('removes one slot without touching its siblings', () => {
    addSlot(root, 'vscode', { label: 'One', layout: layout(728, 90, 'top-center') });
    addSlot(root, 'vscode', { label: 'Two', layout: layout(300, 250, 'bottom-right') });
    addSlot(root, 'vscode', { label: 'Three', layout: layout(970, 120, 'bottom-center') });

    const before = onDisk().integrations.vscode.slots;
    removeSlot(root, 'vscode', 'slot-2');
    const after = onDisk().integrations.vscode.slots;

    expect(Object.keys(after)).toEqual(['slot-1', 'slot-3']);
    /* Byte-for-byte: a removal is not an edit. */
    expect(after['slot-1']).toEqual(before['slot-1']);
    expect(after['slot-3']).toEqual(before['slot-3']);
    /* And the placement key survives, because the remaining slots still need
       a creative to fetch. */
    expect(getIntegration(readConfig(root), 'vscode')!.placementKey).toBe('vscode-1');
  });

  it('disables a slot without deleting its geometry', () => {
    addSlot(root, 'vscode', { label: 'One', layout: layout(728, 90) });
    saveSlot(root, {
      integrationId: 'vscode',
      slotId: 'slot-1',
      layout: layout(728, 90),
      enabled: false,
    });

    const slot = getSlot(root, 'vscode', 'slot-1');
    expect(slot?.enabled).toBe(false);
    /* Turning it off must not throw the layout away -- turning it back on
       should restore what the user had, not reset it to a default. */
    expect(slot?.layout).toEqual(layout(728, 90));
  });

  it('reports what the SDK will actually render', () => {
    addSlot(root, 'vscode', { label: 'On', layout: layout(728, 90) });
    addSlot(root, 'vscode', { label: 'Off', layout: layout(300, 250) });
    saveSlot(root, {
      integrationId: 'vscode',
      slotId: 'slot-2',
      layout: layout(300, 250),
      enabled: false,
    });

    const renderable = listSlots(root, 'vscode');
    expect(renderable).toHaveLength(2);
    expect(renderable.filter((s) => s.enabled).map((s) => s.label)).toEqual(['On']);
  });
});

describe('isolation between integrations', () => {
  beforeEach(() => {
    addIntegration(root, { id: 'vscode', target: 'vscode', label: 'VS Code', placementKey: 'vscode-1' });
    addIntegration(root, { id: 'codex', target: 'codex', label: 'Codex', placementKey: 'codex-1' });
    addSlot(root, 'vscode', { label: 'VS slot', layout: layout(728, 90) });
    addSlot(root, 'codex', { label: 'Codex slot', layout: layout(300, 250) });
  });

  it('removes one integration without touching the other', () => {
    const codexBefore = onDisk().integrations.codex;

    removeIntegration(root, 'vscode');

    expect(listIntegrations(root).map((i) => i.id)).toEqual(['codex']);
    expect(onDisk().integrations.codex).toEqual(codexBefore);
  });

  it('frees the removed key so it can be reused deliberately', () => {
    removeIntegration(root, 'vscode');
    addIntegration(root, { id: 'editor', target: 'neovim', label: 'Neovim', placementKey: 'vscode-1' });
    expect(getIntegration(readConfig(root), 'editor')!.placementKey).toBe('vscode-1');
  });

  it('refuses to edit or remove a slot on an integration that does not exist', () => {
    expect(() => saveSlot(root, { integrationId: 'ghost', slotId: 'slot-1', layout: layout(300, 250) })).toThrow(
      ConfigError,
    );
    expect(() => removeSlot(root, 'ghost', 'slot-1')).toThrow(ConfigError);
  });

  it('refuses to edit a slot that does not exist rather than inventing one', () => {
    expect(() => saveSlot(root, { integrationId: 'vscode', slotId: 'slot-99', layout: layout(300, 250) })).toThrow(
      /slot/i,
    );
    expect(Object.keys(getIntegration(readConfig(root), 'vscode')!.slots)).toEqual(['slot-1']);
  });

  it('keeps two integrations on two keys when one of them has many slots', () => {
    addSlot(root, 'vscode', { label: 'Another', layout: layout(970, 120) });
    addSlot(root, 'vscode', { label: 'And another', layout: layout(320, 100) });

    const keys = new Set(Object.values(onDisk().integrations).map((i) => i.placementKey));
    expect(keys.size).toBe(2);
  });
});

describe('invalid data is rejected, not repaired', () => {
  beforeEach(() => {
    addIntegration(root, { id: 'vscode', target: 'vscode', label: 'VS Code', placementKey: 'vscode-1' });
    addSlot(root, 'vscode', { label: 'One', layout: layout(300, 250) });
  });

  it('rejects a slot whose geometry is outside the SDK limits', () => {
    expect(() =>
      saveSlot(root, { integrationId: 'vscode', slotId: 'slot-1', layout: layout(5000, 4000) }),
    ).toThrow(ConfigError);

    /* Clamping would be worse than refusing: the user would be told their ad
       was saved at a size they never chose. */
    expect(getSlot(root, 'vscode', 'slot-1')?.layout).toEqual(layout(300, 250));
  });

  it('refuses an unknown anchor on the write path the editor uses', () => {
    /* This asymmetry is deliberate and worth pinning. Reading normalises;
       writing refuses. A hand-edited file should still render, so a typo
       falls back to `center` -- but the editor must never store a value the
       user did not choose, so anything it is handed is checked first. */
    expect(() =>
      saveSlot(root, {
        integrationId: 'vscode',
        slotId: 'slot-1',
        layout: {
          size: { width: 300, height: 250 },
          position: { anchor: 'middle' as never, offsetX: 0, offsetY: 0 },
        },
      }),
    ).toThrow(ConfigError);
    expect(getSlot(root, 'vscode', 'slot-1')?.layout).toEqual(layout(300, 250));
  });

  it('normalises a hand-edited layout on read so the page still builds', () => {
    const raw = onDisk();
    raw.integrations.vscode.slots['slot-1'].layout.position.anchor = 'middle';
    writeRaw(JSON.stringify(raw, null, 2));

    expect(
      readConfig(root).integrations.vscode.slots['slot-1'].layout.position.anchor,
    ).toBe('center');
  });

  it('rejects a slot entry that is not an object', () => {
    const raw = onDisk();
    raw.integrations.vscode.slots['slot-1'] = 'nope';
    writeRaw(JSON.stringify(raw, null, 2));

    expect(() => readConfig(root)).toThrow(ConfigError);
  });

  it('rejects an integration entry that is not an object', () => {
    const raw = onDisk();
    raw.integrations.vscode = 'nope';
    writeRaw(JSON.stringify(raw, null, 2));

    expect(() => readConfig(root)).toThrow(ConfigError);
  });

  it('rejects a config whose integrations map is not an object', () => {
    writeRaw(JSON.stringify({ version: 2, integrations: 'nope' }, null, 2));
    expect(() => readConfig(root)).toThrow(ConfigError);
  });

  it('treats a slots map that is not an object as no slots, rather than crashing', () => {
    /* An array where a map belongs is a shape mistake, not a data loss: the
       only safe reading is "this integration has nothing positioned yet",
       which is also the state a fresh integration is in. */
    const raw = onDisk();
    raw.integrations.vscode.slots = [];
    writeRaw(JSON.stringify(raw, null, 2));

    expect(Object.keys(readConfig(root).integrations.vscode.slots)).toEqual([]);
  });

  it('leaves no temp file behind when a write is rejected', () => {
    expect(() => writeConfig(root, { version: 2, integrations: 'nope' as never })).toThrow();
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('never stores a credential in the config', () => {
    addIntegration(root, { id: 'codex', target: 'codex', label: 'Codex', placementKey: 'codex-1' });
    addSlot(root, 'codex', { layout: layout(300, 250) });
    const text = readFileSync(configPath(), 'utf8');

    expect(text).not.toMatch(/pk_(live|test)_/);
    expect(text).not.toMatch(/publishable|secret|token/i);
  });
});

describe('the config file itself', () => {
  it('is created empty when missing, because the generated code imports it', () => {
    const result = ensureConfigFile(root);
    expect(result.created).toBe(true);
    expect(onDisk()).toMatchObject({ version: CONFIG_VERSION, integrations: {} });
  });

  it('is left alone when it already exists', () => {
    addIntegration(root, { id: 'vscode', target: 'vscode', label: 'VS Code', placementKey: 'vscode-1' });
    const before = readFileSync(configPath(), 'utf8');

    expect(ensureConfigFile(root).created).toBe(false);
    expect(readFileSync(configPath(), 'utf8')).toBe(before);
  });

  it('writes byte-identical output when nothing changed', () => {
    addIntegration(root, { id: 'vscode', target: 'vscode', label: 'VS Code', placementKey: 'vscode-1' });
    addSlot(root, 'vscode', { layout: layout(728, 90) });
    const before = readFileSync(configPath(), 'utf8');

    saveSlot(root, { integrationId: 'vscode', slotId: 'slot-1', layout: layout(728, 90) });

    expect(readFileSync(configPath(), 'utf8')).toBe(before);
  });

  it('writes sorted keys, so a diff of this file is readable', () => {
    addIntegration(root, { id: 'zeta', target: 'vscode', label: 'Z', placementKey: 'z-1' });
    addIntegration(root, { id: 'alpha', target: 'codex', label: 'A', placementKey: 'a-1' });
    expect(Object.keys(onDisk().integrations)).toEqual(['alpha', 'zeta']);
  });
});

describe('a project with no config at all', () => {
  it('reads as empty rather than throwing', () => {
    expect(listIntegrations(root)).toEqual([]);
    expect(loadLayout(root, 'anything')).toEqual({
      size: { width: 320, height: 100 },
      position: { anchor: 'center', offsetX: 0, offsetY: 0 },
    });
  });

  it('still needs the file on disk for the generated bundle to build', () => {
    /* The generated Vite entry does a static `import` of this file, so a
       missing module fails the whole build rather than one component. */
    expect(existsSync(configPath())).toBe(false);
    expect(ensureConfigFile(root).created).toBe(true);
    expect(existsSync(configPath())).toBe(true);
  });

  it('loads the editor default geometry for a brand new slot', () => {
    addIntegration(root, { id: 'vscode', target: 'vscode', label: 'VS Code', placementKey: 'vscode-1' });
    expect(loadLayout(root, 'vscode')).toEqual({
      size: { width: 320, height: 100 },
      position: { anchor: 'center', offsetX: 0, offsetY: 0 },
    });
  });
});

describe('legacy projects kept working through the v1 facade', () => {
  it('lets the editor save geometry against a migrated v1 placement', () => {
    writeRaw(LEGACY_V1);

    saveSlot(root, {
      integrationId: 'home-top',
      slotId: 'slot-1',
      layout: layout(640, 120, 'bottom-center'),
    });

    const slot = getSlot(root, 'home-top', 'slot-1');
    expect(slot?.layout).toEqual(layout(640, 120, 'bottom-center'));
    /* The container the user configured by hand survives the editor saving
       a size -- the editor owns geometry, not the whole record. */
    expect(slot?.container).toBe('#ad-slot');
  });

  it('round-trips a legacy placement through the modern API', () => {
    writeRaw(LEGACY_V1);
    expect(loadLayout(root, 'home-top')).toEqual(layout(728, 90, 'top-center'));
    expect(loadLayout(root, 'sidebar')).toEqual(layout(300, 250, 'bottom-right'));
  });
});

describe('reading is safe on a project directory that has no write permission needs', () => {
  it('does not create the config as a side effect of reading', () => {
    readConfig(root);
    expect(existsSync(configPath())).toBe(false);
  });

  it('finds a config in a nested directory only through an explicit project root', () => {
    addIntegration(root, { id: 'vscode', target: 'vscode', label: 'VS Code', placementKey: 'vscode-1' });
    const nested = join(root, 'src', 'components');
    mkdirSync(nested, { recursive: true });

    /* Readers take the project root explicitly rather than walking up from an
       arbitrary directory, so a component folder never picks up the wrong
       project's config by accident. */
    expect(listIntegrations(nested)).toEqual([]);
    expect(listIntegrations(root)).toHaveLength(1);
  });
});