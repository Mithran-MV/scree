import { describe, expect, it } from "vitest";
import { Band } from "@/game/terrain";
import { BAND_WORDS, MATERIALS, dwellTicks, grainOf, priceTicks } from "./pixel";

describe("the plate's palette", () => {
  it("has a material and a word for every band, darker under water than on the crest", () => {
    for (let b = Band.ABYSS; b <= Band.SNOW; b++) {
      expect(MATERIALS[b as Band]).toBeDefined();
      expect(BAND_WORDS[b as Band]).toMatch(/\w/);
    }
    const lum = (b: Band) => MATERIALS[b].base.r + MATERIALS[b].base.g + MATERIALS[b].base.b;
    expect(lum(Band.ABYSS)).toBeLessThan(lum(Band.SHALLOW));
    expect(lum(Band.SHALLOW)).toBeLessThan(lum(Band.SNOW));
  });

  it("dithers on a 4×4 Bayer cell", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(grainOf(x, y));
    expect(seen.size).toBe(16);
    expect(grainOf(4, 4)).toBe(grainOf(0, 0));
  });
});

describe("the plate's scale", () => {
  it("labels prices on round steps inside the window", () => {
    const ticks = priceTicks(1600, 6400);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks[0]).toBeGreaterThanOrEqual(1600);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(6400);
    expect(ticks).toContain(2000);
    expect(ticks.every((t) => t % 500 === 0 || t % 1000 === 0)).toBe(true);
  });

  it("copes with a narrow window and refuses a broken one", () => {
    expect(priceTicks(2400, 2800).length).toBeGreaterThan(2);
    expect(priceTicks(10, 5)).toEqual([]);
    expect(priceTicks(0, 5)).toEqual([]);
  });

  it("labels dwell in whole days", () => {
    expect(dwellTicks(30)).toEqual([0, 10, 20, 30]);
    expect(dwellTicks(10)).toEqual([0, 5, 10]);
  });
});
