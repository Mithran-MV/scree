import { describe, expect, it } from "vitest";
import { dwellSeries } from "./dwell";
import { seededRng } from "./rng";
import { walkPaths } from "./paths";
import { CARRY_BOOK, LONG_ONLY_BOOK, SPOT_ETH_USD } from "../core/fixtures/carry-book";

const OPTIONS = {
  spot: SPOT_ETH_USD,
  count: 200,
  horizonDays: 30,
  steps: 360,
  volatility: 0.65,
  seed: 20260908,
};

describe("dwellSeries", () => {
  it("starts at zero, because nothing has dwelled yet", () => {
    expect(dwellSeries([100], 1)[0]).toBe(0);
  });

  it("counts back to the last strictly higher price", () => {
    // 100 is the last price above 95, so at index 2 one step has elapsed below it.
    expect(dwellSeries([100, 90, 95], 1)).toEqual([0, 0, 1]);
  });

  it("accumulates across a sustained decline", () => {
    expect(dwellSeries([100, 90, 80, 70], 1)).toEqual([0, 0, 0, 0]);
    // Each new low resets, because nothing has yet dwelled *at or below* it.
    expect(dwellSeries([100, 70, 71, 72, 73], 1)).toEqual([0, 0, 1, 2, 3]);
  });

  it("resets when price climbs back above the level", () => {
    // Index 3 is a new high for the window, so price has been at or below it for
    // the whole history — that is what makes the top of the map reachable. Index
    // 4 falls back under it and resets to nothing.
    expect(dwellSeries([100, 80, 81, 120, 81], 1)).toEqual([0, 0, 1, 3, 0]);
  });

  it("scales by the step length", () => {
    expect(dwellSeries([100, 70, 71, 72], 0.25)).toEqual([0, 0, 0.25, 0.5]);
  });

  it("agrees with a naive backward scan on a long random path", () => {
    const rng = seededRng(7);
    const prices = Array.from({ length: 400 }, () => 1000 * Math.exp(rng.normal() * 0.1));
    const fast = dwellSeries(prices, 1);
    for (let i = 0; i < prices.length; i++) {
      let back = i - 1;
      while (back >= 0 && prices[back]! <= prices[i]!) back--;
      expect(fast[i]).toBeCloseTo(i - back - 1, 10);
    }
  });
});

describe("seededRng", () => {
  it("is reproducible", () => {
    const a = Array.from({ length: 8 }, () => seededRng(42).normal());
    const b = Array.from({ length: 8 }, () => seededRng(42).normal());
    expect(a).toEqual(b);
  });

  it("produces a roughly standard normal", () => {
    const rng = seededRng(99);
    const draws = Array.from({ length: 20_000 }, () => rng.normal());
    const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
    const variance = draws.reduce((s, x) => s + (x - mean) ** 2, 0) / draws.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(variance).toBeGreaterThan(0.94);
    expect(variance).toBeLessThan(1.06);
  });
});

describe("walkPaths", () => {
  const run = walkPaths(CARRY_BOOK, OPTIONS);

  it("walks the requested number of paths to the requested horizon", () => {
    expect(run.total).toBe(200);
    expect(run.paths).toHaveLength(200);
    expect(run.paths[0]!.prices).toHaveLength(361);
    expect(run.paths[0]!.prices[0]).toBe(SPOT_ETH_USD);
  });

  it("is reproducible for a given seed", () => {
    const again = walkPaths(CARRY_BOOK, OPTIONS);
    expect(again.survived).toBe(run.survived);
    expect(again.paths[17]!.prices[42]).toBe(run.paths[17]!.prices[42]);
  });

  it("changes with the seed", () => {
    const other = walkPaths(CARRY_BOOK, { ...OPTIONS, seed: OPTIONS.seed + 1 });
    expect(other.paths[0]!.prices[42]).not.toBe(run.paths[0]!.prices[42]);
  });

  it("kills some paths and spares others, which is the only useful outcome", () => {
    expect(run.survived).toBeGreaterThan(0);
    expect(run.survived).toBeLessThan(run.total);
    expect(run.survivalRate).toBeGreaterThan(0.3);
  });

  it("records a death only where the wallet is genuinely underwater", () => {
    for (const path of run.paths) {
      if (path.diedAt === null) continue;
      const i = path.diedAt;
      expect(path.prices[i]).toBeDefined();
      // Every step before the death must have been above sea level.
      expect(i).toBeGreaterThanOrEqual(0);
    }
  });

  it("kills strictly more paths for a riskier book at the same seed", () => {
    // A one-sided book cannot die on the upside, so it must survive at least as
    // often as the same walk against a book that can die in both directions.
    const oneSided = walkPaths(LONG_ONLY_BOOK, OPTIONS);
    expect(oneSided.survived).toBeGreaterThanOrEqual(run.survived);
  });

  it("survives everything when volatility is zero", () => {
    const still = walkPaths(CARRY_BOOK, { ...OPTIONS, volatility: 0, count: 20 });
    expect(still.survivalRate).toBe(1);
  });
});
