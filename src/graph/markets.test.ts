import { describe, expect, it } from "vitest";
import { chartedMarketOf, cliffPrice, fanOutMarkets, normalizeMarketRow, type MarketRow } from "./markets";
import type { Deployment } from "../core/types";

const raw = (over: Record<string, unknown>) => ({
  id: "m",
  name: "Aave Ethereum WETH",
  liquidationThreshold: "83",
  maximumLTV: "80.5",
  liquidationPenalty: "5",
  inputTokenPriceUSD: "2500",
  totalValueLockedUSD: "1000000",
  totalDepositBalanceUSD: "1000000",
  totalBorrowBalanceUSD: "400000",
  inputToken: { id: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18 },
  rates: [
    { side: "LENDER", type: "VARIABLE", rate: "2.1" },
    { side: "BORROWER", type: "VARIABLE", rate: "3.4" },
  ],
  ...over,
});

describe("market rows", () => {
  it("turns the schema's percentages and strings into numbers, and knows the charted asset", () => {
    const row = normalizeMarketRow(raw({}), "aave-v3-ethereum");
    expect(row.liquidationThreshold).toBeCloseTo(0.83, 9);
    expect(row.maximumLTV).toBeCloseTo(0.805, 9);
    expect(row.liquidationPenalty).toBeCloseTo(0.05, 9);
    expect(row.borrowedUSD).toBe(400_000);
    expect(row.supplyRate).toBeCloseTo(0.021, 9);
    expect(row.borrowRate).toBeCloseTo(0.034, 9);
    expect(row.charted).toBe(true);
    expect(normalizeMarketRow(raw({ inputToken: { id: "0x1", symbol: "USDC", decimals: 6 } }), "x").charted).toBe(false);
  });

  it("prefers the bare asset's market to a receipt's, and the largest receipt failing that", () => {
    const weth = normalizeMarketRow(raw({ id: "a", totalValueLockedUSD: "10" }), "d");
    const wsteth = normalizeMarketRow(raw({ id: "b", totalValueLockedUSD: "500", inputToken: { id: "0x2", symbol: "wstETH", decimals: 18 } }), "d");
    const rseth = normalizeMarketRow(raw({ id: "c", totalValueLockedUSD: "900", inputToken: { id: "0x3", symbol: "rsETH", decimals: 18 } }), "d");
    const usdc = normalizeMarketRow(raw({ id: "u", inputToken: { id: "0x4", symbol: "USDC", decimals: 6 } }), "d");
    expect(chartedMarketOf([usdc, rseth, wsteth, weth])!.id).toBe("a");
    expect(chartedMarketOf([usdc, wsteth, rseth])!.id).toBe("c");
    expect(chartedMarketOf([usdc])).toBeNull();
  });

  it("puts the high-water mark at spot × maxLTV ÷ LT, and nowhere for a market that cannot be borrowed against", () => {
    expect(cliffPrice(2500, 0.805, 0.83)).toBeCloseTo(2424.7, 1);
    expect(cliffPrice(2500, 0, 0.83)).toBeNull();
    expect(cliffPrice(0, 0.8, 0.83)).toBeNull();
  });
});

describe("fanOutMarkets", () => {
  const deployments: Deployment[] = [
    { id: "a", protocol: "A", network: "mainnet", subgraphId: "sa", dialect: "messari-lending-v1" },
    { id: "b", protocol: "B", network: "base", subgraphId: "sb", dialect: "messari-lending-v1" },
  ];
  const ok = (markets: unknown[], block = 7) =>
    new Response(JSON.stringify({ data: { markets, _meta: { block: { number: block, timestamp: 1_700_000_000 } } } }), { status: 200 });

  it("keeps the deployments that answered and names the ones that did not", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).endsWith("/sa")) return ok([raw({})]);
      return new Response("nope", { status: 502 });
    }) as unknown as typeof fetch;
    const r = await fanOutMarkets(deployments, { apiKey: "k", fetchImpl });
    expect(r.healthy).toEqual(["a"]);
    expect(r.failed).toEqual([{ deploymentId: "b", reason: "HTTP 502" }]);
    expect(r.deployments[0]!.block).toBe(7);
    expect(r.deployments[0]!.charted!.symbol).toBe("WETH");
    const rows: MarketRow[] = r.deployments[0]!.rows;
    expect(rows).toHaveLength(1);
  });
});
