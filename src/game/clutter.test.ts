import { describe, expect, it } from "vitest";
import { bracket } from "@/core/bracket";
import { CARRY_BOOK, SPOT_ETH_USD } from "@/core/fixtures/carry-book";
import { fittedWindow, rasterize } from "@/field/raster";
import { Band, buildTerrainGrid, isWater } from "./terrain";
import { planClutter } from "./clutter";

const br = bracket(CARRY_BOOK, 0);
const win = fittedWindow(SPOT_ETH_USD, br.lower, br.upper);
const grid = buildTerrainGrid(rasterize(CARRY_BOOK, win), CARRY_BOOK, SPOT_ETH_USD);
const blocked = (tx: number, ty: number) => tx === 10 && ty === 10;
const plan = planClutter(grid, blocked);

describe("planClutter", () => {
  it("is deterministic", () => {
    expect(planClutter(grid, blocked)).toEqual(plan);
  });

  it("populates the land without standing in water, on a transition, or on blocked ground", () => {
    expect(plan.length).toBeGreaterThan(grid.cols * grid.rows * 0.05);
    for (const p of plan) {
      const t = grid.tiles[p.ty * grid.cols + p.tx]!;
      expect(isWater(t.lo)).toBe(false);
      expect(t.mask).toBe(0);
      expect(blocked(p.tx, p.ty)).toBe(false);
      expect(p.ox).toBeGreaterThanOrEqual(0.2);
      expect(p.ox).toBeLessThanOrEqual(0.8);
    }
  });

  it("keeps each kind to its biome", () => {
    for (const p of plan) {
      const band = grid.tiles[p.ty * grid.cols + p.tx]!.lo;
      if (p.kind === "tree") expect(band).toBe(Band.GRASS);
      if (p.kind === "pine") expect(band).toBe(Band.FOREST);
      if (p.kind === "driftwood") expect(band).toBe(Band.COAST);
      if (p.kind === "peak") expect(band).toBe(Band.MOUNTAIN);
      if (p.kind === "snowpeak") expect(band).toBe(Band.SNOW);
      if (p.kind === "crystal") expect([Band.MOUNTAIN, Band.SNOW]).toContain(band);
    }
  });

  it("places at most one thing per tile", () => {
    const keys = new Set(plan.map((p) => `${p.tx},${p.ty}`));
    expect(keys.size).toBe(plan.length);
  });
});
