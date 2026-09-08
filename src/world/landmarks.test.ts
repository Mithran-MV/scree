import { describe, expect, it } from "vitest";
import { findLandmarks } from "./landmarks";
import { rasterize, renderWindow } from "../field/raster";
import { extractFeatures } from "../field/features";
import { CARRY_BOOK, LONG_ONLY_BOOK, SPOT_ETH_USD } from "../core/fixtures/carry-book";

const win = renderWindow(SPOT_ETH_USD);
const mixed = rasterize(CARRY_BOOK, win);

describe("landmarks", () => {
  const marks = findLandmarks(mixed);

  it("plants one per deployment that binds anywhere", () => {
    expect(marks).toHaveLength(extractFeatures(mixed).binders.length);
    expect(marks.map((m) => m.deploymentId).sort()).toEqual(
      [...CARRY_BOOK.map((b) => b.deploymentId)].sort(),
    );
  });

  it("puts every marker inside the field", () => {
    for (const m of marks) {
      expect(m.col).toBeGreaterThanOrEqual(0);
      expect(m.col).toBeLessThan(win.width);
      expect(m.row).toBeGreaterThanOrEqual(0);
      expect(m.row).toBeLessThan(win.height);
    }
  });

  it("stands each marker on the highest ground of its own territory", () => {
    const { width } = win;
    for (const m of marks) {
      const index = mixed.deploymentIds.indexOf(m.deploymentId);
      let highest = -Infinity;
      for (let i = 0; i < mixed.z.length; i++) {
        if (mixed.argmin[i] === index && mixed.z[i]! > highest) highest = mixed.z[i]!;
      }
      expect(m.elevation).toBeCloseTo(highest, 12);
      expect(mixed.argmin[m.row * width + m.col]).toBe(index);
    }
  });

  it("orders them by how much of the map each one owns", () => {
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i - 1]!.share).toBeGreaterThanOrEqual(marks[i]!.share);
    }
    expect(marks.reduce((s, m) => s + m.share, 0)).toBeCloseTo(1, 6);
  });

  it("plants fewer on a book with fewer binders", () => {
    const oneSided = findLandmarks(rasterize(LONG_ONLY_BOOK, win));
    expect(oneSided.length).toBeLessThan(marks.length);
    expect(oneSided.length).toBeGreaterThan(0);
  });
});
