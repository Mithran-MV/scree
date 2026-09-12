import { describe, expect, it } from "vitest";
import { CARRY_BOOK, SPOT_ETH_USD } from "./fixtures/carry-book";
import { bracket } from "./bracket";
import { dwellYears, elevation } from "./kernel";
import { crashEdgeCurve, edgeScale, groundProfile, liftedEdge } from "./terrace";

describe("the ground profile", () => {
  it("runs from beyond the coast to beyond the point, and crosses sea level at the coast", () => {
    const price = SPOT_ETH_USD;
    const coast = bracket(CARRY_BOOK, dwellYears(3)).lower!;
    const profile = groundProfile(CARRY_BOOK, price, 3, coast, "LONG", 41);
    expect(profile).toHaveLength(41);
    expect(profile[0]!.price).toBeLessThan(coast);
    expect(profile[profile.length - 1]!.price).toBeGreaterThan(price);
    // below the coast the ground is under water, above it dry
    const under = profile.filter((p) => p.price < coast * 0.99);
    const dry = profile.filter((p) => p.price > coast * 1.01);
    expect(under.every((p) => p.z < 0)).toBe(true);
    expect(dry.every((p) => p.z > 0)).toBe(true);
    // and the point read is on the profile's ground
    const at = elevation(CARRY_BOOK, price, dwellYears(3));
    const near = profile.reduce((a, b) => (Math.abs(b.price - price) < Math.abs(a.price - price) ? b : a));
    expect(Math.abs(near.z - at)).toBeLessThan(0.05);
  });

  it("falls back to a window around the point where nothing binds", () => {
    const profile = groundProfile(CARRY_BOOK, 3000, 0, null, null, 11);
    expect(profile[0]!.price).toBeCloseTo(3000 * 0.85, 6);
    expect(profile[10]!.price).toBeCloseTo(3000 * 1.15, 6);
    expect(groundProfile(CARRY_BOOK, 0, 0, null, null)).toEqual([]);
  });
});

describe("the crash edge", () => {
  it("drifts only a little over thirty days of interest", () => {
    const curve = crashEdgeCurve(CARRY_BOOK, 30, 31);
    expect(curve).toHaveLength(31);
    expect(curve[0]!.t).toBe(0);
    expect(curve[30]!.t).toBe(30);
    const drift = curve[30]!.price / curve[0]!.price - 1;
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(0.01);
  });

  it("is lowered by a lift in health by the inverse ratio, and left alone without one", () => {
    const curve = crashEdgeCurve(CARRY_BOOK, 30, 4);
    const lifted = liftedEdge(curve, 1.5, 0.15);
    expect(lifted[0]!.price / curve[0]!.price).toBeCloseTo(1.5 / 1.65, 9);
    expect(liftedEdge(curve, 1.5, 0)).toEqual(curve);
  });

  it("sits on a fixed scale fifteen percent either way", () => {
    expect(edgeScale(1000)).toEqual({ lo: 850, hi: 1150 });
  });
});
