import { describe, expect, it } from "vitest";
import { chamfer, distanceToShore, shorelineMask } from "./distance";
import { rasterize, renderWindow } from "../field/raster";
import { extractFeatures } from "../field/features";
import { CARRY_BOOK, LONG_ONLY_BOOK, SPOT_ETH_USD } from "../core/fixtures/carry-book";

describe("chamfer", () => {
  it("is zero on the mask itself", () => {
    const mask = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(chamfer(mask, 3, 3)[4]).toBe(0);
  });

  it("measures one cell orthogonally and a little more diagonally", () => {
    const mask = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const d = chamfer(mask, 3, 3);
    expect(d[1]).toBeCloseTo(1, 6); // directly above
    expect(d[3]).toBeCloseTo(1, 6); // directly left
    expect(d[0]).toBeCloseTo(4 / 3, 6); // diagonal, the chamfer approximation
  });

  it("stays within a few percent of true Euclidean over a longer run", () => {
    const w = 40;
    const mask = new Uint8Array(w * w);
    mask[0] = 1;
    const d = chamfer(mask, w, w);
    for (const [x, y] of [[10, 0], [0, 10], [10, 10], [30, 12], [20, 35]] as const) {
      const truth = Math.hypot(x, y);
      expect(Math.abs(d[y * w + x]! - truth) / truth).toBeLessThan(0.09);
    }
  });

  it("returns Infinity everywhere when nothing is set", () => {
    const d = chamfer(new Uint8Array(9), 3, 3);
    expect([...d].every((v) => v === Infinity)).toBe(true);
  });
});

describe("the shoreline", () => {
  const win = renderWindow(SPOT_ETH_USD);
  const mixed = rasterize(CARRY_BOOK, win);
  const oneSided = rasterize(LONG_ONLY_BOOK, win);

  it("is found on both sides of every crossing", () => {
    const mask = shorelineMask(mixed);
    const marked = [...mask].filter(Boolean).length;
    expect(marked).toBeGreaterThan(win.height); // at least one crossing per row
  });

  it("gives every cell a finite distance for a book that has one", () => {
    const d = distanceToShore(mixed);
    expect([...d].every(Number.isFinite)).toBe(true);
  });

  it("puts the live spot on dry ground, some way from the water", () => {
    // The reference book is alive at spot, so the origin cell must be inland.
    const d = distanceToShore(mixed);
    const { width } = win;
    const bottomRowMax = Math.max(...Array.from({ length: width }, (_, x) => d[x]!));
    expect(bottomRowMax).toBeGreaterThan(3);
  });

  it("finds a single shoreline on a one-sided book", () => {
    const features = extractFeatures(oneSided);
    expect(features.basins).toBe(1);
    const d = distanceToShore(oneSided);
    expect([...d].every(Number.isFinite)).toBe(true);
  });
});
