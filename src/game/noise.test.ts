import { describe, expect, it } from "vitest";
import { fbm, simplex2 } from "./noise";

describe("simplex noise", () => {
  it("is deterministic for a seed and stays in range", () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const x = (i % 50) * 0.37;
      const y = Math.floor(i / 50) * 0.41;
      const v = simplex2(x, y, 7);
      expect(v).toBe(simplex2(x, y, 7));
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(0.8);
  });

  it("changes with the seed", () => {
    expect(simplex2(1.3, 2.7, 1)).not.toBe(simplex2(1.3, 2.7, 2));
  });

  it("sums octaves back into range", () => {
    for (let i = 0; i < 500; i++) {
      const v = fbm(i * 0.13, i * 0.07, 3, 3);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
