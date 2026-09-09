import { describe, expect, it } from "vitest";
import { Band } from "./terrain";
import { GENERATED_TOTAL, SHORE_FRAMES, WATER_FRAMES, interiorIndex, shoreIndex, transitionIndex, waterIndex } from "./tileset";

describe("generated tileset indices", () => {
  it("gives every water frame, interior, transition and shore frame its own index, packed below the total", () => {
    const seen = new Set<number>();
    for (const band of [Band.ABYSS, Band.DEEP, Band.SHALLOW]) for (let f = 0; f < WATER_FRAMES; f++) for (let v = 0; v < 3; v++) seen.add(waterIndex(band, f, v));
    for (const band of [Band.COAST, Band.GRASS, Band.FOREST, Band.MOUNTAIN, Band.SNOW]) for (let v = 0; v < 4; v++) seen.add(interiorIndex(band, v));
    for (let lo = 0; lo < 7; lo++) for (let m = 1; m < 15; m++) seen.add(transitionIndex(lo as Band, m));
    for (let f = 1; f < SHORE_FRAMES; f++) for (let m = 1; m < 15; m++) seen.add(shoreIndex(m, f));
    expect(seen.size).toBe(72 + 20 + 98 + 42);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(GENERATED_TOTAL - 1);
  });

  it("uses the base shore transition as frame zero of the shore animation", () => {
    expect(shoreIndex(5, 0)).toBe(transitionIndex(Band.SHALLOW, 5));
    expect(shoreIndex(5, SHORE_FRAMES)).toBe(shoreIndex(5, 0));
  });

  it("treats a water interior as frame zero of its band", () => {
    expect(interiorIndex(Band.ABYSS, 0)).toBe(waterIndex(Band.ABYSS, 0, 0));
    expect(interiorIndex(Band.DEEP, 1)).toBe(waterIndex(Band.DEEP, 0, 1));
    expect(interiorIndex(Band.SHALLOW, 2)).toBe(waterIndex(Band.SHALLOW, 0, 2));
  });
});
