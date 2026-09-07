import { describe, expect, it } from "vitest";
import { extractFeatures } from "./features";
import { rasterize, windowAt } from "./raster";
import { CARRY_BOOK, LONG_ONLY_BOOK, SPOT_ETH_USD } from "../core/fixtures/carry-book";

const mixed = extractFeatures(rasterize(CARRY_BOOK, windowAt(SPOT_ETH_USD)));
const longOnly = extractFeatures(rasterize(LONG_ONLY_BOOK, windowAt(SPOT_ETH_USD)));

describe("a book holding both exposures", () => {
  it("is bound by all three deployments somewhere in the window", () => {
    expect(mixed.binders).toHaveLength(3);
  });

  it("creases twice, where the binder hands over", () => {
    expect(mixed.foldLines8).toBe(2);
  });

  it("has two basins, one on each side", () => {
    expect(mixed.basins).toBe(2);
  });

  it("has a pass with drowned ground on both sides of it", () => {
    expect(mixed.pass).not.toBeNull();
    expect(mixed.boundaryPass).toBe(true);
    // The analytic crest is at 4156.79. The raster quantises price into 256
    // log-spaced columns, about 0.55% apart, so agreement to within one column
    // is exact agreement; anything tighter would be asserting the grid.
    const columnWidth = mixed.pass!.price * (Math.pow(4, 1 / 255) - 1);
    expect(Math.abs(mixed.pass!.price - 4156.79)).toBeLessThan(columnWidth);
    expect(mixed.pass!.elevation).toBeGreaterThan(0.1);
    expect(mixed.pass!.elevation).toBeLessThan(0.2);
  });

  it("is not monotone in price, so it is terrain and not a ramp", () => {
    expect(mixed.crestMonotone).toBe(false);
    expect(mixed.monoFraction).toBeGreaterThan(0.5);
    expect(mixed.monoFraction).toBeLessThan(0.8);
  });
});

describe("a one-sided book", () => {
  it("is a ramp, and reports itself as one", () => {
    expect(longOnly.crestMonotone).toBe(true);
    expect(longOnly.monoFraction).toBe(1);
  });

  it("has a single basin and no pass to speak of", () => {
    expect(longOnly.basins).toBe(1);
    expect(longOnly.boundaryPass).toBe(false);
  });

  it("still creases once, because two long legs hand over to each other", () => {
    expect(longOnly.foldLines8).toBe(1);
  });
});

describe("dwell drift", () => {
  it("is reported in fractional columns rather than rounded to zero", () => {
    // Interest accrual is real but small. The honest thing is to measure it and
    // print it, not to claim the axis bends the terrain.
    expect(mixed.drift.lowerShorelineColumns).toBeGreaterThan(0);
    expect(mixed.drift.lowerShorelineColumns).toBeLessThan(5);
    expect(mixed.drift.upperShorelineColumns).toBeLessThan(5);
  });
});
