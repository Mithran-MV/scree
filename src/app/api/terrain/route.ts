import { NextResponse } from "next/server";
import {
  DEPLOYMENTS,
  parseSources,
  selectDeployments,
  verifiedOnly,
  type VerificationRecord,
} from "@/registry/deployments";
import verified from "@/registry/verified.json";
import { fanOut } from "@/graph/client";
import { median, offAxisCollateralUSD, reduceToBaskets, spotFromLegs } from "@/graph/reduce";
import { healthFactor, walletShape } from "@/core/kernel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read one address across the registry.
 *
 * The gateway key stays on this side; the browser never sees it. Everything
 * returned is public on-chain data, so the response carries only a short cache
 * window — the whole point of the map is that it is current.
 *
 * Only deployments whose subgraph id passed `npm run verify:subgraphs` are
 * asked. A deployment in the registry that has not passed is named in
 * `unverified` rather than silently dropped, so a map drawn from fewer sources
 * says so.
 */
const VERIFIED = verified as VerificationRecord[];
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

  const selected = selectDeployments(sources);
  const deployments = verifiedOnly(selected, VERIFIED);
  const unverified = selected.filter((d) => !deployments.includes(d)).map((d) => d.id);
  if (deployments.length === 0) {
    return NextResponse.json(
      {
        error: unverified.length
          ? "every deployment matched by ?sources= is unverified"
          : "no deployment matched ?sources=",
        known: verifiedOnly(DEPLOYMENTS, VERIFIED).map((d) => d.id),
        unverified,
      },
      { status: 400 },
    );
  }

  const result = await fanOut(address, deployments, { apiKey });

  // Today's price of the charted asset: what the deployments themselves say,
  // agreed by median, and failing that whatever the wallet's own legs report.
  const quoted = Object.values(result.spotUSD);
  const spot = quoted.length ? median(quoted) : spotFromLegs(result.legs);

  const reduced = reduceToBaskets(result.legs, undefined, spot);

  // A position that is open on-chain but under water by the schema's own
  // thresholds is being held up by something the schema does not carry, an
  // efficiency mode most often. Drawing it would flood the map with a
  // liquidation that is not happening, so it is set aside and named.
  const excluded: { deploymentId: string; reason: string }[] = [];
  const baskets = reduced.filter((b) => {
    if (spot === null) return true;
    const hf = healthFactor(b, spot, 0);
    if (hf >= 1) return true;
    excluded.push({
      deploymentId: b.deploymentId,
      reason: `health ${hf.toFixed(2)} at today's price by the schema's thresholds, yet the position is open; an efficiency mode the schema does not expose must apply`,
    });
    return false;
  });

  return NextResponse.json(
    {
      address,
      spot,
      baskets,
      excluded,
      shape: walletShape(baskets),
      offAxisCollateralUSD: offAxisCollateralUSD(result.legs),
      blockHeights: result.blockHeights,
      healthy: result.healthy,
      failed: result.failed,
      askedOf: deployments.map((d) => d.id),
      unverified,
      readAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "public, max-age=15" } },
  );
}
