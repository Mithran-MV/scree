import { describe, expect, it } from "vitest";
import {
  bindingDeployment,
  dwellYears,
  elasticity,
  elevation,
  exposure,
  healthFactor,
  liquidationPrice,
  walletShape,
} from "./kernel";
import { CARRY_BOOK, LONG_ONLY_BOOK } from "./fixtures/carry-book";
import type { Basket } from "./types";

const [AAVE, SPARK, COMPOUND] = CARRY_BOOK as [Basket, Basket, Basket];

describe("liquidationPrice", () => {
  it("matches the hand-computed price for a pure long leg", () => {
    // 17,000 USDT of debt against 6 WETH at a 0.825 threshold.
    expect(liquidationPrice(AAVE, 0)).toBeCloseTo(17_000 / (6 * 0.825), 9);
    expect(liquidationPrice(AAVE, 0)).toBeCloseTo(3434.343434, 6);
  });

  it("matches the hand-computed price for an affine long leg", () => {
    // The WBTC collateral shifts the root without changing its direction.
    expect(liquidationPrice(SPARK, 0)).toBeCloseTo(3203.645833, 6);
  });

  it("matches the hand-computed price for a short leg", () => {
    // 10 WETH borrowed against 62,000 USDC at a 0.78 threshold.
    expect(liquidationPrice(COMPOUND, 0)).toBeCloseTo(4836, 9);
  });

  it("puts the health factor exactly at 1 on the root it returns", () => {
    for (const b of CARRY_BOOK) {
      const P = liquidationPrice(b, 0);
      expect(P).not.toBeNull();
      expect(healthFactor(b, P as number, 0)).toBeCloseTo(1, 10);
    }
  });

  it("still lands on 1 once dwell has moved the rates", () => {
    const t = dwellYears(30);
    for (const b of CARRY_BOOK) {
      const P = liquidationPrice(b, t);
      expect(healthFactor(b, P as number, t)).toBeCloseTo(1, 10);
    }
  });

  it("returns null for a basket carrying no debt", () => {
    const noDebt: Basket = { ...AAVE, v: 0, u: 0 };
    expect(liquidationPrice(noDebt, 0)).toBeNull();
  });
});

describe("exposure", () => {
  it("reads the sign of a*v - u*c", () => {
    expect(exposure(AAVE)).toBe("LONG");
    expect(exposure(SPARK)).toBe("LONG");
    expect(exposure(COMPOUND)).toBe("SHORT");
  });

  it("is FLAT when the charted asset appears on neither side", () => {
    expect(exposure({ ...AAVE, a: 0, c: 10_000, u: 0, v: 5_000 })).toBe("FLAT");
  });

  it("agrees with the numerical derivative of the health factor", () => {
    const h = 1e-4;
    for (const b of CARRY_BOOK) {
      const slope = (healthFactor(b, 4000 + h, 0) - healthFactor(b, 4000 - h, 0)) / (2 * h);
      const expected = exposure(b);
      if (expected === "LONG") expect(slope).toBeGreaterThan(0);
      if (expected === "SHORT") expect(slope).toBeLessThan(0);
    }
  });

  it("never changes sign across the whole rendered window", () => {
    // The direction of a basket carries no price term, so no basket can turn
    // around anywhere. All structure comes from which basket is lowest.
    for (const b of CARRY_BOOK) {
      const sign = exposure(b);
      for (let P = 1_600; P <= 6_400; P += 25) {
        const slope = healthFactor(b, P + 1e-4, 0) - healthFactor(b, P - 1e-4, 0);
        if (sign === "LONG") expect(slope).toBeGreaterThan(0);
        if (sign === "SHORT") expect(slope).toBeLessThan(0);
      }
    }
  });
});

describe("elasticity", () => {
  it("is positive for long, negative for short and zero when flat", () => {
    expect(elasticity(AAVE, 4000)).toBeGreaterThan(0);
    expect(elasticity(COMPOUND, 4000)).toBeLessThan(0);
    expect(elasticity({ ...AAVE, a: 0, c: 1, u: 0, v: 1 }, 4000)).toBe(0);
  });

  it("saturates at 1 for a pure long leg", () => {
    // All collateral is the charted asset and no debt is, so log-log slope is 1.
    expect(elasticity(AAVE, 4000)).toBeCloseTo(1, 12);
  });
});

describe("elevation and the binding deployment", () => {
  it("switches binder at the fold between the two long legs", () => {
    const fold = 3764.605263;
    expect(healthFactor(AAVE, fold, 0)).toBeCloseTo(healthFactor(SPARK, fold, 0), 8);
    expect(bindingDeployment(CARRY_BOOK, fold - 50, 0)).toBe("aave-v3-arbitrum");
    expect(bindingDeployment(CARRY_BOOK, fold + 50, 0)).toBe("spark-ethereum");
  });

  it("switches binder at the fold between the long and short sides", () => {
    const fold = 4156.79349;
    expect(healthFactor(SPARK, fold, 0)).toBeCloseTo(healthFactor(COMPOUND, fold, 0), 7);
    expect(bindingDeployment(CARRY_BOOK, fold - 50, 0)).toBe("spark-ethereum");
    expect(bindingDeployment(CARRY_BOOK, fold + 50, 0)).toBe("compound-v3-arbitrum");
  });

  it("puts the highest ground of the book on that second fold", () => {
    const crest = elevation(CARRY_BOOK, 4156.79349, 0);
    expect(crest).toBeCloseTo(0.163397, 5);
    for (const P of [3000, 3500, 3900, 4400, 5000, 5800]) {
      expect(elevation(CARRY_BOOK, P, 0)).toBeLessThan(crest);
    }
  });

  it("is underwater on both sides of the book", () => {
    expect(elevation(CARRY_BOOK, 3100, 0)).toBeLessThan(0);
    expect(elevation(CARRY_BOOK, 5200, 0)).toBeLessThan(0);
  });
});

describe("walletShape", () => {
  it("calls a book holding both signs MIXED", () => {
    expect(walletShape(CARRY_BOOK)).toBe("MIXED");
  });

  it("calls a one-sided book LONG-ONLY", () => {
    expect(walletShape(LONG_ONLY_BOOK)).toBe("LONG-ONLY");
  });

  it("rises monotonically across the whole window when the book is one-sided", () => {
    // A long-only book has no ridge and no pass. The map must be a ramp.
    let previous = -Infinity;
    for (let P = 1_600; P <= 6_400; P += 25) {
      const z = elevation(LONG_ONLY_BOOK, P, 0);
      expect(z).toBeGreaterThan(previous);
      previous = z;
    }
  });

  it("calls an empty book DEGENERATE", () => {
    expect(walletShape([])).toBe("DEGENERATE");
  });
});
