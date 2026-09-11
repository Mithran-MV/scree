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

/**
 * ETH, and the tokens that are ETH wearing a receipt.
 *
 * A liquid staking or restaking token moves with ETH, so a wallet that supplies
 * rsETH and borrows WETH is not short ETH, whatever the symbols say; counting
 * the receipt as off-axis collateral would draw that loop as a cliff at the
 * first pump. Every member is converted to ETH units at its own price against
 * the charted spot, so a wstETH at a premium counts for more than one ETH.
 */
export const ETH: ChartedAsset = {
  label: "ETH",
  addresses: [
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH mainnet
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH arbitrum
    "0x4200000000000000000000000000000000000006", // WETH base and optimism
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WETH polygon
    "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab", // WETH.e avalanche
  ],
  symbols: [
    "WETH", "ETH", "WETH.e",
    "stETH", "wstETH", "weETH", "eETH", "rETH", "cbETH", "osETH", "rsETH", "wrsETH",
    "ezETH", "ETHx", "sfrxETH", "frxETH", "mETH", "swETH", "pufETH", "wOETH",
    "ankrETH", "LsETH", "ynETH", "uniETH", "rzETH", "sETH2",
  ],
};

export function isCharted(market: Market, asset: ChartedAsset): boolean {
  const addr = market.token.address.toLowerCase();
  if (asset.addresses.some((a) => a.toLowerCase() === addr)) return true;
  return asset.symbols.some((s) => s.toLowerCase() === market.token.symbol.toLowerCase());
}

/** Whether a market is the charted asset itself, not a receipt for it. */
function isBare(market: Market, asset: ChartedAsset): boolean {
  const addr = market.token.address.toLowerCase();
  if (asset.addresses.some((a) => a.toLowerCase() === addr)) return true;
  const sym = market.token.symbol.toLowerCase();
  return sym === asset.label.toLowerCase() || sym === `w${asset.label.toLowerCase()}`;
}

/**
 * The charted asset's spot price, as the wallet's own legs report it.
 *
 * Bare WETH markets are trusted first. Failing those, the cheapest member of
 * the family is taken, since receipts trade at a premium to the thing they
 * receipt for. Null when the wallet touches nothing in the family.
 */
export function spotFromLegs(legs: readonly WalletLeg[], asset: ChartedAsset = ETH): number | null {
  const bare = legs.filter((l) => isBare(l.market, asset) && l.market.inputTokenPriceUSD > 0);
  if (bare.length) return median(bare.map((l) => l.market.inputTokenPriceUSD));
  const family = legs.filter((l) => isCharted(l.market, asset) && l.market.inputTokenPriceUSD > 0);
  if (family.length) return Math.min(...family.map((l) => l.market.inputTokenPriceUSD));
  return null;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
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
  spotUSD: number | null = null,
): Basket[] {
  const byDeployment = new Map<string, Basket>();
  const rateWeights = new Map<string, { supply: number; borrow: number }>();
  const spot = spotUSD ?? spotFromLegs(legs, asset);

  /** A charted leg in units of the charted asset, whatever receipt it is held as. */
  const units = (leg: WalletLeg): number => {
    if (isBare(leg.market, asset) || spot === null || leg.market.inputTokenPriceUSD <= 0) {
      return leg.quantity;
    }
    return (leg.quantity * leg.market.inputTokenPriceUSD) / spot;
  };

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
      if (charted) basket.a += units(leg) * threshold;
      else basket.c += usd * threshold;
      // Rates are averaged by USD weight, so a dust position cannot drag the
      // deployment's accrual around.
      basket.rs += leg.market.supplyRate * usd;
      weights.supply += usd;
    } else {
      if (charted) basket.u += units(leg);
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
