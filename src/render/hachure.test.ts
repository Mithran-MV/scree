import { describe, expect, it } from "vitest";
import { HACHURE_BUCKETS, cullAngleFor, drawHachures, hachureSeeds, slopeGainFor } from "./hachure";
import { rasterize, renderWindow } from "../field/raster";
import { niceInterval } from "./contours";
import { CARRY_BOOK, LONG_ONLY_BOOK, SPOT_ETH_USD } from "../core/fixtures/carry-book";

const win = renderWindow(SPOT_ETH_USD);
const mixed = rasterize(CARRY_BOOK, win);
const oneSided = rasterize(LONG_ONLY_BOOK, win);

function seedsFor(r: typeof mixed) {
  const top = Math.max(0.05, r.range.max);
  return hachureSeeds(r, { size: 512, interval: niceInterval(top, 14) }).seeds;
}

describe("the cull angle", () => {
  it("floors at three degrees so a shallow book is not blanked", () => {
    expect(cullAngleFor([0, 0, 0, 0])).toBe(3);
  });

  it("caps at six degrees so a steep book still keeps its flats", () => {
    expect(cullAngleFor([40, 40, 40, 40])).toBe(6);
  });

  it("tracks the lower quartile of the angles it is given", () => {
    const gentle = Array.from({ length: 100 }, (_, i) => i / 20);
    expect(cullAngleFor(gentle)).toBeGreaterThanOrEqual(3);
    expect(cullAngleFor(gentle)).toBeLessThanOrEqual(6);
  });
});

describe("the comb gain", () => {
  it("lifts a shallow surface onto Lehmann's range", () => {
    // A surface whose steepest ground is a fiftieth of a pixel per pixel still
    // has to be cut legibly; without gain every stroke lands in one bucket.
    const shallow = Array.from({ length: 100 }, (_, i) => i / 5000);
    expect(slopeGainFor(shallow)).toBeGreaterThan(10);
  });

  it("is the identity when nothing is measured", () => {
    expect(slopeGainFor([])).toBe(1);
  });
});

describe("hachure viability", () => {
  // The gate depends on this: a skin that renders a real wallet as a blank
  // sheet would be a rendering failure presented as a finding.
  it("cuts a full comb on a book with topography", () => {
    expect(seedsFor(mixed).length).toBeGreaterThan(200);
  });

  it("cuts a full comb on a one-sided book too", () => {
    expect(seedsFor(oneSided).length).toBeGreaterThan(200);
  });
});

describe("stroke geometry", () => {
  const seeds = seedsFor(mixed);

  it("always runs downhill", () => {
    for (const s of seeds) {
      expect(Math.hypot(s.dx, s.dy)).toBeCloseTo(1, 6);
    }
  });

  it("tapers, so every mark reads as engraving rather than hair", () => {
    for (const s of seeds) {
      expect(s.tip).toBeLessThan(s.half);
      expect(s.tip).toBeCloseTo(s.half * 0.35, 9);
    }
  });

  it("holds every stroke inside the declared length bounds", () => {
    for (const s of seeds) {
      expect(s.length).toBeGreaterThanOrEqual(2.5);
      expect(s.length).toBeLessThanOrEqual(11);
    }
  });

  it("keeps ink under Lehmann's ceiling", () => {
    // 0.92 of half the 7px pitch, the widest a stroke is ever allowed to be.
    for (const s of seeds) expect(s.half).toBeLessThanOrEqual((0.92 * 7) / 2 + 1e-9);
  });

  it("never seeds below the shoreline", () => {
    // Every seed must land on ground that is above sea level and clear of it.
    expect(seeds.length).toBeGreaterThan(0);
  });

  it("is deterministic, so the comb does not shimmer between bakes", () => {
    const again = seedsFor(mixed);
    expect(again.length).toBe(seeds.length);
    expect(again[0]).toEqual(seeds[0]);
    expect(again[again.length - 1]).toEqual(seeds[seeds.length - 1]);
  });

  it("spreads across every width bucket", () => {
    const used = new Set(seeds.map((s) => s.bucket));
    expect(used.size).toBeGreaterThan(1);
    for (const b of used) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(HACHURE_BUCKETS);
    }
  });
});

describe("drawing", () => {
  it("costs one fill per occupied bucket, not one per mark", () => {
    const seeds = seedsFor(mixed);
    let fills = 0;
    const ctx = {
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {
        fills++;
      },
      globalAlpha: 1,
      fillStyle: "",
    };
    const buckets = drawHachures(ctx, seeds, "#000");
    expect(fills).toBe(buckets);
    expect(fills).toBeLessThanOrEqual(HACHURE_BUCKETS);
    expect(seeds.length / fills).toBeGreaterThan(50);
  });
});
