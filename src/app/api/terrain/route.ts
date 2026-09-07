import { NextResponse } from "next/server";
import { DEPLOYMENTS, parseSources, selectDeployments } from "@/registry/deployments";
import { fanOut } from "@/graph/client";
import { offAxisCollateralUSD, reduceToBaskets } from "@/graph/reduce";
import { walletShape } from "@/core/kernel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read one address across the registry.
 *
 * The gateway key stays on this side; the browser never sees it. Everything
 * returned is public on-chain data, so the response carries only a short cache
 * window — the whole point of the map is that it is current.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address")?.trim() ?? "";
  const sources = parseSources(url.searchParams.get("sources"));

  if (!ADDRESS.test(address)) {
    return NextResponse.json({ error: "expected a 0x-prefixed 20-byte address" }, { status: 400 });
  }

  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GRAPH_API_KEY is not configured on this deployment" },
      { status: 503 },
    );
  }

  const deployments = selectDeployments(sources);
  if (deployments.length === 0) {
    return NextResponse.json(
      { error: "no deployment matched ?sources=", known: DEPLOYMENTS.map((d) => d.id) },
      { status: 400 },
    );
  }

  const result = await fanOut(address, deployments, { apiKey });
  const baskets = reduceToBaskets(result.legs);

  return NextResponse.json(
    {
      address,
      baskets,
      shape: walletShape(baskets),
      offAxisCollateralUSD: offAxisCollateralUSD(result.legs),
      blockHeights: result.blockHeights,
      healthy: result.healthy,
      failed: result.failed,
      askedOf: deployments.map((d) => d.id),
      readAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "public, max-age=15" } },
  );
}
