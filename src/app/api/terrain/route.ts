import { NextResponse } from "next/server";
import { parseSources } from "@/registry/deployments";
import { ADDRESS, resolveSources, runSurvey, verifiedIds } from "@/survey/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read one address across the registry, free of charge, for the map itself.
 *
 * The gateway key stays on this side; the browser never sees it. Everything
 * returned is public on-chain data, so the response carries only a short cache
 * window — the whole point of the map is that it is current.
 *
 * Only deployments whose subgraph id passed `npm run verify:subgraphs` are
 * asked. A deployment in the registry that has not passed is named in
 * `unverified` rather than silently dropped, so a map drawn from fewer sources
 * says so. The same survey, metered and paid for by agents, is `/api/survey`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address")?.trim() ?? "";
  const sources = resolveSources(parseSources(url.searchParams.get("sources")));

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

  if (sources.deployments.length === 0) {
    return NextResponse.json(
      {
        error: sources.unverified.length
          ? "every deployment matched by ?sources= is unverified"
          : "no deployment matched ?sources=",
        known: verifiedIds(),
        unverified: sources.unverified,
      },
      { status: 400 },
    );
  }

  const survey = await runSurvey(address, sources, apiKey);
  return NextResponse.json(survey, { headers: { "cache-control": "public, max-age=15" } });
}
