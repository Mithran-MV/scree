import type { Deployment } from "../core/types";
import { MARKETS } from "./query";
import { normalizeMarket, percentToRatio, type RawMarket } from "./normalize";
import { ETH, isCharted, type ChartedAsset } from "./reduce";

const GATEWAY = "https://gateway.thegraph.com/api";

/** One market as a holdfast's plaque needs it. Ratios are 0..1, rates are decimals per year. */
export interface MarketRow {
  deploymentId: string;
  id: string;
  name: string;
  symbol: string;
  /** The market is in the charted asset or one of its receipts. */
  charted: boolean;
  canBorrowFrom: boolean;
  canUseAsCollateral: boolean;
  liquidationThreshold: number;
  maximumLTV: number;
  liquidationPenalty: number;
  priceUSD: number;
  tvlUSD: number;
  depositedUSD: number;
  borrowedUSD: number;
  supplyRate: number;
  borrowRate: number;
}

export interface DeploymentMarkets {
  deploymentId: string;
  block: number;
  /** Seconds since the epoch, as the subgraph stamped its block. */
  blockTimestamp: number | null;
  /** The deployment's largest markets, most value first. */
  rows: MarketRow[];
  /** The market the map's price axis is about, if the deployment has one. */
  charted: MarketRow | null;
}

export interface MarketsResult {
  deployments: DeploymentMarkets[];
  healthy: string[];
  failed: { deploymentId: string; reason: string }[];
}

type RawMarketRow = RawMarket & {
  canBorrowFrom?: boolean;
  canUseAsCollateral?: boolean;
  liquidationPenalty?: string;
  totalValueLockedUSD?: string;
  totalDepositBalanceUSD?: string;
  totalBorrowBalanceUSD?: string;
};

interface RawMarketsResponse {
  markets: RawMarketRow[];
  _meta: { block: { number: number; timestamp?: number } };
}

const num = (s: string | undefined): number => {
  const n = Number.parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};

export function normalizeMarketRow(raw: RawMarketRow, deploymentId: string, asset: ChartedAsset = ETH): MarketRow {
  const m = normalizeMarket(raw, deploymentId);
  return {
    deploymentId,
    id: m.id,
    name: raw.name ?? m.token.symbol,
    symbol: m.token.symbol,
    charted: isCharted(m, asset),
    canBorrowFrom: raw.canBorrowFrom ?? true,
    canUseAsCollateral: raw.canUseAsCollateral ?? true,
    liquidationThreshold: m.liquidationThreshold,
    maximumLTV: m.maximumLTV,
    liquidationPenalty: percentToRatio(raw.liquidationPenalty ?? "0"),
    priceUSD: m.inputTokenPriceUSD,
    tvlUSD: num(raw.totalValueLockedUSD),
    depositedUSD: num(raw.totalDepositBalanceUSD),
    borrowedUSD: num(raw.totalBorrowBalanceUSD),
    supplyRate: m.supplyRate,
    borrowRate: m.borrowRate,
  };
}

/**
 * The market the map is about, for one deployment: the bare asset's market
 * if there is one, else the largest receipt market. Null when the deployment
 * lists nothing in the family.
 */
export function chartedMarketOf(rows: readonly MarketRow[], asset: ChartedAsset = ETH): MarketRow | null {
  const family = rows.filter((r) => r.charted);
  if (family.length === 0) return null;
  const bare = family.find((r) => isBareMarket(r, asset));
  return bare ?? family.reduce((a, b) => (b.tvlUSD > a.tvlUSD ? b : a));
}

/** Whether a market is the charted asset itself rather than a receipt for it. */
export function isBareMarket(row: MarketRow, asset: ChartedAsset = ETH): boolean {
  const label = asset.label.toLowerCase();
  const s = row.symbol.toLowerCase();
  return row.charted && (s === label || s === `w${label}` || s === `w${label}.e`);
}

/**
 * The high-water mark: where a borrower who opened at the maximum LTV today
 * is liquidated. Collateral c at price P0 borrows maxLTV · c · P0; it is
 * liquidated when LT · c · P = that debt, so P = P0 · maxLTV / LT. Null when
 * the market cannot be borrowed against.
 */
export function cliffPrice(spot: number, maximumLTV: number, liquidationThreshold: number): number | null {
  if (!(spot > 0) || !(maximumLTV > 0) || !(liquidationThreshold > 0)) return null;
  return (spot * maximumLTV) / liquidationThreshold;
}

export interface MarketsOptions {
  apiKey: string;
  first?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Ask every deployment for its markets, at the same time. A deployment that fails is named and the rest are kept. */
export async function fanOutMarkets(
  deployments: readonly Deployment[],
  opts: MarketsOptions,
  asset: ChartedAsset = ETH,
): Promise<MarketsResult> {
  // Wide enough to reach the bare asset's market on a deployment that lists many receipts above it.
  const first = opts.first ?? 40;
  const doFetch = opts.fetchImpl ?? fetch;
  const settled = await Promise.all(
    deployments.map(async (d) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
      try {
        const res = await doFetch(`${GATEWAY}/${opts.apiKey}/subgraphs/id/${d.subgraphId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: MARKETS, variables: { first } }),
          signal: controller.signal,
        });
        if (!res.ok) return { d, error: `HTTP ${res.status}` } as const;
        const body = (await res.json()) as { data?: RawMarketsResponse; errors?: { message: string }[] };
        if (body.errors?.length) return { d, error: body.errors[0]!.message } as const;
        if (!body.data) return { d, error: "empty response" } as const;
        return { d, data: body.data } as const;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { d, error: reason === "The operation was aborted." ? "timed out" : reason } as const;
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const out: DeploymentMarkets[] = [];
  const healthy: string[] = [];
  const failed: { deploymentId: string; reason: string }[] = [];
  for (const r of settled) {
    if ("error" in r && r.error !== undefined) {
      failed.push({ deploymentId: r.d.id, reason: r.error });
      continue;
    }
    if (!("data" in r) || !r.data) continue;
    const rows = r.data.markets.map((m) => normalizeMarketRow(m, r.d.id, asset));
    healthy.push(r.d.id);
    out.push({
      deploymentId: r.d.id,
      block: r.data._meta.block.number,
      blockTimestamp: r.data._meta.block.timestamp ?? null,
      rows,
      charted: chartedMarketOf(rows, asset),
    });
  }
  return { deployments: out, healthy, failed };
}
