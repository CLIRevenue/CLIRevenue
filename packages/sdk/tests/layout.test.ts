import { describe, expect, it } from "vitest";
import {
  AD_ANCHORS,
  AD_SIZE_LIMITS,
  adBoxStyle,
  normalizeAdPosition,
  normalizeAdSize,
  resolveAdBox,
  type AdAnchor,
  type AdBox,
  type AdContainer,
} from "../src/layout.ts";

/* Every geometry rule is checked here without a DOM, because `layout.ts` is
 * pure on purpose. The invariant that matters more than any individual
 * expectation is the one at the bottom of this file: whatever a caller asks
 * for, the resolved box stays inside the container it was given. */

const HOST: AdContainer = { width: 1200, height: 800 };

/** The containment invariant, in one place, applied to every case. */
function expectContained(box: AdBox, container: AdContainer): void {
  expect(Number.isFinite(box.left)).toBe(true);
  expect(Number.isFinite(box.top)).toBe(true);
  expect(Number.isFinite(box.width)).toBe(true);
  expect(Number.isFinite(box.height)).toBe(true);
  expect(box.width).toBeGreaterThanOrEqual(0);
  expect(box.height).toBeGreaterThanOrEqual(0);
  if (Number.isFinite(container.width) && container.width > 0) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.left + box.width).toBeLessThanOrEqual(container.width);
  }
  if (Number.isFinite(container.height) && container.height > 0) {
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.top + box.height).toBeLessThanOrEqual(container.height);
  }
}

describe("ad size", () => {
  it("uses a documented default when no size is given", () => {
    expect(normalizeAdSize()).toEqual({
      width: AD_SIZE_LIMITS.defaultWidth,
      height: AD_SIZE_LIMITS.defaultHeight,
    });
    expect(normalizeAdSize(null)).toEqual(normalizeAdSize());
    expect(normalizeAdSize({})).toEqual(normalizeAdSize());
  });

  it("accepts a valid custom size", () => {
    expect(normalizeAdSize({ width: 728, height: 90 })).toEqual({ width: 728, height: 90 });
  });

  it("accepts the exact minimum boundary", () => {
    expect(normalizeAdSize({ width: AD_SIZE_LIMITS.minWidth, height: AD_SIZE_LIMITS.minHeight }))
      .toEqual({ width: AD_SIZE_LIMITS.minWidth, height: AD_SIZE_LIMITS.minHeight });
  });

  it("accepts the exact maximum boundary", () => {
    expect(normalizeAdSize({ width: AD_SIZE_LIMITS.maxWidth, height: AD_SIZE_LIMITS.maxHeight }))
      .toEqual({ width: AD_SIZE_LIMITS.maxWidth, height: AD_SIZE_LIMITS.maxHeight });
  });

  it("lifts a size below the minimum rather than rendering an unreadable ad", () => {
    expect(normalizeAdSize({ width: 10, height: 5 })).toEqual({
      width: AD_SIZE_LIMITS.minWidth,
      height: AD_SIZE_LIMITS.minHeight,
    });
  });

  it("caps a size above the maximum", () => {
    expect(normalizeAdSize({ width: 99999, height: 99999 })).toEqual({
      width: AD_SIZE_LIMITS.maxWidth,
      height: AD_SIZE_LIMITS.maxHeight,
    });
  });

  it("refuses zero and negative dimensions", () => {
    /* Zero and negative are finite, so they are clamped to the readable
     * minimum rather than replaced by the default -- the caller did give a
     * number, and the smallest renderable number is the best reading of it. */
    expect(normalizeAdSize({ width: 0, height: 0 })).toEqual({
      width: AD_SIZE_LIMITS.minWidth,
      height: AD_SIZE_LIMITS.minHeight,
    });
    expect(normalizeAdSize({ width: -300, height: -10 })).toEqual({
      width: AD_SIZE_LIMITS.minWidth,
      height: AD_SIZE_LIMITS.minHeight,
    });
  });

  it("refuses NaN and infinities", () => {
    expect(normalizeAdSize({ width: Number.NaN, height: Number.NaN })).toEqual(normalizeAdSize());
    expect(normalizeAdSize({ width: Number.POSITIVE_INFINITY, height: Number.NEGATIVE_INFINITY }))
      .toEqual(normalizeAdSize());
  });

  it("refuses malformed values that are not numbers at all", () => {
    const malformed = { width: "320", height: "100" } as unknown as { width: number; height: number };
    expect(normalizeAdSize(malformed)).toEqual(normalizeAdSize());
    expect(normalizeAdSize({ width: null, height: undefined } as unknown as { width: number }))
      .toEqual(normalizeAdSize());
    expect(normalizeAdSize({ width: {}, height: [] } as unknown as { width: number }))
      .toEqual(normalizeAdSize());
  });

  it("fills in the missing half of a partial size", () => {
    expect(normalizeAdSize({ width: 640 })).toEqual({
      width: 640,
      height: AD_SIZE_LIMITS.defaultHeight,
    });
    expect(normalizeAdSize({ height: 250 })).toEqual({
      width: AD_SIZE_LIMITS.defaultWidth,
      height: 250,
    });
  });

  it("rounds fractional pixels so the box stays integral", () => {
    expect(normalizeAdSize({ width: 320.4, height: 100.6 })).toEqual({ width: 320, height: 101 });
  });
});

describe("ad position", () => {
  it("defaults to the centre with no offsets", () => {
    expect(normalizeAdPosition()).toEqual({ anchor: "center", offsetX: 0, offsetY: 0 });
    expect(normalizeAdPosition(null)).toEqual(normalizeAdPosition());
  });

  it("accepts every advertised anchor", () => {
    for (const anchor of AD_ANCHORS) {
      expect(normalizeAdPosition({ anchor }).anchor).toBe(anchor);
    }
    expect(AD_ANCHORS).toHaveLength(9);
  });

  it("degrades an unknown anchor to centre instead of failing", () => {
    expect(normalizeAdPosition({ anchor: "middle-ish" as AdAnchor }).anchor).toBe("center");
    expect(normalizeAdPosition({ anchor: "" as AdAnchor }).anchor).toBe("center");
    expect(normalizeAdPosition({ anchor: 7 as unknown as AdAnchor }).anchor).toBe("center");
  });

  it("keeps positive, negative and zero offsets", () => {
    expect(normalizeAdPosition({ offsetX: 16, offsetY: -8 })).toEqual({
      anchor: "center",
      offsetX: 16,
      offsetY: -8,
    });
    expect(normalizeAdPosition({ offsetX: 0, offsetY: 0 }).offsetX).toBe(0);
  });

  it("clamps an extreme offset to the documented maximum", () => {
    const max = AD_SIZE_LIMITS.maxOffset;
    expect(normalizeAdPosition({ offsetX: 99_999 }).offsetX).toBe(max);
    expect(normalizeAdPosition({ offsetY: -99_999 }).offsetY).toBe(-max);
  });

  it("refuses malformed offsets", () => {
    const bad = { offsetX: "16", offsetY: Number.NaN } as unknown as { offsetX: number; offsetY: number };
    expect(normalizeAdPosition(bad)).toEqual({ anchor: "center", offsetX: 0, offsetY: 0 });
    expect(normalizeAdPosition({ offsetX: Number.POSITIVE_INFINITY }).offsetX).toBe(0);
  });

  it("places an ad at each anchor inside a larger host", () => {
    const container: AdContainer = { width: 1000, height: 500 };
    const size = { width: 200, height: 100 };
    const at = (anchor: AdAnchor) =>
      resolveAdBox({ size, position: { anchor } }, container);

    expect(at("top-left")).toMatchObject({ left: 0, top: 0 });
    expect(at("top-center")).toMatchObject({ left: 400, top: 0 });
    expect(at("top-right")).toMatchObject({ left: 800, top: 0 });
    expect(at("center-left")).toMatchObject({ left: 0, top: 200 });
    expect(at("center")).toMatchObject({ left: 400, top: 200 });
    expect(at("center-right")).toMatchObject({ left: 800, top: 200 });
    expect(at("bottom-left")).toMatchObject({ left: 0, top: 400 });
    expect(at("bottom-center")).toMatchObject({ left: 400, top: 400 });
    expect(at("bottom-right")).toMatchObject({ left: 800, top: 400 });
  });

  it("applies an offset from the anchored origin", () => {
    const container: AdContainer = { width: 1000, height: 500 };
    const box = resolveAdBox(
      { size: { width: 200, height: 100 }, position: { anchor: "top-left", offsetX: 16, offsetY: 16 } },
      container,
    );
    expect(box).toMatchObject({ left: 16, top: 16 });
  });
});

describe("the ad never leaves its container", () => {
  it("shrinks to fit a container smaller than the request", () => {
    const box = resolveAdBox({ size: { width: 320, height: 100 } }, { width: 200, height: 70 });
    expect(box.width).toBeLessThanOrEqual(200);
    expect(box.height).toBeLessThanOrEqual(70);
    expectContained(box, { width: 200, height: 70 });
  });

  it("shrinks below the readability minimum rather than overflowing a tiny host", () => {
    const tiny: AdContainer = { width: 80, height: 40 };
    const box = resolveAdBox({ size: { width: 320, height: 100 } }, tiny);
    expect(box.width).toBe(80);
    expect(box.height).toBe(40);
    expect(box).toMatchObject({ left: 0, top: 0 });
    expectContained(box, tiny);
  });

  it("keeps a normal request intact inside a large container", () => {
    const box = resolveAdBox({ size: { width: 320, height: 100 }, position: { anchor: "bottom-right" } }, HOST);
    expect(box).toMatchObject({ width: 320, height: 100, left: 880, top: 700 });
    expectContained(box, HOST);
  });

  it("pulls a huge request back inside a large container", () => {
    const box = resolveAdBox({ size: { width: 1280, height: 1024 } }, HOST);
    expectContained(box, HOST);
  });

  it("refuses to be pushed out by an extreme positive offset", () => {
    const box = resolveAdBox(
      { size: { width: 320, height: 100 }, position: { anchor: "top-left", offsetX: AD_SIZE_LIMITS.maxOffset, offsetY: AD_SIZE_LIMITS.maxOffset } },
      HOST,
    );
    expect(box.left + box.width).toBeLessThanOrEqual(HOST.width);
    expect(box.top + box.height).toBeLessThanOrEqual(HOST.height);
  });

  it("refuses to be pushed out by an extreme negative offset", () => {
    const box = resolveAdBox(
      { size: { width: 320, height: 100 }, position: { anchor: "bottom-right", offsetX: -AD_SIZE_LIMITS.maxOffset, offsetY: -AD_SIZE_LIMITS.maxOffset } },
      HOST,
    );
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expectContained(box, HOST);
  });

  it("resolves to finite coordinates when the host has not been measured yet", () => {
    for (const container of [
      { width: 0, height: 0 },
      { width: Number.NaN, height: Number.NaN },
      { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY },
    ]) {
      const box = resolveAdBox({ position: { anchor: "center", offsetX: 10, offsetY: 10 } }, container);
      expect(Number.isFinite(box.left)).toBe(true);
      expect(Number.isFinite(box.top)).toBe(true);
      expect(box).toMatchObject({ left: 0, top: 0 });
      expectContained(box, { width: 0, height: 0 });
    }
  });

  it("survives a malformed layout request", () => {
    const hostile = {
      size: { width: "wide", height: null },
      position: { anchor: "nowhere", offsetX: Number.NaN, offsetY: {} },
    } as unknown as Parameters<typeof resolveAdBox>[0];
    const box = resolveAdBox(hostile, HOST);
    expect(box.width).toBe(AD_SIZE_LIMITS.defaultWidth);
    expect(box.height).toBe(AD_SIZE_LIMITS.defaultHeight);
    expectContained(box, HOST);
  });

  it("keeps every advertised anchor contained across a spread of host sizes", () => {
    const hosts: AdContainer[] = [
      { width: 80, height: 40 },
      { width: 200, height: 70 },
      { width: 640, height: 480 },
      { width: 1200, height: 800 },
      { width: 3840, height: 2160 },
    ];
    for (const host of hosts) {
      for (const anchor of AD_ANCHORS) {
        for (const offsetX of [-512, -16, 0, 16, 512]) {
          for (const offsetY of [-512, -16, 0, 16, 512]) {
            const box = resolveAdBox(
              { size: { width: 320, height: 100 }, position: { anchor, offsetX, offsetY } },
              host,
            );
            expectContained(box, host);
          }
        }
      }
    }
  });
});

describe("adBoxStyle", () => {
  it("emits absolute pixel geometry and nothing else", () => {
    expect(adBoxStyle({ width: 320, height: 100, left: 16, top: 24 })).toEqual({
      position: "absolute",
      width: "320px",
      height: "100px",
      left: "16px",
      top: "24px",
    });
  });

  it("never emits a non-pixel value", () => {
    const style = adBoxStyle(resolveAdBox(undefined, { width: 0, height: 0 }));
    for (const value of Object.values(style)) {
      if (value === "absolute") continue;
      expect(value).toMatch(/^-?\d+px$/);
    }
  });
});
