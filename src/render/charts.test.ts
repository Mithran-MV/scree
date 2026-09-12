import { describe, expect, it } from "vitest";
import { barPath, cliffBelowSpot, cumulativePaid, ticks, utilisation } from "./charts";

describe("chart arithmetic", () => {
  it("makes clean ticks that reach the maximum", () => {
    const t = ticks(0.83, 4);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(0.83);
    expect(t.length).toBeLessThanOrEqual(7);
    expect(ticks(0)).toEqual([0]);
  });

  it("reads utilisation and the cliff as fractions, and refuses nonsense", () => {
    expect(utilisation(4.44e9, 5.33e9)).toBeCloseTo(0.833, 2);
    expect(utilisation(0, 1.44e8)).toBe(0);
    expect(utilisation(5, 0)).toBe(0);
    expect(cliffBelowSpot(0.805, 0.83)).toBeCloseTo(0.0301, 3);
    expect(cliffBelowSpot(0.85, 0.86)).toBeCloseTo(0.0116, 3);
    expect(cliffBelowSpot(0.9, 0.8)).toBe(0);
    expect(cliffBelowSpot(0.8, 0)).toBe(0);
  });

  it("runs the receipts up in consensus order", () => {
    const pts = cumulativePaid([
      { consensusAt: "2026-09-11T10:00:02.000Z", amount: "4500000", sequence: 2 },
      { consensusAt: "2026-09-11T10:00:01.000Z", amount: "1500000", sequence: 1, standing: true },
      { consensusAt: "not a date", amount: "9", sequence: 3 },
    ]);
    expect(pts.map((p) => p.sequence)).toEqual([1, 2]);
    expect(pts[0]!.hbar).toBeCloseTo(0.015, 9);
    expect(pts[0]!.standing).toBe(true);
    expect(pts[1]!.hbar).toBeCloseTo(0.06, 9);
    expect(pts[1]!.paid).toBeCloseTo(0.045, 9);
  });

  it("draws a bar rounded at the data end only", () => {
    expect(barPath(10, 20, 100, 14)).toBe("M10 20 h96 a4 4 0 0 1 4 4 v6 a4 4 0 0 1 -4 4 h-96 z");
    expect(barPath(0, 0, 0, 14)).toBe("");
    expect(barPath(0, 0, 2, 14)).toMatch(/^M0 0 h0 a2 2/);
  });
});
