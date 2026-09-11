import { NextResponse } from "next/server";
import { parseSources } from "@/registry/deployments";
import { resolveSources, verifiedIds } from "@/survey/run";
import { cliffPrice, fanOutMarkets, isBareMarket } from "@/graph/markets";
import { median } from "@/graph/reduce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What each deployment's markets are, from the second query in the same schema.
 *
 * For every verified deployment: its largest markets, the one the map's price
 * axis is about, the block it was read at, and the high-water mark for that
 * market, the price at which a borrower who opened at the maximum LTV today
 * is liquidated. Public data; a short cache window.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sources = resolveSources(parseSources(url.searchParams.get("sources")));
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GRAPH_API_KEY is not configured on this deployment" }, { status: 503 });
  }
  if (sources.deployments.length === 0) {
    return NextResponse.json({ error: "no verified deployment matched ?sources=", known: verifiedIds() }, { status: 400 });
  }

  const result = await fanOutMarkets(sources.deployments, { apiKey });
  // Today's price from the bare markets only; a receipt trades at a premium to the thing it receipts for.
  const quotes = result.deployments.map((d) => d.charted).filter((c) => c !== null && isBareMarket(c) && c.priceUSD > 0).map((c) => c!.priceUSD);
  const spot = quotes.length ? median(quotes) : null;

  return NextResponse.json(
    {
      spot,
      deployments: result.deployments.map((d) => ({
        deploymentId: d.deploymentId,
        block: d.block,
        blockTimestamp: d.blockTimestamp,
        charted: d.charted,
        cliffPrice: d.charted && spot !== null ? cliffPrice(spot, d.charted.maximumLTV, d.charted.liquidationThreshold) : null,
        rows: d.rows,
      })),
      healthy: result.healthy,
      failed: result.failed,
      askedOf: sources.deployments.map((d) => d.id),
      unverified: sources.unverified,
      readAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
