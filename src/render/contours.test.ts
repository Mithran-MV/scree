import { describe, expect, it } from "vitest";
import { contour, contourSet } from "./contours";
import { rasterize, windowAt, priceAt } from "../field/raster";
import { CARRY_BOOK, LONG_ONLY_BOOK, SPOT_ETH_USD } from "../core/fixtures/carry-book";

const mixed = rasterize(CARRY_BOOK, windowAt(SPOT_ETH_USD));
const ramp = rasterize(LONG_ONLY_BOOK, windowAt(SPOT_ETH_USD));

describe("contour", () => {
  it("draws a shoreline where the terrain crosses zero", () => {
    const shore = contour(mixed, 0);
    expect(shore.segments.length).toBeGreaterThan(0);
  });

  it("puts the one-sided book's shoreline at its liquidation price", () => {
    const shore = contour(ramp, 0);
    const columns = shore.segments.map((s) => (s.x1 + s.x2) / 2);
    const mean = columns.reduce((a, b) => a + b, 0) / columns.length;
    // Aave binds at 3434.34 and is the higher of the two long roots.
    expect(priceAt(ramp.window, mean)).toBeCloseTo(3434.34, -2);
  });

  it("gives the mixed book two shorelines and the ramp one", () => {
    const columnsOf = (r: typeof mixed) => {
      const row = 0;
      const seg = contour(r, 0).segments.filter((s) => Math.min(s.y1, s.y2) <= row + 1);
      return new Set(seg.map((s) => Math.round((s.x1 + s.x2) / 2 / 8)));
    };
    expect(columnsOf(mixed).size).toBeGreaterThanOrEqual(2);
    expect(columnsOf(ramp).size).toBe(1);
  });

  it("emits nothing for a level the terrain never reaches", () => {
    expect(contour(mixed, 99).segments).toHaveLength(0);
  });

  it("keeps every segment inside the raster", () => {
    for (const s of contour(mixed, 0.05).segments) {
      for (const x of [s.x1, s.x2]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(mixed.window.width - 1);
      }
      for (const y of [s.y1, s.y2]) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(mixed.window.height - 1);
      }
    }
  });
});

describe("contourSet", () => {
  it("always includes the shoreline first", () => {
    expect(contourSet(mixed)[0]!.level).toBe(0);
  });

  it("covers levels above and below sea level", () => {
    const levels = contourSet(mixed, 0.1).map((c) => c.level);
    expect(levels.some((l) => l > 0)).toBe(true);
    expect(levels.some((l) => l < 0)).toBe(true);
  });
});
