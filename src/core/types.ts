/**
 * Domain types for Scree.
 *
 * Everything downstream reduces to a `Basket` per lending deployment: four
 * numbers plus two rates. The map is a function of price and dwell over the
 * set of baskets a wallet holds.
 */

/** An ERC-20 as identified by a Standardized subgraph. */
export interface TokenRef {
  symbol: string;
  address: string;
  decimals: number;
}

/** A lending protocol deployment on one network, e.g. Aave v3 on Arbitrum. */
export interface Deployment {
  /** Stable slug used in URLs and the registry, e.g. `aave-v3-arbitrum`. */
  id: string;
  protocol: string;
  network: string;
  /** Subgraph id on the decentralised network, queried through the gateway. */
  subgraphId: string;
  /** Which Standardized schema dialect this deployment answers in. */
  dialect: SubgraphDialect;
}

export type SubgraphDialect = "messari-lending-v1" | "messari-lending-v2";

/**
 * One market inside a deployment: a single token that can be supplied and/or
 * borrowed, with the risk parameters that decide when a position dies.
 */
export interface Market {
  id: string;
  deploymentId: string;
  token: TokenRef;
  /** Collateral factor at which liquidation becomes possible. 0..1. */
  liquidationThreshold: number;
  /** Maximum loan-to-value at open. 0..1. Not used by the kernel; shown in UI. */
  maximumLTV: number;
  inputTokenPriceUSD: number;
  /** Continuously-compounded supply APR as a decimal, e.g. 0.031. */
  supplyRate: number;
  /** Continuously-compounded borrow APR as a decimal. */
  borrowRate: number;
}

/** A wallet's balance in one market, in whole token units. */
export interface PositionLeg {
  marketId: string;
  side: "SUPPLY" | "BORROW";
  quantity: number;
}

/** Everything a wallet holds, across every deployment we could see. */
export interface Portfolio {
  address: string;
  legs: PositionLeg[];
  /** Block height per deployment at read time, so the map can cite its source. */
  blockHeights: Record<string, number>;
}

/**
 * A deployment's position reduced against one charted asset.
 *
 * With `P` the price of the charted asset and `t` the dwell in years:
 *
 *   HF(P, t) = ((a * P + c) * exp(rs * t)) / ((u * P + v) * exp(rb * t))
 *
 * `a` and `c` are already multiplied by their liquidation thresholds, so the
 * numerator is threshold-weighted collateral in USD and the denominator is
 * plain debt in USD.
 */
export interface Basket {
  deploymentId: string;
  /** Charted asset supplied, in token units, times its liquidation threshold. */
  a: number;
  /** All other collateral in USD, each already threshold-weighted. */
  c: number;
  /** Charted asset borrowed, in token units. */
  u: number;
  /** All other debt in USD. */
  v: number;
  /** Aggregate supply rate for this deployment's collateral. */
  rs: number;
  /** Aggregate borrow rate for this deployment's debt. */
  rb: number;
}

/**
 * How a basket responds to the charted asset's price.
 *
 * LONG  — price up is safer (supply the asset, borrow something else)
 * SHORT — price up is more dangerous (borrow the asset against something else)
 * FLAT  — the asset does not appear on either side, or cancels exactly
 */
export type Exposure = "LONG" | "SHORT" | "FLAT";

/** The shape of a whole wallet, which decides whether the map has topography. */
export type WalletShape = "LONG-ONLY" | "SHORT-ONLY" | "MIXED" | "DEGENERATE";
