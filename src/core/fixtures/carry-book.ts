import type { Basket } from "../types";

/**
 * A reference carry book, used to pin the kernel and to give the renderer a
 * wallet with real structure to draw.
 *
 * The charted asset is ETH. Two deployments are net long it and one is net
 * short it, which is the precondition for the map to hold a ridge at all.
 * Every constant below is stated so the liquidation prices can be checked by
 * hand from the formulae in `kernel.ts`.
 *
 *   Aave v3 Arbitrum   supply 6 WETH (LT 0.825)            borrow 17,000 USDT
 *   Spark Ethereum     supply 6 WETH (LT 0.80)             borrow 28,000 USDS
 *                      supply 0.153 WBTC at $110,000 (LT 0.75)
 *   Compound v3 Arbitrum supply 62,000 USDC (LT 0.78)        borrow 10 WETH
 */

const WBTC_PRICE_USD = 110_000;

export const CARRY_BOOK: Basket[] = [
  {
    deploymentId: "aave-v3-arbitrum",
    a: 6 * 0.825,
    c: 0,
    u: 0,
    v: 17_000,
    rs: 0.021,
    rb: 0.058,
  },
  {
    deploymentId: "spark-ethereum",
    a: 6 * 0.8,
    c: 0.153 * WBTC_PRICE_USD * 0.75,
    u: 0,
    v: 28_000,
    rs: 0.019,
    rb: 0.064,
  },
  {
    deploymentId: "compound-v3-arbitrum",
    a: 0,
    c: 62_000 * 0.78,
    u: 10,
    v: 0,
    rs: 0.043,
    rb: 0.027,
  },
];

/** A one-sided book, which must render an honest ramp and no ridge. */
export const LONG_ONLY_BOOK: Basket[] = [CARRY_BOOK[0]!, CARRY_BOOK[1]!];

/** Spot price of the charted asset used by the fixtures. */
export const SPOT_ETH_USD = 4_000;
