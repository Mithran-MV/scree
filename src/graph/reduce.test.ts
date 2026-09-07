import { describe, expect, it } from "vitest";
import { ETH, offAxisCollateralUSD, reduceToBaskets, type WalletLeg } from "./reduce";
import { CARRY_BOOK } from "../core/fixtures/carry-book";
import type { Market } from "../core/types";

function market(over: Partial<Market> & { symbol: string }): Market {
  const { symbol, ...rest } = over;
  return {
    id: `m-${symbol}`,
    deploymentId: "x",
    token: { symbol, address: `0x${symbol.toLowerCase().padEnd(40, "0")}`, decimals: 18 },
    liquidationThreshold: 0.8,
    maximumLTV: 0.75,
    inputTokenPriceUSD: 1,
    supplyRate: 0,
    borrowRate: 0,
    ...rest,
  };
}

/** The same book as the fixture, expressed the way a subgraph would return it. */
const LEGS: WalletLeg[] = [
  {
    deploymentId: "aave-v3-arbitrum",
    market: market({ symbol: "WETH", liquidationThreshold: 0.825, inputTokenPriceUSD: 4000, supplyRate: 0.021 }),
    side: "SUPPLY",
    quantity: 6,
  },
  {
    deploymentId: "aave-v3-arbitrum",
    market: market({ symbol: "USDT", borrowRate: 0.058 }),
    side: "BORROW",
    quantity: 17_000,
  },
  {
    deploymentId: "spark-ethereum",
    market: market({ symbol: "WETH", liquidationThreshold: 0.8, inputTokenPriceUSD: 4000, supplyRate: 0.019 }),
    side: "SUPPLY",
    quantity: 6,
  },
  {
    deploymentId: "spark-ethereum",
    market: market({ symbol: "WBTC", liquidationThreshold: 0.75, inputTokenPriceUSD: 110_000, supplyRate: 0.019 }),
    side: "SUPPLY",
    quantity: 0.153,
  },
  {
    deploymentId: "spark-ethereum",
    market: market({ symbol: "USDS", borrowRate: 0.064 }),
    side: "BORROW",
    quantity: 28_000,
  },
  {
    deploymentId: "compound-v3-base",
    market: market({ symbol: "USDC", liquidationThreshold: 0.78, supplyRate: 0.043 }),
    side: "SUPPLY",
    quantity: 62_000,
  },
  {
    deploymentId: "compound-v3-base",
    market: market({ symbol: "WETH", inputTokenPriceUSD: 4000, borrowRate: 0.027 }),
    side: "BORROW",
    quantity: 10,
  },
];

describe("reduceToBaskets", () => {
  const baskets = reduceToBaskets(LEGS);

  it("reproduces the reference carry book exactly", () => {
    expect(baskets).toHaveLength(CARRY_BOOK.length);
    for (const expected of CARRY_BOOK) {
      const got = baskets.find((b) => b.deploymentId === expected.deploymentId);
      expect(got, expected.deploymentId).toBeDefined();
      expect(got!.a).toBeCloseTo(expected.a, 10);
      expect(got!.c).toBeCloseTo(expected.c, 10);
      expect(got!.u).toBeCloseTo(expected.u, 10);
      expect(got!.v).toBeCloseTo(expected.v, 10);
      expect(got!.rs).toBeCloseTo(expected.rs, 10);
      expect(got!.rb).toBeCloseTo(expected.rb, 10);
    }
  });

  it("weights collateral by its liquidation threshold, not its face value", () => {
    const aave = baskets.find((b) => b.deploymentId === "aave-v3-arbitrum")!;
    expect(aave.a).toBeCloseTo(6 * 0.825, 12);
    expect(aave.a).not.toBeCloseTo(6, 3);
  });

  it("puts non-charted collateral in c and non-charted debt in v", () => {
    const spark = baskets.find((b) => b.deploymentId === "spark-ethereum")!;
    expect(spark.c).toBeCloseTo(0.153 * 110_000 * 0.75, 8);
    expect(spark.v).toBeCloseTo(28_000, 8);
    expect(spark.u).toBe(0);
  });

  it("averages rates by USD weight so dust cannot drag accrual", () => {
    const dusted = reduceToBaskets([
      ...LEGS,
      {
        deploymentId: "aave-v3-arbitrum",
        market: market({ symbol: "LINK", inputTokenPriceUSD: 0.0001, supplyRate: 5 }),
        side: "SUPPLY",
        quantity: 1,
      },
    ]);
    const aave = dusted.find((b) => b.deploymentId === "aave-v3-arbitrum")!;
    expect(aave.rs).toBeCloseTo(0.021, 6);
  });

  it("drops a deployment that carries no debt, since it cannot liquidate", () => {
    const supplyOnly = reduceToBaskets([LEGS[0]!]);
    expect(supplyOnly).toHaveLength(0);
  });

  it("matches the charted asset by address as well as by symbol", () => {
    const byAddress: WalletLeg[] = [
      {
        deploymentId: "d",
        market: {
          ...market({ symbol: "SOMETHING-BRIDGED", liquidationThreshold: 0.8 }),
          token: {
            symbol: "SOMETHING-BRIDGED",
            address: "0x82AF49447D8a07e3bd95BD0d56f35241523fBab1",
            decimals: 18,
          },
        },
        side: "SUPPLY",
        quantity: 1,
      },
      { deploymentId: "d", market: market({ symbol: "USDC" }), side: "BORROW", quantity: 100 },
    ];
    expect(reduceToBaskets(byAddress, ETH)[0]!.a).toBeCloseTo(0.8, 10);
  });
});

describe("offAxisCollateralUSD", () => {
  it("counts volatile collateral the price axis does not describe", () => {
    // The WBTC in Spark. A wallet whose real risk is a BTC move must not look
    // calm just because it is being drawn on an ETH axis.
    expect(offAxisCollateralUSD(LEGS)).toBeCloseTo(0.153 * 110_000, 6);
  });

  it("does not count stablecoin collateral, which does not move", () => {
    expect(
      offAxisCollateralUSD([
        { deploymentId: "d", market: market({ symbol: "USDC" }), side: "SUPPLY", quantity: 5_000 },
        { deploymentId: "d", market: market({ symbol: "WETH" }), side: "BORROW", quantity: 1 },
      ]),
    ).toBe(0);
  });
});
