import { describe, expect, it } from "vitest";
import { LAND_BANDS, SEA_BANDS, biomeColor, rampAt } from "./biome";

const flat = { ceiling: 0.2, seaDatum: 0.5, steepness: 0 };

describe("the biome ramp", () => {
  it("lands exactly on its stops", () => {
    expect(rampAt(LAND_BANDS, 0)).toEqual(LAND_BANDS[0]!.color);
    expect(rampAt(LAND_BANDS, 1)).toEqual(LAND_BANDS[LAND_BANDS.length - 1]!.color);
    expect(rampAt(SEA_BANDS, 1)).toEqual(SEA_BANDS[SEA_BANDS.length - 1]!.color);
  });

  it("clamps rather than running off either end", () => {
    expect(rampAt(LAND_BANDS, -5)).toEqual(LAND_BANDS[0]!.color);
    expect(rampAt(LAND_BANDS, 5)).toEqual(LAND_BANDS[LAND_BANDS.length - 1]!.color);
  });
});

describe("biomeColor", () => {
  it("returns float components a vertex buffer can take", () => {
    for (const z of [-0.4, -0.01, 0, 0.05, 0.19]) {
      for (const v of biomeColor({ z, ...flat })) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("goes green in the middle altitudes and white at the top", () => {
    const [, meadowG] = biomeColor({ z: 0.05, ...flat });
    const [snowR, snowG, snowB] = biomeColor({ z: 0.2, ...flat });
    expect(meadowG).toBeGreaterThan(0.4);
    expect(Math.min(snowR, snowG, snowB)).toBeGreaterThan(0.85);
  });

  it("darkens with depth below the waterline", () => {
    let previous = 9;
    for (let z = 0; z >= -0.5; z -= 0.05) {
      const sum = biomeColor({ z, ...flat }).reduce((a, b) => a + b, 0);
      expect(sum).toBeLessThanOrEqual(previous + 1e-9);
      previous = sum;
    }
  });

  it("turns steep ground to stone at the same altitude", () => {
    const gentle = biomeColor({ z: 0.1, ...flat, steepness: 0.1 });
    const steep = biomeColor({ z: 0.1, ...flat, steepness: 1 });
    expect(steep).not.toEqual(gentle);
    // Stone is less green than pasture at the same height.
    expect(steep[1]).toBeLessThan(gentle[1]);
  });

  it("leaves gentle ground alone entirely", () => {
    expect(biomeColor({ z: 0.1, ...flat, steepness: 0.3 })).toEqual(
      biomeColor({ z: 0.1, ...flat, steepness: 0 }),
    );
  });

  it("never puts rock underwater", () => {
    expect(biomeColor({ z: -0.2, ...flat, steepness: 1 })).toEqual(
      biomeColor({ z: -0.2, ...flat, steepness: 0 }),
    );
  });
});
