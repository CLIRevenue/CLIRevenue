import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AD_SIZE_LIMITS,
  boxToLayout,
  isAnchor,
  normalizeLayout,
  resolveAdBox,
  validateLayout,
  type AdAnchor,
  type AdBox,
  type AdContainer,
  type AdLayout,
} from './geometry.js';

/**
 * The project's CLIRevenue configuration: `clirevenue.config.json`.
 *
 * This file is the contract between the placement editor and the SDK. The
 * editor writes it; the generated integration code reads it; the SDK receives
 * its `AdLayoutInput` from it verbatim. Because the shape stored here is
 * `{ size, position }` — the SDK's own vocabulary — the configuration is
 * consumed by the real SDK rather than reimplemented by the CLI.
 *
 * Four rules shape everything below:
 *
 * 1. **No credentials, ever.** The publisher key is a secret that lives in
 *    the environment (`.env.local`) and is deliberately *not* mirrored here.
 *    A config file is the artefact most likely to be committed, printed in a
 *    bug report, or bundled; a key that is not in it cannot leak from it.
 * 2. **The user's file is theirs.** Unknown keys survive a rewrite, unknown
 *    integrations and slots are never dropped, and a malformed file is
 *    reported rather than silently overwritten.
 * 3. **One integration owns one placement key.** A placement key identifies
 *    one creative for one publisher. Two integrations sharing a key would mean
 *    the same ad renders in two places, so uniqueness is a product rule, not a
 *    convention — it is checked on read *and* before every write.
 * 4. **Slots are client-side, keys are server-side.** A slot is a place on one
 *    page; many slots may share one integration's placement key. Keeping them
 *    separate is what lets a user put three ads on a page without the backend
 *    ever seeing three placements.
 */

export const CONFIG_FILE = 'clirevenue.config.json';

/**
 * The current schema version. Version 1 was a flat `placements` map; version 2
 * nests slots under integrations. A v1 file is migrated on read (see
 * `migrate`), never rewritten in place behind the user's back.
 */
export const CONFIG_VERSION = 2;

/**
 * The target id given to an integration that came from a v1 config.
 *
 * It is deliberately `legacy` rather than a guess. A v1 placement records
 * which creative it renders but not which CLI the user was working in, and
 * inventing a target here would write an activation file for an application
 * the user may not even have installed.
 */
export const LEGACY_TARGET = 'legacy';

/**
 * One ad on one page: independent geometry, its own container selector, and
 * its own enabled state, all sharing its integration's placement key.
 */
export interface SlotConfig {
  /** Stable, unique within its integration. Assigned once, never reused. */
  id: string;
  label: string;
  /** The exact `AdLayoutInput` the SDK's `render()` receives. */
  layout: AdLayout;
  /** Optional CSS selector for the ad host element. */
  container?: string;
  /** Disabled slots stay in the file (their geometry is preserved) but do not
   *  render. Deleting is a separate, explicit act. */
  enabled: boolean;
  updatedAt?: string;
  [extra: string]: unknown;
}

/** One CLI integration: the unit that owns a placement key. */
export interface IntegrationConfig {
  id: string;
  /** Key into the capability registry (`keybindings/targets.ts`). */
  target: string;
  label: string;
  /** The backend placement this integration renders. Unique across the file. */
  placementKey: string;
  slots: Record<string, SlotConfig>;
  /**
   * Highest slot number ever issued for this integration.
   *
   * Persisted so an id is never recycled: removing every slot must not reset
   * the counter, or a newly added slot would inherit an id that generated
   * code, a saved editor link, or a bookmark already points at -- and would
   * quietly render a different ad. Optional, because a config written before
   * this field existed has no mark and simply derives one from its slots.
   */
  slotSeq?: number;
  createdAt?: string;
  updatedAt?: string;
  [extra: string]: unknown;
}

export interface ClirevenueConfig {
  $schema?: string;
  version: number;
  integrations: Record<string, IntegrationConfig>;
  [extra: string]: unknown;
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unreadable'
      | 'invalid'
      | 'duplicate-placement-key'
      | 'duplicate-integration'
      | 'unknown-integration'
      | 'unknown-slot' = 'invalid',
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * Read `clirevenue.config.json` from a project root.
 *
 * A missing file is an empty config, not an error — first run is normal. A
 * file that exists but cannot be parsed *is* an error, and it is raised
 * rather than replaced: silently regenerating a file a human edited by hand
 * would destroy work with no way to recover it.
 */
export function readConfig(projectRoot: string): ClirevenueConfig {
  const path = join(projectRoot, CONFIG_FILE);
  if (!existsSync(path)) return { version: CONFIG_VERSION, integrations: {} };

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(
      `Could not read ${CONFIG_FILE}: ${err instanceof Error ? err.message : 'unknown error'}`,
      'unreadable',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `${CONFIG_FILE} is not valid JSON (${
        err instanceof Error ? err.message : 'parse error'
      }). Fix or move the file, then run setup again. It was left untouched.`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`${CONFIG_FILE} must contain a JSON object. It was left untouched.`);
  }

  const record = parsed as Record<string, unknown>;
  const migrated = migrate(record);
  /* Spread first so unknown top-level keys are preserved, then overwrite the
     fields this module owns. */
  const config: ClirevenueConfig = {
    ...record,
    version: CONFIG_VERSION,
    integrations: coerceIntegrations((migrated.integrations ?? {}) as Record<string, unknown>),
  };
  /* The v1 field is dropped once it has been folded into `integrations`.
     Leaving both would present the same placement twice and invite the
     generated code to read whichever it finds first. */
  delete (config as Record<string, unknown>).placements;
  assertUniquePlacementKeys(config);
  return config;
}

function coerceIntegrations(source: Record<string, unknown>): Record<string, IntegrationConfig> {
  const out: Record<string, IntegrationConfig> = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new ConfigError(`${CONFIG_FILE} "integrations" must be an object. It was left untouched.`);
  }
  for (const [id, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConfigError(
        `${CONFIG_FILE} integration "${id}" must be an object. It was left untouched.`,
      );
    }
    out[id] = coerceIntegration(id, value);
  }
  return out;
}

function coerceIntegration(id: string, value: unknown): IntegrationConfig {
  const record = value as Record<string, unknown>;
  const placementKey =
    typeof record.placementKey === 'string' && record.placementKey.trim()
      ? record.placementKey.trim()
      : id;

  const rawSlots =
    record.slots && typeof record.slots === 'object' && !Array.isArray(record.slots)
      ? (record.slots as Record<string, unknown>)
      : {};

  const slots: Record<string, SlotConfig> = {};
  for (const [slotId, slot] of Object.entries(rawSlots)) {
    slots[slotId] = coerceSlot(slotId, slot);
  }

  return {
    ...record,
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : id,
    target: typeof record.target === 'string' && record.target.trim() ? record.target.trim() : LEGACY_TARGET,
    label:
      typeof record.label === 'string' && record.label.trim() ? record.label.trim() : id,
    placementKey,
    slots,
  };
}

function coerceSlot(id: string, value: unknown): SlotConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(
      `${CONFIG_FILE} slot "${id}" must be an object. It was left untouched.`,
    );
  }
  const record = value as Record<string, unknown>;
  const container =
    typeof record.container === 'string' && record.container.trim()
      ? record.container.trim()
      : undefined;

  return {
    ...record,
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : id,
    label: typeof record.label === 'string' && record.label.trim() ? record.label.trim() : id,
    layout: normalizeLayout(record.layout as Partial<AdLayout> | null | undefined),
    enabled: record.enabled !== false,
    ...(container ? { container } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------ */

/**
 * Fold a version 1 config into the version 2 shape.
 *
 * The mapping is deliberately one-to-one and lossless: each v1 placement
 * becomes one integration (id derived from its key so the link is visible in
 * the file) owning that same placement key, with one slot carrying the same
 * geometry and container. Nothing is renamed, dropped, or recalculated, so a
 * user who upgrades and immediately downgrades sees the config they had.
 *
 * It is pure and runs on every read, so a v1 file that is never written still
 * works, and migration cannot drift between runs.
 */
export function migrate(record: Record<string, unknown>): Record<string, unknown> {
  if (record.integrations && typeof record.integrations === 'object') {
    /* Already v2 (or newer). Do not touch it — including unknown fields. */
    return record;
  }
  const legacy = record.placements;
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return record;

  const integrations: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(legacy as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const placement = value as Record<string, unknown>;
    const placementKey =
      typeof placement.placementKey === 'string' && placement.placementKey.trim()
        ? placement.placementKey.trim()
        : key;
    integrations[key] = {
      id: key,
      target: LEGACY_TARGET,
      label: typeof placement.name === 'string' && placement.name.trim() ? placement.name.trim() : key,
      placementKey,
      slots: {
        'slot-1': {
          id: 'slot-1',
          label: typeof placement.name === 'string' && placement.name.trim() ? placement.name.trim() : key,
          layout: placement.layout,
          ...(typeof placement.container === 'string' && placement.container.trim()
            ? { container: placement.container.trim() }
            : {}),
          enabled: true,
          ...(typeof placement.updatedAt === 'string' ? { updatedAt: placement.updatedAt } : {}),
        },
      },
    };
  }
  return { ...record, integrations };
}

/**
 * Reject a file in which two integrations claim the same placement key.
 *
 * Checked on read as well as on write: a hand-edited file that violates the
 * rule should fail loudly at the point it is read, not quietly produce two
 * integrations that render the same creative and look like a positioning bug.
 */
export function assertUniquePlacementKeys(config: ClirevenueConfig): void {
  const owners = new Map<string, string>();
  for (const integration of Object.values(config.integrations)) {
    const key = integration.placementKey;
    const existing = owners.get(key);
    if (existing && existing !== integration.id) {
      throw new ConfigError(
        `Integrations "${existing}" and "${integration.id}" both use placement key "${key}". ` +
          'Each CLI integration needs its own placement key so the same ad is not counted twice. ' +
          'Give one of them a different key, or run `clirevenue integrations` to see the owners.',
        'duplicate-placement-key',
      );
    }
    owners.set(key, integration.id);
  }
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/**
 * Write the config atomically.
 *
 * The temp-file-then-rename dance is not ceremony: an editor save that
 * crashed halfway would otherwise leave a truncated JSON file that makes the
 * project unreadable on the next run, turning a recoverable save into a
 * hand-repair job.
 */
export function writeConfig(projectRoot: string, config: ClirevenueConfig): string {
  const path = join(projectRoot, CONFIG_FILE);
  mkdirSync(dirname(path), { recursive: true });

  assertUniquePlacementKeys(config);

  const ordered: ClirevenueConfig = {
    ...config,
    $schema: config.$schema ?? 'https://clirevenue.in/schema/clirevenue.config.json',
    version: CONFIG_VERSION,
    integrations: sortIntegrations(config.integrations),
  };

  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
  return path;
}

/** Sort integrations by id and slots by id, so an unchanged re-save is a
 *  byte-identical file and therefore an empty diff. Idempotence has to be
 *  observable, or "re-running changes nothing" is only a claim. */
function sortIntegrations(
  integrations: Record<string, IntegrationConfig>,
): Record<string, IntegrationConfig> {
  return Object.fromEntries(
    Object.entries(integrations)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, integration]) => [
        id,
        {
          ...integration,
          slots: Object.fromEntries(
            Object.entries(integration.slots).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          ),
        },
      ]),
  );
}

/* ------------------------------------------------------------------ *
 * Integrations
 * ------------------------------------------------------------------ */

export interface AddIntegrationInput {
  id: string;
  target: string;
  label: string;
  placementKey: string;
}

/**
 * Add an integration, refusing a placement key that is already owned.
 *
 * The refusal is the whole point of the check: a duplicate key would make two
 * different CLIs render the same backend placement, which reads as "the ad
 * shows up in the wrong place" and is very hard to diagnose from the UI.
 */
export function addIntegration(
  projectRoot: string,
  input: AddIntegrationInput,
): { path: string; config: ClirevenueConfig; created: boolean } {
  const id = input.id.trim();
  if (!id) throw new ConfigError('An integration needs an id before it can be added.');
  const placementKey = input.placementKey.trim();
  if (!placementKey) throw new ConfigError('An integration needs a placement key.');

  const config = readConfig(projectRoot);
  const owner = Object.values(config.integrations).find(
    (entry) => entry.placementKey === placementKey,
  );
  if (owner && owner.id !== id) {
    throw new ConfigError(
      `Placement key "${placementKey}" is already used by integration "${owner.id}". ` +
        'Each CLI integration needs its own placement key.',
      'duplicate-placement-key',
    );
  }
  if (config.integrations[id]) {
    return { path: join(projectRoot, CONFIG_FILE), config, created: false };
  }

  config.integrations[id] = {
    id,
    target: input.target.trim() || LEGACY_TARGET,
    label: input.label.trim() || id,
    placementKey,
    slots: {},
    createdAt: new Date().toISOString(),
  };
  const path = writeConfig(projectRoot, config);
  return { path, config, created: true };
}

export function getIntegration(
  config: ClirevenueConfig,
  id: string,
): IntegrationConfig | null {
  return config.integrations[id] ?? null;
}

/** Every integration, sorted by id. */
export function listIntegrations(projectRoot: string): IntegrationConfig[] {
  return Object.values(readConfig(projectRoot).integrations);
}

/**
 * Remove an integration.
 *
 * Removing the local record never touches the backend placement: the
 * placement may be shared with something the CLI cannot see, and deleting a
 * server-side row is not something a local config command should be able to
 * do by accident. Deleting the ad on the server stays a dashboard action.
 */
export function removeIntegration(
  projectRoot: string,
  id: string,
): { path: string; config: ClirevenueConfig; removed: IntegrationConfig | null } {
  const config = readConfig(projectRoot);
  const existing = config.integrations[id];
  if (!existing) {
    return { path: join(projectRoot, CONFIG_FILE), config, removed: null };
  }
  delete config.integrations[id];
  const path = writeConfig(projectRoot, config);
  return { path, config, removed: existing };
}

/* ------------------------------------------------------------------ *
 * Slots
 * ------------------------------------------------------------------ */

function requireIntegration(
  config: ClirevenueConfig,
  integrationId: string,
): IntegrationConfig {
  const integration = config.integrations[integrationId];
  if (!integration) {
    throw new ConfigError(
      `No integration "${integrationId}" is configured in this project. ` +
        'Run `clirevenue integrations` to see what is configured.',
      'unknown-integration',
    );
  }
  return integration;
}

function requireSlot(integration: IntegrationConfig, slotId: string): SlotConfig {
  const slot = integration.slots[slotId];
  if (!slot) {
    throw new ConfigError(
      `Slot "${slotId}" does not belong to integration "${integration.id}". ` +
        'Editing or removing one slot never affects its siblings.',
      'unknown-slot',
    );
  }
  return slot;
}

/**
 * The next slot id for an integration.
 *
 * Sequential (`slot-2`, `slot-3`) rather than random, so the file reads in
 * creation order and a test can assert an exact id. Once written the id is
 * never reused, even if the slot is later removed, because a stable id is
 * what lets generated code and a saved layout refer to the same slot.
 */
export function nextSlotId(integration: IntegrationConfig): string {
  let highest =
    typeof integration.slotSeq === 'number' && Number.isFinite(integration.slotSeq)
      ? Math.trunc(integration.slotSeq)
      : 0;
  for (const id of Object.keys(integration.slots)) {
    const match = /^slot-(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `slot-${highest + 1}`;
}

export function addSlot(
  projectRoot: string,
  integrationId: string,
  input: { label?: string; layout?: Partial<AdLayout> | null; container?: string } = {},
): { path: string; config: ClirevenueConfig; slot: SlotConfig; created: boolean } {
  const config = readConfig(projectRoot);
  const integration = requireIntegration(config, integrationId);

  const id = nextSlotId(integration);
  /* Burn the id. `nextSlotId` reads the highest number still present, so
     without this the counter restarts whenever the last slot is removed. */
  integration.slotSeq = Number(id.slice('slot-'.length));
  const layout = normalizeLayout(input.layout ?? null);
  const errors = validateLayout(input.layout ?? layout);
  if (errors.length > 0) throw new ConfigError(errors.join(' '));

  const slot: SlotConfig = {
    id,
    label: input.label?.trim() || `Ad ${Object.keys(integration.slots).length + 1}`,
    layout,
    enabled: true,
    ...(input.container?.trim() ? { container: input.container.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  integration.slots[id] = slot;
  const path = writeConfig(projectRoot, config);
  return { path, config, slot, created: true };
}

/**
 * Save one slot, leaving every sibling slot and every other integration
 * untouched. This is the editor's only write path.
 */
export function saveSlot(
  projectRoot: string,
  input: {
    integrationId: string;
    slotId: string;
    layout: AdLayout;
    container?: string;
    label?: string;
    enabled?: boolean;
  },
): { path: string; config: ClirevenueConfig; changed: boolean } {
  const errors = validateLayout(input.layout);
  if (errors.length > 0) throw new ConfigError(errors.join(' '));

  const config = readConfig(projectRoot);
  const integration = requireIntegration(config, input.integrationId);
  const existing = requireSlot(integration, input.slotId);

  const next: SlotConfig = {
    ...existing,
    layout: normalizeLayout(input.layout),
    ...(input.container !== undefined
      ? input.container.trim()
        ? { container: input.container.trim() }
        : { container: undefined }
      : {}),
    ...(input.label !== undefined ? { label: input.label.trim() || existing.label } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (next.container === undefined) delete next.container;

  const changed = !sameLayout(existing.layout, next.layout) || existing.container !== next.container || existing.enabled !== next.enabled || existing.label !== next.label;

  integration.slots[input.slotId] = changed ? next : existing;
  const path = writeConfig(projectRoot, config);
  return { path, config, changed };
}

export function removeSlot(
  projectRoot: string,
  integrationId: string,
  slotId: string,
): { path: string; config: ClirevenueConfig; removed: SlotConfig | null } {
  const config = readConfig(projectRoot);
  const integration = requireIntegration(config, integrationId);
  const existing = requireSlot(integration, slotId);
  delete integration.slots[slotId];
  const path = writeConfig(projectRoot, config);
  return { path, config, removed: existing };
}

export function getSlot(
  projectRoot: string,
  integrationId: string,
  slotId: string,
): SlotConfig | null {
  return requireIntegration(readConfig(projectRoot), integrationId).slots[slotId] ?? null;
}

export function listSlots(projectRoot: string, integrationId: string): SlotConfig[] {
  return Object.values(requireIntegration(readConfig(projectRoot), integrationId).slots);
}

/** Every enabled slot, flattened with its integration — what the SDK renders. */
export function listRenderableSlots(
  projectRoot: string,
): Array<{ integration: IntegrationConfig; slot: SlotConfig }> {
  const config = readConfig(projectRoot);
  return Object.values(config.integrations).flatMap((integration) =>
    Object.values(integration.slots)
      .filter((slot) => slot.enabled)
      .map((slot) => ({ integration, slot })),
  );
}

/* ------------------------------------------------------------------ *
 * Comparison helpers
 * ------------------------------------------------------------------ */

export function sameLayout(a: AdLayout, b: AdLayout): boolean {
  return (
    a.size.width === b.size.width &&
    a.size.height === b.size.height &&
    a.position.anchor === b.position.anchor &&
    a.position.offsetX === b.position.offsetX &&
    a.position.offsetY === b.position.offsetY
  );
}

/**
 * The layout the editor opens a slot with.
 *
 * A saved slot is restored exactly. Otherwise the SDK's own defaults are used
 * — `320 × 100` at `center` — so the first launch shows the same geometry the
 * SDK would have rendered anyway, rather than an arbitrary guess that would
 * silently become the user's configuration on save.
 */
export function loadLayout(projectRoot: string, integrationId: string, slotId?: string): AdLayout {
  const integration = readConfig(projectRoot).integrations[integrationId];
  const slot = integration
    ? slotId
      ? integration.slots[slotId]
      : Object.values(integration.slots)[0]
    : undefined;
  return slot ? slot.layout : normalizeLayout(null);
}

/* ------------------------------------------------------------------ *
 * Version 1 compatibility facade
 * ------------------------------------------------------------------ */

/**
 * The version 1 shape, derived from version 2.
 *
 * Kept because two things outside this module still speak it: the generated
 * integration code that shipped in 1.1.0, and users' muscle memory. It is a
 * projection, never a second copy on disk.
 */
export interface PlacementConfig {
  placementKey: string;
  layout: AdLayout;
  container?: string;
  updatedAt?: string;
}

export function getPlacement(config: ClirevenueConfig, placementKey: string): PlacementConfig | null {
  const integration = Object.values(config.integrations).find(
    (entry) => entry.placementKey === placementKey,
  );
  if (!integration) return null;
  const slot = Object.values(integration.slots)[0];
  if (!slot) return null;
  return {
    placementKey: integration.placementKey,
    layout: slot.layout,
    ...(slot.container ? { container: slot.container } : {}),
    ...(slot.updatedAt ? { updatedAt: slot.updatedAt } : {}),
  };
}

/** Every placement key currently configured, one entry per integration. */
export function listPlacements(projectRoot: string): PlacementConfig[] {
  const config = readConfig(projectRoot);
  return Object.values(config.integrations)
    .map((integration) => getPlacement(config, integration.placementKey))
    .filter((entry): entry is PlacementConfig => entry !== null);
}

/**
 * The version 1 write path, expressed in terms of version 2.
 *
 * An integration owning `placementKey` is created on demand, so a project
 * configured entirely through the old editor keeps working.
 */
export function savePlacement(
  projectRoot: string,
  placement: { placementKey: string; layout: AdLayout; container?: string },
): { path: string; config: ClirevenueConfig; changed: boolean } {
  const key = placement.placementKey.trim();
  if (!key) throw new ConfigError('A placement key is required before a placement can be saved.');

  const errors = validateLayout(placement.layout);
  if (errors.length > 0) throw new ConfigError(errors.join(' '));

  const config = readConfig(projectRoot);
  const integration =
    Object.values(config.integrations).find((entry) => entry.placementKey === key) ??
    config.integrations[key];

  if (!integration) {
    config.integrations[key] = {
      id: key,
      target: LEGACY_TARGET,
      label: key,
      placementKey: key,
      slots: {},
    };
    return addSlotTo(projectRoot, config, key, { layout: placement.layout, container: placement.container });
  }

  const slotId = Object.keys(integration.slots)[0] ?? nextSlotId(integration);
  if (!integration.slots[slotId]) {
    return addSlotTo(projectRoot, config, integration.id, {
      slotId,
      layout: placement.layout,
      container: placement.container,
    });
  }
  return saveSlot(projectRoot, {
    integrationId: integration.id,
    slotId,
    layout: placement.layout,
    container: placement.container,
  });
}

function addSlotTo(
  projectRoot: string,
  config: ClirevenueConfig,
  integrationId: string,
  input: { slotId?: string; layout: AdLayout; container?: string },
): { path: string; config: ClirevenueConfig; changed: boolean } {
  const integration = config.integrations[integrationId];
  const id = input.slotId ?? nextSlotId(integration);
  if (!input.slotId) {
    /* Same rule as `addSlot`: an id we mint here must not come back round. */
    integration.slotSeq = Number(id.slice('slot-'.length));
  }
  integration.slots[id] = {
    id,
    label: id,
    layout: normalizeLayout(input.layout),
    enabled: true,
    ...(input.container?.trim() ? { container: input.container.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  const path = writeConfig(projectRoot, config);
  return { path, config, changed: true };
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

/**
 * Make sure `clirevenue.config.json` exists, without clobbering one that does.
 *
 * The bundled adapters `import clirevenueConfig from
 * '../../clirevenue.config.json'` — a *static* import, because it has to be
 * statically analyzable by the bundler. That makes the file a hard build
 * input: on a fresh project it does not exist yet, and a missing JSON import
 * fails the whole build rather than degrading. Setup therefore seeds an empty
 * config so the very first `npm run dev` succeeds, and the editor fills it in.
 *
 * Seeded empty rather than seeded with a default placement, because a
 * placement the user never chose is not a placement — `integrations: {}`
 * renders nothing and the generated code warns by name, which is the honest
 * state between "installed" and "positioned".
 */
export function ensureConfigFile(projectRoot: string): { path: string; created: boolean } {
  const path = join(projectRoot, CONFIG_FILE);
  if (existsSync(path)) return { path, created: false };
  writeConfig(projectRoot, { version: CONFIG_VERSION, integrations: {} });
  return { path, created: true };
}

export {
  AD_SIZE_LIMITS,
  boxToLayout,
  isAnchor,
  normalizeLayout,
  resolveAdBox,
  validateLayout,
  type AdAnchor,
  type AdBox,
  type AdContainer,
  type AdLayout,
};