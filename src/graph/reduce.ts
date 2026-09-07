import type { Basket, Market } from "../core/types";

/** One market balance a wallet holds, with the market's risk parameters. */
export interface WalletLeg {
  deploymentId: string;
  market: Market;
  side: "SUPPLY" | "BORROW";
  /** Whole token units, already scaled out of the market's decimals. */
  quantity: number;
}

/**
 * Which token the map's price axis is about.
 *
 * Matched on address first, because symbols collide across networks and a
 * bridged asset can call itself anything. Symbols are a fallback for chains
 * where the registry has not been given an address yet.
 */
export interface ChartedAsset {
  label: string;
  addresses: readonly string[];
  symbols: readonly string[];
}

export const ETH: ChartedAsset = {
  label: "ETH",
  addresses: [
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH mainnet
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH arbitrum
    "0x4200000000000000000000000000000000000006", // WETH base and optimism
  ],
  symbols: ["WETH", "ETH", "weETH", "wstETH"],
};

function isCharted(market: Market, asset: ChartedAsset): boolean {
  const addr = market.token.address.toLowerCase();
  if (asset.addresses.some((a) => a.toLowerCase() === addr)) return true;
  return asset.symbols.some((s) => s.toLowerCase() === market.token.symbol.toLowerCase());
}

/**
 * Fold a wallet's raw balances into one basket per deployment.
 *
 * The split is the whole trick. Collateral and debt each divide into the part
 * that moves with the charted asset and the part that does not, and those four
 * numbers are all the terrain needs. Everything the wallet holds is kept: a
 * position in an unrelated token still counts, it just lands in `c` or `v`
 * where it shifts the ground without tilting it.
 */
export function reduceToBaskets(
  legs: readonly WalletLeg[],
  asset: ChartedAsset = ETH,
): Basket[] {
  const byDeployment = new Map<string, Basket>();
  const rateWeights = new Map<string, { supply: number; borrow: number }>();

  for (const leg of legs) {
    if (leg.quantity <= 0) continue;

    let basket = byDeployment.get(leg.deploymentId);
    if (!basket) {
      basket = { deploymentId: leg.deploymentId, a: 0, c: 0, u: 0, v: 0, rs: 0, rb: 0 };
      byDeployment.set(leg.deploymentId, basket);
      rateWeights.set(leg.deploymentId, { supply: 0, borrow: 0 });
    }
    const weights = rateWeights.get(leg.deploymentId)!;
    const charted = isCharted(leg.market, asset);
    const usd = leg.quantity * leg.market.inputTokenPriceUSD;

    if (leg.side === "SUPPLY") {
      const threshold = leg.market.liquidationThreshold;
      if (charted) basket.a += leg.quantity * threshold;
      else basket.c += usd * threshold;
      // Rates are averaged by USD weight, so a dust position cannot drag the
      // deployment's accrual around.
      basket.rs += leg.market.supplyRate * usd;
      weights.supply += usd;
    } else {
      if (charted) basket.u += leg.quantity;
      else basket.v += usd;
      basket.rb += leg.market.borrowRate * usd;
      weights.borrow += usd;
    }
  }

  for (const [id, basket] of byDeployment) {
    const w = rateWeights.get(id)!;
    basket.rs = w.supply > 0 ? basket.rs / w.supply : 0;
    basket.rb = w.borrow > 0 ? basket.rb / w.borrow : 0;
  }

  // A deployment with no debt cannot liquidate and would only flatten the
  // minimum, so it is dropped rather than drawn as infinite ground.
  return [...byDeployment.values()].filter((b) => b.u > 0 || b.v > 0);
}

/**
 * Collateral the wallet holds in a token the price axis does not describe.
 *
 * The map must warn about this rather than quietly folding it into `c`, since
 * a wallet whose real risk is a BTC move will look calm on an ETH axis.
 */
export function offAxisCollateralUSD(
  legs: readonly WalletLeg[],
  asset: ChartedAsset = ETH,
): number {
  let total = 0;
  for (const leg of legs) {
    if (leg.side !== "SUPPLY") continue;
    if (isCharted(leg.market, asset)) continue;
    if (isStable(leg.market)) continue;
    total += leg.quantity * leg.market.inputTokenPriceUSD;
  }
  return total;
}

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "USDS", "USDC.E", "FRAX", "LUSD", "GHO"]);

function isStable(market: Market): boolean {
  return STABLE_SYMBOLS.has(market.token.symbol.toUpperCase());
}
