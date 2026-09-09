import { NextResponse } from "next/server";
import { parseSources } from "@/registry/deployments";
import { ADDRESS, resolveSources, runSurvey, verifiedIds } from "@/survey/run";
import { paid, quoteForRequest, serviceConfig } from "@/x402/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The survey, sold by the call.
 *
 * Identical in content to `/api/terrain`, which the map uses for free, but
 * gated by x402 on Hedera and metered by the number of deployments asked. The
 * gate runs first; by the time this handler executes the payment has been
 * verified, and it is settled only if this returns success.
 */
async function survey(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const address = url.searchParams.get("address")?.trim() ?? "";
  const sourcesParam = url.searchParams.get("sources");
  const sources = resolveSources(parseSources(sourcesParam));

  if (!ADDRESS.test(address)) {
    return NextResponse.json({ error: "expected a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GRAPH_API_KEY is not configured on this deployment" }, { status: 503 });
  }
  if (sources.deployments.length === 0) {
    return NextResponse.json(
      { error: "no verified deployment matched ?sources=", known: verifiedIds(), unverified: sources.unverified },
      { status: 400 },
    );
  }

  const result = await runSurvey(address, sources, apiKey);
  const quote = quoteForRequest(sourcesParam);
  const cfg = serviceConfig();
  return NextResponse.json({
    ...result,
    metering: {
      sourcesAsked: quote.sources,
      priceTinybar: quote.tinybar,
      priceHbar: quote.hbar,
      asset: quote.asset,
      network: cfg?.network ?? null,
    },
  });
}

export const GET = paid(survey);
