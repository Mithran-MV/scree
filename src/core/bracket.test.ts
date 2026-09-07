import { describe, expect, it } from "vitest";
import { bracket, closedFormCrest, isPureLeg } from "./bracket";
import { elevation } from "./kernel";
import { CARRY_BOOK, LONG_ONLY_BOOK } from "./fixtures/carry-book";
import type { Basket } from "./types";

const [AAVE, SPARK, COMPOUND] = CARRY_BOOK as [Basket, Basket, Basket];

describe("bracket", () => {
  it("takes the highest long root and the lowest short root", () => {
    const b = bracket(CARRY_BOOK, 0);
    expect(b.lower).toBeCloseTo(3434.343434, 6); // Aave, above Spark's 3203.65
    expect(b.lowerBinder).toBe("aave-v3-arbitrum");
    expect(b.upper).toBeCloseTo(4836, 9);
    expect(b.upperBinder).toBe("compound-v3-base");
  });

  it("has no upper bound for a long-only book", () => {
    const b = bracket(LONG_ONLY_BOOK, 0);
    expect(b.lower).toBeCloseTo(3434.343434, 6);
    expect(b.upper).toBeNull();
  });
});

describe("closedFormCrest", () => {
  it("is exact for a book of two pure legs, and sits on the geometric mean", () => {
    const pureBook = [AAVE, COMPOUND];
    const crest = closedFormCrest(pureBook, 0);
    expect(crest).not.toBeNull();
    expect(crest!.exact).toBe(true);
    expect(crest!.price).toBeCloseTo(Math.sqrt(3434.343434 * 4836), 6);
    expect(crest!.price).toBeCloseTo(4075.350887, 6);
    expect(crest!.elevation).toBeCloseTo(Math.sqrt(4836 / 3434.343434) - 1, 9);
  });

  it("agrees with the sampled terrain wherever it claims to be exact", () => {
    const pureBook = [AAVE, COMPOUND];
    const crest = closedFormCrest(pureBook, 0)!;
    expect(elevation(pureBook, crest.price, 0)).toBeCloseTo(crest.elevation, 9);
    expect(elevation(pureBook, crest.price - 80, 0)).toBeLessThan(crest.elevation);
    expect(elevation(pureBook, crest.price + 80, 0)).toBeLessThan(crest.elevation);
  });

  it("declares itself inexact once an affine leg is in the book", () => {
    const crest = closedFormCrest(CARRY_BOOK, 0)!;
    expect(crest.exact).toBe(false);
    // And it is genuinely wrong here: the real crest is on the Spark/Compound
    // fold at 4156.79, not on the geometric mean of the bracket.
    expect(crest.price).toBeCloseTo(4075.350887, 5);
    expect(elevation(CARRY_BOOK, 4156.79349, 0)).toBeGreaterThan(
      elevation(CARRY_BOOK, crest.price, 0),
    );
  });

  it("returns null when the book has only one side", () => {
    expect(closedFormCrest(LONG_ONLY_BOOK, 0)).toBeNull();
  });
});

describe("isPureLeg", () => {
  it("separates pure legs from affine ones", () => {
    expect(isPureLeg(AAVE)).toBe(true);
    expect(isPureLeg(COMPOUND)).toBe(true);
    expect(isPureLeg(SPARK)).toBe(false); // WBTC collateral makes it affine
  });
});
