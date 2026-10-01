/**
 * Ad geometry: bounded size, anchor-based position, contained by its host.
 *
 * This module is deliberately pure. It reads a size and a position, plus the
 * measured box of the element the ad lives in, and returns the pixel box the
 * ad should occupy. Nothing here touches the DOM, so every rule below --
 * clamping, anchoring, containment -- is directly testable without a browser
 * and without a layout engine.
 *
 * Two properties matter more than anything else here:
 *
 * 1. The SDK owns the safety boundary. A caller can ask for any size and any
 *    offset; the ad still cannot overflow its container, because the resolved
 *    box is intersected with the container box before it is returned.
 * 2. No page coordinates. There is no `position: fixed`, no viewport offset and
 *    no way to name an arbitrary ancestor. An anchor plus an offset inside the
 *    host is the entire vocabulary.
 */

/** Every magic number for ad geometry lives here, and nowhere else. */
export const AD_SIZE_LIMITS = {
  /** Below this an ad is unreadable, so we refuse to make one. */
  minWidth: 120,
  minHeight: 60,
  /** Above this an ad is a page, not an ad. The ceiling is well under a
   *  viewport so a full-width leaderboard still leaves the page around it. */
  maxWidth: 1280,
  maxHeight: 1024,
  /** Used when a caller omits a size, or supplies something unusable. */
  defaultWidth: 320,
  defaultHeight: 100,
  /** Largest magnitude accepted for offsetX/offsetY. Beyond this the offset
   *  is a positioning bug rather than a nudge, so it is clamped. */
  maxOffset: 512,
} as const;

export const AD_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type AdAnchor = (typeof AD_ANCHORS)[number];

export type AdSize = {
  width: number;
  height: number;
};

export type AdPosition = {
  anchor: AdAnchor;
  offsetX: number;
  offsetY: number;
};

/** What a caller passes. Every field is optional and every field is
 *  normalised, so a partial or malformed object still renders something sane. */
export type AdLayoutInput = {
  size?: Partial<AdSize> | null;
  position?: Partial<AdPosition> | null;
};

/** The resolved pixel box, relative to the host element's top-left corner. */
export type AdBox = {
  width: number;
  height: number;
  left: number;
  top: number;
};

/** The host's own size, as measured by the caller. */
export type AdContainer = {
  width: number;
  height: number;
};

const isAnchor = (value: unknown): value is AdAnchor =>
  typeof value === "string" && (AD_ANCHORS as readonly string[]).includes(value);

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/**
 * Coerce one caller-supplied length.
 *
 * Non-numbers, `NaN` and infinities are not "close enough" to a number to be
 * worth guessing at, so they fall back to the default. Real numbers -- however
 * absurd -- are clamped, because a caller asking for 99999px meant "as big as
 * possible" far more often than they meant an exact value.
 */
function length(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(clamp(value, min, max));
}

const offset = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(clamp(value, -AD_SIZE_LIMITS.maxOffset, AD_SIZE_LIMITS.maxOffset))
    : 0;

/**
 * Resolve a requested size.
 *
 * Always returns something renderable: no negative width, no NaN, no
 * fraction, nothing larger than the ceiling.
 */
export function normalizeAdSize(size?: Partial<AdSize> | null): AdSize {
  const { minWidth, minHeight, maxWidth, maxHeight, defaultWidth, defaultHeight } = AD_SIZE_LIMITS;
  return {
    width: length(size?.width, defaultWidth, minWidth, maxWidth),
    height: length(size?.height, defaultHeight, minHeight, maxHeight),
  };
}

/**
 * Resolve a requested position.
 *
 * An unknown anchor is not an error -- it degrades to `center`, which is the
 * least surprising thing to render when we cannot tell what was meant.
 */
export function normalizeAdPosition(position?: Partial<AdPosition> | null): AdPosition {
  return {
    anchor: isAnchor(position?.anchor) ? position.anchor : "center",
    offsetX: offset(position?.offsetX),
    offsetY: offset(position?.offsetY),
  };
}

/**
 * Work out the free space for an anchored pair.
 *
 * An anchor is `vertical-horizontal`, and the two words are independent:
 * `bottom-left` is at the bottom and at the left, `center-right` is
 * vertically centred and at the right. Matching on substrings would conflate
 * the axes -- `center-left` contains "center", so a substring rule would pin it
 * horizontally centred and put it in the wrong place. So the name is split and
 * each axis is read from its own word, with the bare `center` handled first
 * because it is the only anchor that carries no axis word at all.
 */
function anchorOrigin(anchor: AdAnchor, freeX: number, freeY: number): { x: number; y: number } {
  if (anchor === "center") return { x: freeX / 2, y: freeY / 2 };
  const [vertical, horizontal] = anchor.split("-");
  const x = horizontal === "center" ? freeX / 2 : horizontal === "right" ? freeX : 0;
  const y = vertical === "center" ? freeY / 2 : vertical === "bottom" ? freeY : 0;
  return { x, y };
}

/**
 * Resolve the final box for an ad inside a host.
 *
 * The order matters and is the whole safety story:
 *
 * 1. normalise the request, so the numbers are already sane;
 * 2. shrink to fit the host, so a container smaller than the request cannot
 *    overflow -- this is the responsive behaviour, and it degrades the ad
 *    rather than clipping it;
 * 3. anchor inside whatever free space is left;
 * 4. apply the offsets;
 * 5. pull the result back inside the host, so no offset -- however large, and
 *    in either direction -- can push the ad out of its container.
 *
 * Steps 2 and 5 are what make the SDK, not the caller, responsible for
 * containment. Step 5 also guarantees `left`/`top` are never negative and never
 * exceed the host, which is what keeps the ad out of the surrounding layout.
 */
export function resolveAdBox(
  layout: AdLayoutInput | null | undefined,
  container: AdContainer,
): AdBox {
  const size = normalizeAdSize(layout?.size);
  const position = normalizeAdPosition(layout?.position);

  /* A host that has not been measured yet, or was measured as zero, cannot
   * be centred or offset inside: there is no space to be relative to. Treat
   * its free space as zero so the ad pins to the host's top-left corner
   * instead of resolving to `Infinity`. */
  const measuredWidth = Number.isFinite(container?.width) && (container?.width ?? 0) > 0
    ? (container.width as number)
    : null;
  const measuredHeight = Number.isFinite(container?.height) && (container?.height ?? 0) > 0
    ? (container.height as number)
    : null;

  /* Containment outranks the readability minimum. A host narrower than
   * `minWidth` still gets an ad that fits inside it, because an ad that
   * overflows its container is the one outcome we must never produce. So the
   * ceiling is the smaller of the configured maximum and the host itself. */
  const capWidth = measuredWidth === null
    ? AD_SIZE_LIMITS.maxWidth
    : Math.min(AD_SIZE_LIMITS.maxWidth, measuredWidth);
  const capHeight = measuredHeight === null
    ? AD_SIZE_LIMITS.maxHeight
    : Math.min(AD_SIZE_LIMITS.maxHeight, measuredHeight);

  const width = Math.max(0, Math.min(size.width, capWidth));
  const height = Math.max(0, Math.min(size.height, capHeight));

  const freeX = measuredWidth === null ? 0 : measuredWidth - width;
  const freeY = measuredHeight === null ? 0 : measuredHeight - height;

  const origin = anchorOrigin(position.anchor, freeX, freeY);
  const left = clamp(origin.x + position.offsetX, 0, freeX);
  const top = clamp(origin.y + position.offsetY, 0, freeY);

  return { width, height, left, top };
}

/** The inline styles for a box. Kept here so the DOM layer stays trivial. */
export function adBoxStyle(box: AdBox): Record<string, string> {
  return {
    position: "absolute",
    width: `${box.width}px`,
    height: `${box.height}px`,
    left: `${box.left}px`,
    top: `${box.top}px`,
  };
}
