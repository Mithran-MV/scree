import { describe, expect, it } from "vitest";
import { Band } from "./terrain";
import { GENERATED_TOTAL, interiorIndex, transitionIndex, waterIndex } from "./tileset";

describe("generated tileset indices", () => {
  it("gives every water frame, interior and transition its own index, packed below the total", () => {
    const seen = new Set<number>();
    for (let frame = 0; frame < 2; frame++) for (let v = 0; v < 3; v++) seen.add(waterIndex(frame, v));
    for (const band of [Band.COAST, Band.GRASS, Band.HIGHLAND, Band.MOUNTAIN]) for (let v = 0; v < 3; v++) seen.add(interiorIndex(band, v));
    for (const lo of [Band.WATER, Band.COAST, Band.GRASS, Band.HIGHLAND]) for (let mask = 1; mask < 15; mask++) seen.add(transitionIndex(lo, mask));
    expect(seen.size).toBe(6 + 12 + 56);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(GENERATED_TOTAL - 1);
  });
});
