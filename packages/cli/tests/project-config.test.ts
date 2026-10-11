import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AD_ANCHORS,
  AD_SIZE_LIMITS,
  boxToLayout,
  isAnchor,
  normalizeAdPosition,
  normalizeAdSize,
  normalizeLayout,
  nudge,
  resolveAdBox,
  validateLayout,
  type AdLayout,
} from '../src/project/geometry.js';
import {
  CONFIG_FILE,
  ConfigError,
  getPlacement,
  listPlacements,
  loadLayout,
  readConfig,
  savePlacement,
  sameLayout,
  writeConfig,
} from '../src/project/config.js';

describe('geometry', () => {
  it('mirrors the SDK anchor vocabulary exactly', () => {
    /* If this list ever drifts from packages/sdk/src/layout.ts the editor
       starts writing placements the SDK cannot resolve, so it is asserted
       literally rather than derived. */
    expect([...AD_ANCHORS]).toEqual([
      'top-left',
      'top-center',
      'top-right',
      'center-left',
      'center',
      'center-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]);
    expect(isAnchor('center')).toBe(true);
    expect(isAnchor('middle')).toBe(false);
  });

  it('clamps sizes to the SDK limits', () => {
    expect(normalizeAdSize({ width: 5, height: 5 })).toEqual({
      width: AD_SIZE_LIMITS.minWidth,
      height: AD_SIZE_LIMITS.minHeight,
    });
    expect(normalizeAdSize({ width: 99999, height: 99999 })).toEqual({
      width: AD_SIZE_LIMITS.maxWidth,
      height: AD_SIZE_LIMITS.maxHeight,
    });
    expect(normalizeAdSize(null)).toEqual({ width: 320, height: 100 });
  });

  it('rejects an unknown anchor and falls back to center', () => {
    expect(normalizeAdPosition({ anchor: 'nope' as never, offsetX: 5, offsetY: 5 })).toEqual({
      anchor: 'center',
      offsetX: 5,
      offsetY: 5,
    });
  });

  it('resolves a centred layout in the middle of its host', () => {
    const box = resolveAdBox({ size: { width: 320, height: 100 } }, { width: 1000, height: 800 });
    expect(box).toEqual({ width: 320, height: 100, left: 340, top: 350 });
  });

  it('shrinks an ad that cannot fit its host', () => {
    const box = resolveAdBox({ size: { width: 900, height: 700 } }, { width: 400, height: 300 });
    expect(box.width).toBe(400);
    expect(box.height).toBe(300);
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
  });

  it('places corner anchors against the host edges', () => {
    const host = { width: 1000, height: 800 };
    expect(resolveAdBox({ position: { anchor: 'top-left' } }, host)).toEqual({
      width: 320,
      height: 100,
      left: 0,
      top: 0,
    });
    expect(resolveAdBox({ position: { anchor: 'bottom-right' } }, host)).toEqual({
      width: 320,
      height: 100,
      left: 680,
      top: 700,
    });
  });

  it('never lets an offset push the ad outside its host', () => {
    const box = resolveAdBox(
      { position: { anchor: 'top-left', offsetX: 99999, offsetY: -99999 } },
      { width: 500, height: 500 },
    );
    expect(box.left).toBe(180);
    expect(box.top).toBe(0);
  });

  it('round-trips a dragged box back into a stable layout', () => {
    /* This stability is what lets the editor restore and re-save without
       drift; without it, every open/save cycle would ratchet the geometry. */
    const host = { width: 1280, height: 800 };
    const dragged = { width: 300, height: 250, left: 480, top: 260 };
    const once = boxToLayout(dragged, host);
    const twice = boxToLayout(resolveAdBox(once, host), host);
    expect(sameLayout(once, twice)).toBe(true);
  });

  it('reduces a slightly-off-centre drag to center, not to an edge anchor', () => {
    /* Keeping the nearest anchor is what preserves responsive intent: the ad
       still tracks the centre when the host later resizes. */
    const host = { width: 1000, height: 800 };
    const layout = boxToLayout({ width: 320, height: 100, left: 352, top: 358 }, host);
    expect(layout.position.anchor).toBe('center');
    expect(Math.abs(layout.position.offsetX)).toBeLessThanOrEqual(12);
    expect(Math.abs(layout.position.offsetY)).toBeLessThanOrEqual(12);
  });

  it('reports readable validation failures and accepts a valid layout', () => {
    expect(validateLayout(normalizeLayout(null))).toEqual([]);
    expect(validateLayout({ size: { width: 5, height: 5 } })[0]).toMatch(/Width must be between/);
    expect(validateLayout({ size: { width: 300, height: 100 }, position: { anchor: 'x' as never } })[0]).toMatch(
      /Anchor must be one of/,
    );
  });

  it('nudges for keyboard control', () => {
    const host = { width: 1000, height: 800 };
    const start = normalizeLayout(null);
    const moved = nudge(start, 10, 0, host);
    expect(resolveAdBox(moved, host).left).toBe(resolveAdBox(start, host).left + 10);
  });
});

describe('project config', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'clirevenue-config-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('treats a missing config as empty rather than failing', () => {
    const config = readConfig(root);
    expect(config.integrations).toEqual({});
    expect(existsSync(join(root, CONFIG_FILE))).toBe(false);
  });

  it('never stores a credential in the config file', () => {
    /* The publisher key lives in .env.local only. A config file is the thing
       most likely to be committed or bundled, so it must stay inert. */
    savePlacement(root, {
      placementKey: 'home',
      layout: normalizeLayout(null),
    });
    const raw = readFileSync(join(root, CONFIG_FILE), 'utf8');
    expect(raw).not.toMatch(/pk_(live|test)/);
    expect(raw).not.toMatch(/publishable|secret|token/i);
  });

  it('persists width, height and anchor, and restores them on reopen', () => {
    const layout: AdLayout = {
      size: { width: 728, height: 90 },
      position: { anchor: 'bottom-center', offsetX: 0, offsetY: 24 },
    };
    savePlacement(root, { placementKey: 'home', layout });

    expect(readConfig(root).integrations.home.slots['slot-1'].layout).toEqual(layout);
    expect(loadLayout(root, 'home')).toEqual(layout);
    expect(getPlacement(readConfig(root), 'home')?.layout).toEqual(layout);
  });

  it('falls back to the SDK defaults for an unsaved placement', () => {
    expect(loadLayout(root, 'never-saved')).toEqual(normalizeLayout(null));
  });

  it('validates before writing anything', () => {
    expect(() =>
      savePlacement(root, {
        placementKey: 'home',
        layout: { size: { width: 10, height: 10 }, position: { anchor: 'center', offsetX: 0, offsetY: 0 } },
      }),
    ).toThrow(ConfigError);
    expect(existsSync(join(root, CONFIG_FILE))).toBe(false);
  });

  it('rejects an empty placement key', () => {
    expect(() => savePlacement(root, { placementKey: '  ', layout: normalizeLayout(null) })).toThrow(
      ConfigError,
    );
  });

  it('is idempotent: re-saving identical geometry changes no bytes', () => {
    const layout = normalizeLayout(null);
    savePlacement(root, { placementKey: 'home', layout });
    const first = readFileSync(join(root, CONFIG_FILE), 'utf8');

    const second = savePlacement(root, { placementKey: 'home', layout });
    expect(second.changed).toBe(false);
    expect(readFileSync(join(root, CONFIG_FILE), 'utf8')).toBe(first);
  });

  it('touches only its own placement when saving', () => {
    savePlacement(root, { placementKey: 'home', layout: normalizeLayout(null) });
    savePlacement(root, {
      placementKey: 'sidebar',
      layout: { size: { width: 300, height: 250 }, position: { anchor: 'top-right', offsetX: 0, offsetY: 0 } },
    });

    const before = readConfig(root).integrations.home.slots['slot-1'];
    savePlacement(root, {
      placementKey: 'sidebar',
      layout: { size: { width: 320, height: 600 }, position: { anchor: 'center', offsetX: 8, offsetY: 8 } },
    });

    const after = readConfig(root);
    expect(after.integrations.home.slots['slot-1']).toEqual(before);
    expect(after.integrations.sidebar.slots['slot-1'].layout.size).toEqual({ width: 320, height: 600 });
    expect(Object.keys(after.integrations).sort()).toEqual(['home', 'sidebar']);
    expect(listPlacements(root)).toHaveLength(2);
  });

  it('preserves unknown top-level and per-placement keys the user added', () => {
    writeConfig(root, {
      version: 2,
      integrations: {
        home: {
          id: 'home',
          target: 'vscode',
          label: 'Home',
          placementKey: 'home',
          slots: {
            'slot-1': { id: 'slot-1', label: 'Home', layout: normalizeLayout(null), enabled: true, note: 'keep me' },
          },
        },
      },
      myOwnField: 'keep me too',
    });
    savePlacement(root, {
      placementKey: 'home',
      layout: { size: { width: 400, height: 120 }, position: { anchor: 'center', offsetX: 0, offsetY: 0 } },
    });

    const raw = JSON.parse(readFileSync(join(root, CONFIG_FILE), 'utf8'));
    expect(raw.myOwnField).toBe('keep me too');
    expect(raw.integrations.home.slots['slot-1'].note).toBe('keep me');
    expect(raw.integrations.home.slots['slot-1'].layout.size.width).toBe(400);
  });

  it('refuses to silently overwrite a malformed config', () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, CONFIG_FILE), '{ this is not json', 'utf8');

    expect(() => readConfig(root)).toThrow(ConfigError);
    expect(() => savePlacement(root, { placementKey: 'home', layout: normalizeLayout(null) })).toThrow(ConfigError);
    /* The user's broken file is left exactly as they wrote it. */
    expect(readFileSync(join(root, CONFIG_FILE), 'utf8')).toBe('{ this is not json');
  });

  it('rejects a malformed integrations map rather than dropping it', () => {
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 2, integrations: 'nope' }), 'utf8');
    expect(() => readConfig(root)).toThrow(ConfigError);
  });

  it('writes atomically, leaving no temp file behind', () => {
    savePlacement(root, { placementKey: 'home', layout: normalizeLayout(null) });
    const stray = readFileSync(join(root, CONFIG_FILE), 'utf8');
    expect(stray).not.toContain('.tmp');
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
