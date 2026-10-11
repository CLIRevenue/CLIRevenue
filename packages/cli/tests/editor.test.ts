import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEditor, type EditorSession } from '../src/editor/server.js';
import { renderEditorPage } from '../src/editor/page.js';
import { addIntegration, addSlot, loadLayout, readConfig, saveSlot } from '../src/project/config.js';
import type { AdLayout } from '../src/project/geometry.js';

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clirevenue-editor-'));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    rmSync(scratchDirs.pop()!, { recursive: true, force: true });
  }
});

const HOST = { width: 1000, height: 800 };

/**
 * `session.url` is the full address of the editor page — it already carries
 * the path and the token — so it is not a prefix that API routes hang off.
 * API calls are built from the bare origin instead.
 */
function api(session: EditorSession, path: string): string {
  return new URL(path, session.url).toString();
}

const layout = (overrides: Partial<AdLayout> = {}): AdLayout => ({
  size: { width: 320, height: 100 },
  position: { anchor: 'center', offsetX: 0, offsetY: 0 },
  ...overrides,
});

const sessions: EditorSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

async function open(overrides: Partial<Parameters<typeof startEditor>[0]> = {}) {
  const session = await startEditor({
    projectRoot: scratch(),
    integrations: [
      {
        id: 'home-top',
        label: 'Editor',
        target: 'vscode',
        placementKey: 'home-top',
        slots: [
          {
            integrationId: 'home-top',
            slotId: 'slot-1',
            placementKey: 'home-top',
            label: 'Home top',
            layout: layout(),
            container: '#ad-slot',
            enabled: true,
          },
          {
            integrationId: 'home-top',
            slotId: 'slot-2',
            placementKey: 'home-top',
            label: 'Sidebar',
            layout: layout({ size: { width: 300, height: 250 } }),
            enabled: true,
          },
        ],
      },
    ],
    hostWidth: HOST.width,
    hostHeight: HOST.height,
    ...overrides,
  });
  sessions.push(session);
  return session;
}

describe('placement editor — page', () => {
  it('renders a document that is identifiable as the CLIRevenue placement editor', () => {
    const html = renderEditorPage({
      integrations: [{ id: 'home-top', label: 'Editor', target: 'vscode', placementKey: 'home-top', slots: [{ integrationId: 'home-top', slotId: 'slot-1', placementKey: 'home-top', label: 'Home top', layout: layout(), enabled: true }] }],
      selectedId: 'home-top',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });

    expect(html).toContain('CLIRevenue placement editor');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
  });

  it('exposes drag, resize handles, and a pixel readout', () => {
    const html = renderEditorPage({
      integrations: [{ id: 'home-top', label: 'Editor', target: 'vscode', placementKey: 'home-top', slots: [{ integrationId: 'home-top', slotId: 'slot-1', placementKey: 'home-top', label: 'Home top', layout: layout(), enabled: true }] }],
      selectedId: 'home-top',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });

    /* Four corner handles is the difference between "resizable" and "slid a
       slider". */
    for (const handle of ['nw', 'ne', 'sw', 'se']) {
      expect(html).toContain(`class="handle ${handle}"`);
      expect(html).toContain(`data-dir="${handle}"`);
    }
    /* Pointer events, not mouse events: one code path covers mouse, touch
       and pen, and setPointerCapture keeps a drag alive outside the box. */
    expect(html).toContain('pointerdown');
    expect(html).toContain('pointermove');
    expect(html).toContain('setPointerCapture');
    expect(html).toContain('ad-text');
    expect(html).toMatch(/\bpx\b/);
  });

  it('offers numeric inputs and a save button as a non-drag alternative', () => {
    const html = renderEditorPage({
      integrations: [{ id: 'home-top', label: 'Editor', target: 'vscode', placementKey: 'home-top', slots: [{ integrationId: 'home-top', slotId: 'slot-1', placementKey: 'home-top', label: 'Home top', layout: layout(), enabled: true }] }],
      selectedId: 'home-top',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });

    for (const field of ['width', 'height', 'offsetX', 'offsetY']) {
      expect(html).toContain(`id="${field}"`);
    }
    expect(html).toContain('id="anchor"');
    expect(html).toContain('<select');
    expect(html).toContain('type="number"');
    expect(html).toContain('Save');
    expect(html).toContain('Cancel');
  });

  it('is keyboard accessible and announces validation errors', () => {
    const html = renderEditorPage({
      integrations: [{ id: 'home-top', label: 'Editor', target: 'vscode', placementKey: 'home-top', slots: [{ integrationId: 'home-top', slotId: 'slot-1', placementKey: 'home-top', label: 'Home top', layout: layout(), enabled: true }] }],
      selectedId: 'home-top',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });

    expect(html).toContain('keydown');
    expect(html).toContain('ArrowLeft');
    expect(html).toContain('aria-live');
    expect(html).toContain('role="application"');
    expect(html).toContain('aria-label');
  });

  it('never ships a credential to the browser', () => {
    const html = renderEditorPage({
      integrations: [{ id: 'home-top', label: 'Editor', target: 'vscode', placementKey: 'home-top', slots: [{ integrationId: 'home-top', slotId: 'slot-1', placementKey: 'home-top', label: 'Home top', layout: layout(), enabled: true }] }],
      selectedId: 'home-top',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });

    expect(html).not.toMatch(/pk_(live|test)_/);
    expect(html).not.toMatch(/publishable|secret/i);
  });

  it('escapes placement labels so a hostile label cannot inject script', () => {
    const html = renderEditorPage({
      integrations: [
      {
        id: 'x',
        label: 'Editor',
        target: 'vscode',
        placementKey: 'x',
        slots: [{ integrationId: 'x', slotId: 'slot-1', placementKey: 'x', label: '</option><script>alert(1)</script>', layout: layout(), enabled: true }],
      },
    ],
      selectedId: 'x',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });

    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('placement editor — persistence', () => {
  it('persists a custom width, height and anchor, then restores it on reopen', async () => {
    const root = scratch();
    /* `clirevenue editor` records the integration and its first slot in the
       project config before the editor opens, so the session is built on a
       config that already owns the slot. Saving may only edit a slot that
       exists -- it must never invent one. */
    addIntegration(root, { id: 'home-top', target: 'vscode', label: 'Home top', placementKey: 'home-top' });
    addSlot(root, 'home-top', { label: 'Home top', layout: layout(), container: '#ad-slot' });
    const session = await startEditor({
      projectRoot: root,
      integrations: [{ id: 'home-top', label: 'Editor', target: 'vscode', placementKey: 'home-top', slots: [{ integrationId: 'home-top', slotId: 'slot-1', placementKey: 'home-top', label: 'Home top', layout: layout(), enabled: true }] }],
      selectedId: 'home-top',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });
    sessions.push(session);

    const response = await fetch(api(session, '/api/save'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: session.token,
        integrationId: 'home-top',
        slotId: 'slot-1',
        layout: layout({
          size: { width: 728, height: 90 },
          position: { anchor: 'bottom-center', offsetX: 0, offsetY: 24 },
        }),
        container: '#ad-slot',
      }),
    });

    expect(response.status).toBe(200);
    await expect(session.result).resolves.toBe('saved');

    /* The file the SDK integration reads at runtime is the source of truth. */
    const saved = readConfig(root).integrations['home-top'].slots['slot-1'];
    expect(saved.layout.size).toEqual({ width: 728, height: 90 });
    expect(saved.layout.position.anchor).toBe('bottom-center');
    expect(saved.layout.position.offsetY).toBe(24);
    expect(saved.container).toBe('#ad-slot');

    /* Reopening restores the saved geometry rather than resetting it. */
    const reopened = renderEditorPage({
      integrations: [
      {
        id: 'home-top',
        label: 'Editor',
        target: 'vscode',
        placementKey: 'home-top',
        slots: [{ integrationId: 'home-top', slotId: 'slot-1', placementKey: 'home-top', label: 'Home top', layout: readConfig(root).integrations['home-top'].slots['slot-1'].layout, enabled: true }],
      },
    ],
      selectedId: 'home-top',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });
    expect(reopened).toContain('728');
    expect(reopened).toContain('bottom-center');
  });

  it('restores a saved placement through a second editor session', async () => {
    const root = scratch();
    addIntegration(root, { id: 'home-top', target: 'vscode', label: 'Home top', placementKey: 'home-top' });
    addSlot(root, 'home-top', {
      layout: layout({ size: { width: 640, height: 120 } }),
    });

    /* Built the way `clirevenue editor` builds it: the layout offered to the
       browser is the one read back off disk, not a hardcoded default. */
    const first = await startEditor({
      projectRoot: root,
      integrations: [
      {
        id: 'home-top',
        label: 'Editor',
        target: 'vscode',
        placementKey: 'home-top',
        slots: [
          {
            integrationId: 'home-top',
            slotId: 'slot-1',
            placementKey: 'home-top',
            label: 'Home top',
            layout: loadLayout(root, 'home-top'),
            enabled: true,
          },
        ],
      },
    ],
      selectedId: 'home-top',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });
    sessions.push(first);

    expect(first.url).toContain('127.0.0.1');

    /* The browser is handed the *saved* layout, so what the user sees on
       reopen is what they last saved. */
    const page = await fetch(api(first, `/?token=${first.token}`));
    const html = await page.text();
    expect(html).toContain('640');
  });

  it('rejects a layout outside the SDK size limits and writes nothing', async () => {
    const root = scratch();
    const session = await startEditor({
      projectRoot: root,
      integrations: [{ id: 'home-top', label: 'Editor', target: 'vscode', placementKey: 'home-top', slots: [{ integrationId: 'home-top', slotId: 'slot-1', placementKey: 'home-top', label: 'Home top', layout: layout(), enabled: true }] }],
      selectedId: 'home-top',
      hostWidth: HOST.width,
      hostHeight: HOST.height,
    });
    sessions.push(session);

    const response = await fetch(api(session, '/api/save'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: session.token,
        integrationId: 'home-top',
        slotId: 'slot-1',
        layout: layout({ size: { width: 5000, height: 4000 } }),
      }),
    });

    expect(response.status).toBe(400);
    expect(existsSync(join(root, 'clirevenue.config.json'))).toBe(false);
  });

  it('rejects a save for a placement this publisher does not own', async () => {
    const session = await open();

    const response = await fetch(api(session, '/api/save'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: session.token,
        placementKey: 'someone-elses-placement',
        layout: layout(),
      }),
    });

    expect(response.status).toBe(400);
    expect(existsSync(join(session.projectRoot, 'clirevenue.config.json'))).toBe(false);
  });

  it('reports cancellation without writing a config', async () => {
    const session = await open();

    const response = await fetch(api(session, '/api/cancel'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: session.token }),
    });

    expect(response.status).toBe(200);
    await expect(session.result).resolves.toBe('cancelled');
    expect(existsSync(join(session.projectRoot, 'clirevenue.config.json'))).toBe(false);
  });
});

describe('placement editor — access control', () => {
  it('refuses to serve the page without the token', async () => {
    const session = await open();
    const response = await fetch(api(session, '/'));
    expect(response.status).toBe(403);
  });

  it('refuses to save without the token', async () => {
    const session = await open();
    const response = await fetch(api(session, '/api/save'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ placementKey: 'home-top', layout: layout() }),
    });
    expect(response.status).toBe(403);
    expect(existsSync(join(session.projectRoot, 'clirevenue.config.json'))).toBe(false);
  });

  it('refuses a wrong token', async () => {
    const session = await open();
    const response = await fetch(api(session, `/?token=${'0'.repeat(session.token.length)}`));
    expect(response.status).toBe(403);
  });

  it('never exposes the publisher key through the served document', async () => {
    const session = await open();
    const html = await (await fetch(api(session, `/?token=${session.token}`))).text();
    expect(html).not.toMatch(/pk_(live|test)_/);
  });

  it('binds loopback only', async () => {
    const session = await open();
    expect(session.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  });
});

describe('placement editor — honest failure', () => {
  it('refuses to start when the project has no integrations', async () => {
    await expect(
      startEditor({ projectRoot: scratch(), integrations: [], hostWidth: 1000, hostHeight: 800 }),
    ).rejects.toThrow(/no CLIRevenue integrations/i);
  });

  it('explains how to fix it in the error hint', async () => {
    const err = await startEditor({
      projectRoot: scratch(),
      integrations: [],
      hostWidth: 1000,
      hostHeight: 800,
    }).catch((e: unknown) => e as { hint?: string });

    expect(err.hint).toMatch(/integrations add/);
  });

  it('also refuses when integrations exist but none has a slot to position', async () => {
    await expect(
      startEditor({
        projectRoot: scratch(),
        integrations: [{ id: 'vscode', label: 'Editor', target: 'vscode', placementKey: 'vscode-1', slots: [] }],
        hostWidth: 1000,
        hostHeight: 800,
      }),
    ).rejects.toThrow(/no ad slots/i);
  });
});

describe('placement editor — existing project files', () => {
  it('preserves a hand-edited config file', async () => {
    const root = scratch();
    const path = join(root, 'clirevenue.config.json');
    const original = `${JSON.stringify(
      {
        version: 2,
        myOwnField: 'keep me',
        integrations: {
          'home-top': {
            id: 'home-top',
            target: 'vscode',
            label: 'Home top',
            placementKey: 'home-top',
            slots: {
              'slot-1': {
                id: 'slot-1',
                label: 'Home top',
                layout: layout(),
                enabled: true,
                note: 'mine',
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`;
    writeFileSync(path, original);

    saveSlot(root, { integrationId: 'home-top', slotId: 'slot-1', layout: layout({ size: { width: 500, height: 90 } }) });

    const after = readFileSync(path, 'utf8');
    expect(after).toContain('myOwnField');
    expect(after).toContain('mine');
    expect(after).toContain('500');
  });

  it('refuses to overwrite a malformed config file', async () => {
    const root = scratch();
    const path = join(root, 'clirevenue.config.json');
    writeFileSync(path, '{ not json');
    expect(() => saveSlot(root, { integrationId: 'home-top', slotId: 'slot-1', layout: layout() })).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('{ not json');
  });
});
