import { describe, expect, it } from "vitest";
import {
  normalizeMarket,
  normalizeResponse,
  normalizeSide,
  percentToRatio,
  toTokenUnits,
  type RawMarket,
  type RawResponse,
} from "./normalize";

const RAW_WETH: RawMarket = {
  id: "0xweth",
  name: "Aave v3 WETH",
  liquidationThreshold: "82.5",
  maximumLTV: "80",
  inputTokenPriceUSD: "4000.1234",
  inputToken: { id: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
  rates: [
    { side: "LENDER", type: "VARIABLE", rate: "2.1" },
    { side: "BORROWER", type: "STABLE", rate: "9.9" },
    { side: "BORROWER", type: "VARIABLE", rate: "5.8" },
  ],
};

describe("percentToRatio", () => {
  it("divides a percentage by a hundred", () => {
    expect(percentToRatio("82.5")).toBeCloseTo(0.825, 12);
    expect(percentToRatio("5.8")).toBeCloseTo(0.058, 12);
  });

  it("leaves a value already on a 0..1 scale alone", () => {
    // Some deployments publish ratios. Dividing those again would put every
    // liquidation price out by a factor of a hundred, silently.
    expect(percentToRatio("0.825")).toBeCloseTo(0.825, 12);
    expect(percentToRatio(1)).toBe(1);
  });

  it("returns zero rather than NaN for junk", () => {
    expect(percentToRatio("")).toBe(0);
    expect(percentToRatio("n/a")).toBe(0);
  });
});

describe("toTokenUnits", () => {
  it("scales out of base units", () => {
    expect(toTokenUnits("6000000000000000000", 18)).toBeCloseTo(6, 12);
    expect(toTokenUnits("17000000000", 6)).toBeCloseTo(17_000, 9);
  });

  it("handles 8-decimal tokens", () => {
    expect(toTokenUnits("15300000", 8)).toBeCloseTo(0.153, 12);
  });
});

describe("normalizeMarket", () => {
  const m = normalizeMarket(RAW_WETH, "aave-v3-arbitrum");

  it("puts thresholds and rates on a 0..1 scale", () => {
    expect(m.liquidationThreshold).toBeCloseTo(0.825, 12);
    expect(m.maximumLTV).toBeCloseTo(0.8, 12);
    expect(m.supplyRate).toBeCloseTo(0.021, 12);
  });

  it("prefers the variable borrow rate over the stable one", () => {
    // A stable-rate row exists on some deployments and does not describe what
    // an idle borrow actually accrues.
    expect(m.borrowRate).toBeCloseTo(0.058, 12);
  });

  it("keeps the token address, which is how the charted asset is matched", () => {
    expect(m.token.address).toBe("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  });
});

describe("normalizeSide", () => {
  it("reads every spelling of supplied", () => {
    expect(normalizeSide("LENDER")).toBe("SUPPLY");
    expect(normalizeSide("COLLATERAL")).toBe("SUPPLY");
    expect(normalizeSide("lender")).toBe("SUPPLY");
  });

  it("treats anything else as borrowed", () => {
    expect(normalizeSide("BORROWER")).toBe("BORROW");
  });
});

describe("normalizeResponse", () => {
  it("returns nothing for an address the deployment has never seen", () => {
    const empty: RawResponse = { account: null, _meta: { block: { number: 1 } } };
    expect(normalizeResponse(empty, "aave-v3-arbitrum")).toEqual([]);
  });

  it("produces legs the reducer can fold", () => {
    const res: RawResponse = {
      account: {
        id: "0xabc",
        positions: [
          { id: "p1", side: "LENDER", balance: "6000000000000000000", market: RAW_WETH },
        ],
      },
      _meta: { block: { number: 21_884_102 } },
    };
    const legs = normalizeResponse(res, "aave-v3-arbitrum");
    expect(legs).toHaveLength(1);
    expect(legs[0]!.side).toBe("SUPPLY");
    expect(legs[0]!.quantity).toBeCloseTo(6, 12);
    expect(legs[0]!.market.liquidationThreshold).toBeCloseTo(0.825, 12);
  });
});
