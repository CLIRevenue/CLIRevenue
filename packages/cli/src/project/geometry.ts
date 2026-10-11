/**
 * Ad geometry, mirrored from `@clirevenue/sdk`.
 *
 * This module is a deliberate, self-contained copy of the SDK's layout
 * vocabulary (`packages/sdk/src/layout.ts`). It is duplicated rather than
 * imported because the CLI is a separate npm package that must run in a
 * consumer's project *before* — and sometimes entirely without — the SDK
 * being installed, and it must not add `@clirevenue/sdk` as a dependency of
 * its own.
 *
 * The duplication is the whole point of the constraint it obeys: the editor
 * saves `{ size, position }` in exactly the shape `CLIRevenue.render()`
 * accepts, so what the user drags is what the SDK will later resolve. A
 * different shape here would mean the editor was a disconnected demo.
 *
 * The vocabulary is deliberately tiny, and it is the SDK's, not ours:
 * an anchor, two offsets, a width and a height. There are no page
 * coordinates, no `position: fixed`, and no way to name an arbitrary
 * ancestor, because the SDK intersects every resolved box with its host and
 * the ad can therefore never escape its container.
 */

/** Every magic number for ad geometry lives here, and nowhere else. */
export const AD_SIZE_LIMITS = {
  minWidth: 120,
  minHeight: 60,
  maxWidth: 1280,
  maxHeight: 1024,
  defaultWidth: 320,
  defaultHeight: 100,
  maxOffset: 512,
} as const;

export const AD_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export type AdAnchor = (typeof AD_ANCHORS)[number];

export interface AdSize {
  width: number;
  height: number;
}

export interface AdPosition {
  anchor: AdAnchor;
  offsetX: number;
  offsetY: number;
}

/** The exact shape `CLIRevenue.render(placementKey, selector, layout)` takes. */
export interface AdLayout {
  size: AdSize;
  position: AdPosition;
}

export interface AdBox {
  width: number;
  height: number;
  left: number;
  top: number;
}

export interface AdContainer {
  width: number;
  height: number;
}

export const isAnchor = (value: unknown): value is AdAnchor =>
  typeof value === 'string' && (AD_ANCHORS as readonly string[]).includes(value);

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

function length(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(clamp(value, min, max));
}

const offset = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(clamp(value, -AD_SIZE_LIMITS.maxOffset, AD_SIZE_LIMITS.maxOffset))
    : 0;

export function normalizeAdSize(size?: Partial<AdSize> | null): AdSize {
  const { minWidth, minHeight, maxWidth, maxHeight, defaultWidth, defaultHeight } = AD_SIZE_LIMITS;
  return {
    width: length(size?.width, defaultWidth, minWidth, maxWidth),
    height: length(size?.height, defaultHeight, minHeight, maxHeight),
  };
}

export function normalizeAdPosition(position?: Partial<AdPosition> | null): AdPosition {
  return {
    anchor: isAnchor(position?.anchor) ? position.anchor : 'center',
    offsetX: offset(position?.offsetX),
    offsetY: offset(position?.offsetY),
  };
}

export function normalizeLayout(layout?: Partial<AdLayout> | null): AdLayout {
  return {
    size: normalizeAdSize(layout?.size),
    position: normalizeAdPosition(layout?.position),
  };
}

/**
 * The origin an anchor names, inside whatever free space the ad has left.
 *
 * Split on the axis words rather than substring-matched, because
 * `center-left` contains `center`: a substring rule pins it horizontally
 * centred and drops it in the wrong place.
 */
function anchorOrigin(anchor: AdAnchor, freeX: number, freeY: number): { x: number; y: number } {
  if (anchor === 'center') return { x: freeX / 2, y: freeY / 2 };
  const [vertical, horizontal] = anchor.split('-');
  const x = horizontal === 'center' ? freeX / 2 : horizontal === 'right' ? freeX : 0;
  const y = vertical === 'center' ? freeY / 2 : vertical === 'bottom' ? freeY : 0;
  return { x, y };
}

/** Where the user asked the ad to sit, in absolute host coordinates. */
function applyOffsets(origin: { x: number; y: number }, position: AdPosition): { x: number; y: number } {
  return { x: origin.x + position.offsetX, y: origin.y + position.offsetY };
}

/**
 * Resolve a requested size against a host.
 *
 * Identical in effect to the SDK's `resolveAdBox`: the host, when measured,
 * outranks the configured maximum. An ad that overflows its container is the
 * one outcome the SDK must never produce, so a host smaller than the request
 * gets an ad that fits inside it.
 */
function resolveSize(size: AdSize, container: AdContainer): { width: number; height: number } {
  const measuredWidth =
    Number.isFinite(container?.width) && (container?.width ?? 0) > 0 ? container.width : null;
  const measuredHeight =
    Number.isFinite(container?.height) && (container?.height ?? 0) > 0 ? container.height : null;

  const capWidth =
    measuredWidth === null ? AD_SIZE_LIMITS.maxWidth : Math.min(AD_SIZE_LIMITS.maxWidth, measuredWidth);
  const capHeight =
    measuredHeight === null
      ? AD_SIZE_LIMITS.maxHeight
      : Math.min(AD_SIZE_LIMITS.maxHeight, measuredHeight);

  return {
    width: Math.max(0, Math.min(size.width, capWidth)),
    height: Math.max(0, Math.min(size.height, capHeight)),
  };
}

/**
 * Resolve the final pixel box, exactly as the SDK will resolve it.
 *
 * Order: normalise, shrink to fit the host, anchor in the free space, apply
 * the offsets, then pull the result back inside the host so no offset can
 * ever push the ad out.
 */
export function resolveAdBox(layout: Partial<AdLayout> | null | undefined, container: AdContainer): AdBox {
  const normalized = normalizeLayout(layout);
  const { width, height } = resolveSize(normalized.size, container);

  const measuredWidth =
    Number.isFinite(container?.width) && (container?.width ?? 0) > 0 ? container.width : null;
  const measuredHeight =
    Number.isFinite(container?.height) && (container?.height ?? 0) > 0 ? container.height : null;

  const freeX = measuredWidth === null ? 0 : measuredWidth - width;
  const freeY = measuredHeight === null ? 0 : measuredHeight - height;

  const moved = applyOffsets(anchorOrigin(normalized.position.anchor, freeX, freeY), normalized.position);

  return {
    width,
    height,
    left: clamp(moved.x, 0, freeX),
    top: clamp(moved.y, 0, freeY),
  };
}

/**
 * Translate an absolute box back into the SDK's anchor + offset vocabulary.
 *
 * This is the inverse of {@link resolveAdBox} and it is what makes the editor
 * trustworthy. The user drags a rectangle to absolute pixel coordinates; the
 * SDK does not speak absolute coordinates, so the rectangle has to be reduced
 * to the nearest anchor plus the offset needed to reach it. Choosing the
 * *nearest* anchor rather than a fixed one matters: a box dragged slightly
 * right of centre should persist as `center` with a small `offsetX`, not as
 * `center-right` with a large negative offset, so that a later responsive
 * resize still tracks the user's intent instead of jumping to an edge.
 *
 * Round-tripping a layout through this function and back is stable, which is
 * what lets the editor restore and re-save without drift.
 */
export function boxToLayout(box: AdBox, container: AdContainer): AdLayout {
  const width = Math.round(clamp(box.width, AD_SIZE_LIMITS.minWidth, AD_SIZE_LIMITS.maxWidth));
  const height = Math.round(clamp(box.height, AD_SIZE_LIMITS.minHeight, AD_SIZE_LIMITS.maxHeight));

  const measuredWidth =
    Number.isFinite(container?.width) && (container?.width ?? 0) > 0 ? container.width : null;
  const measuredHeight =
    Number.isFinite(container?.height) && (container?.height ?? 0) > 0 ? container.height : null;

  const freeX = measuredWidth === null ? 0 : Math.max(0, measuredWidth - width);
  const freeY = measuredHeight === null ? 0 : Math.max(0, measuredHeight - height);

  let best: AdAnchor = 'center';
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const anchor of AD_ANCHORS) {
    const origin = anchorOrigin(anchor, freeX, freeY);
    const dx = origin.x - clamp(box.left, 0, freeX);
    const dy = origin.y - clamp(box.top, 0, freeY);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = anchor;
    }
  }

  const origin = anchorOrigin(best, freeX, freeY);
  return {
    size: { width, height },
    position: {
      anchor: best,
      offsetX: offset(clamp(box.left, 0, freeX) - origin.x),
      offsetY: offset(clamp(box.top, 0, freeY) - origin.y),
    },
  };
}

/**
 * Human-readable failure for a layout that cannot be rendered.
 *
 * Returns `null` when the layout is usable. The editor shows this text next
 * to the offending field and refuses to save, rather than silently clamping a
 * value the user did not intend.
 */
export function validateLayout(layout: Partial<AdLayout> | null | undefined): string[] {
  const errors: string[] = [];
  const size = layout?.size;
  const position = layout?.position;

  for (const [key, value, min, max] of [
    ['Width', size?.width, AD_SIZE_LIMITS.minWidth, AD_SIZE_LIMITS.maxWidth],
    ['Height', size?.height, AD_SIZE_LIMITS.minHeight, AD_SIZE_LIMITS.maxHeight],
  ] as const) {
    if (value === undefined || value === null) {
      errors.push(`${key} is required.`);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${key} must be a number.`);
    } else if (value < min || value > max) {
      errors.push(`${key} must be between ${min} and ${max} px.`);
    }
  }

  if (position?.anchor !== undefined && !isAnchor(position.anchor)) {
    errors.push(`Anchor must be one of: ${AD_ANCHORS.join(', ')}.`);
  }

  for (const [key, value] of [
    ['Horizontal offset', position?.offsetX],
    ['Vertical offset', position?.offsetY],
  ] as const) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${key} must be a number.`);
    } else if (Math.abs(value) > AD_SIZE_LIMITS.maxOffset) {
      errors.push(`${key} must be between -${AD_SIZE_LIMITS.maxOffset} and ${AD_SIZE_LIMITS.maxOffset} px.`);
    }
  }

  return errors;
}

/** Move the keyboard-focusable ad box without a pointer. */
export function nudge(layout: AdLayout, dx: number, dy: number, container: AdContainer): AdLayout {
  const box = resolveAdBox(layout, container);
  return boxToLayout({ ...box, left: box.left + dx, top: box.top + dy }, container);
}
