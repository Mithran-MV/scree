import type { Market } from "../core/types";
import type { WalletLeg } from "./reduce";

/**
 * Raw shapes as the Standardized schema returns them. Every numeric field
 * arrives as a string, and the ratio fields arrive as percentages, which is the
 * single most common way to get a liquidation price wrong by a factor of 100.
 */
export interface RawPosition {
  id: string;
  side: string;
  balance: string;
  market: RawMarket;
}

export interface RawMarket {
  id: string;
  name?: string;
  liquidationThreshold: string;
  maximumLTV: string;
  inputTokenPriceUSD: string;
  inputToken: { id: string; symbol: string; decimals: number };
  rates: { side: string; type: string; rate: string }[];
}

export interface RawResponse {
  account: { id: string; positions: RawPosition[] } | null;
  /** The deployment's own price for the charted asset, from its largest WETH market. */
  spot?: { inputTokenPriceUSD: string }[];
  _meta: { block: { number: number } };
}

/** The deployment's price for the charted asset, or null if it has no such market. */
export function spotOf(res: RawResponse): number | null {
  const raw = res.spot?.[0]?.inputTokenPriceUSD;
  if (raw === undefined) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Percentages to ratios.
 *
 * `liquidationThreshold` and every `rate` come back on a 0..100 scale. A
 * threshold of 82.5 means 0.825, and a rate of 5.8 means 0.058. Anything above
 * 1 is therefore a percentage; anything at or below 1 is already a ratio and is
 * left alone, so a subgraph that has already normalised is not divided twice.
 */
export function percentToRatio(value: string | number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

/** Token base units to whole units. Balances arrive as integer strings. */
export function toTokenUnits(balance: string, decimals: number): number {
  const n = Number.parseFloat(balance);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** decimals;
}

function rateOf(raw: RawMarket, side: "LENDER" | "BORROWER"): number {
  // Prefer a variable rate; a stable-rate row exists on some deployments and
  // does not describe what an idle position actually accrues.
  const candidates = raw.rates.filter((r) => r.side === side);
  const variable = candidates.find((r) => r.type === "VARIABLE");
  const chosen = variable ?? candidates[0];
  return chosen ? percentToRatio(chosen.rate) : 0;
}

export function normalizeMarket(raw: RawMarket, deploymentId: string): Market {
  return {
    id: raw.id,
    deploymentId,
    token: {
      symbol: raw.inputToken.symbol,
      address: raw.inputToken.id,
      decimals: raw.inputToken.decimals,
    },
    liquidationThreshold: percentToRatio(raw.liquidationThreshold),
    maximumLTV: percentToRatio(raw.maximumLTV),
    inputTokenPriceUSD: Number.parseFloat(raw.inputTokenPriceUSD) || 0,
    supplyRate: rateOf(raw, "LENDER"),
    borrowRate: rateOf(raw, "BORROWER"),
  };
}

/** `LENDER` and `COLLATERAL` both mean supplied; everything else is borrowed. */
export function normalizeSide(side: string): "SUPPLY" | "BORROW" {
  const s = side.toUpperCase();
  return s === "LENDER" || s === "COLLATERAL" || s === "SUPPLIER" ? "SUPPLY" : "BORROW";
}

export function normalizeResponse(res: RawResponse, deploymentId: string): WalletLeg[] {
  if (!res.account) return [];
  return res.account.positions.map((p) => ({
    deploymentId,
    market: normalizeMarket(p.market, deploymentId),
    side: normalizeSide(p.side),
    quantity: toTokenUnits(p.balance, p.market.inputToken.decimals),
  }));
}
