import { NextResponse } from "next/server";
import { parseSources } from "@/registry/deployments";
import { ADDRESS, resolveSources, runSurvey, verifiedIds, type SurveyResult } from "@/survey/run";
import { buyJson, buyerFromEnv, hashscanTx } from "@/x402/buyer";
import { quoteForRequest, serviceConfig } from "@/x402/service";
import { hashscanUrl } from "@/hedera/receipts";
import { readEthUsd, usableSpot, type OraclePrice } from "@/oracle/chainlink";

/** The oracle, read once per request and never allowed to fail the survey. */
async function oracle(): Promise<OraclePrice | null> {
  try {
    return await readEthUsd();
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read one address across the registry, for the map itself.
 *
 * The gateway key stays on this side; the browser never sees it. Everything
 * returned is public on-chain data, so the response carries only a short cache
 * window — the whole point of the map is that it is current.
 *
 * Only deployments whose subgraph id passed `npm run verify:subgraphs` are
 * asked. A deployment in the registry that has not passed is named in
 * `unverified` rather than silently dropped, so a map drawn from fewer sources
 * says so.
 *
 * When the platform has an agent account of its own, it does not read the
 * survey from the inside: it buys it from `/api/survey` like any other agent,
 * and the settlement comes back with the reading so the feed can name it.
 * If the purchase cannot be made, the survey is read directly and the reason
 * is named, so the map is never blank because a payment rail was.
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

  const buyer = buyerFromEnv();
  const service = serviceConfig();
  if (buyer && service && service.payTo !== buyer.accountId) {
    const quote = quoteForRequest(url.searchParams.get("sources"));
    const target = new URL(`${service.publicUrl}/api/survey`);
    target.searchParams.set("address", address);
    const sourcesParam = url.searchParams.get("sources");
    if (sourcesParam) target.searchParams.set("sources", sourcesParam);
    try {
      const bought = await buyJson<SurveyResult & { metering?: { priceHbar: string } }>(buyer, target.toString(), String(quote.tinybar));
      const { metering, ...survey } = bought.body;
      return NextResponse.json(
        {
          ...survey,
          oracle: await oracle(),
          payment: bought.settlement
            ? {
                paidHbar: metering?.priceHbar ?? quote.hbar,
                payer: bought.settlement.payer ?? buyer.accountId,
                payTo: service.payTo,
                transaction: bought.settlement.transaction,
                network: bought.settlement.network,
                tookMs: bought.tookMs,
                links: {
                  transaction: hashscanTx(bought.settlement.network, bought.settlement.transaction),
                  topic: service.receiptsTopic ? hashscanUrl(service.network, "topic", service.receiptsTopic) : null,
                },
              }
            : null,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const o = await oracle();
      const survey = await runSurvey(address, sources, apiKey, usableSpot(o, null));
      return NextResponse.json(
        { ...survey, oracle: o, payment: null, failed: [...survey.failed, { deploymentId: "payment", reason: `the platform could not buy this survey (${reason}); read directly instead` }] },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
  }

  const o = await oracle();
  const survey = await runSurvey(address, sources, apiKey, usableSpot(o, null));
  return NextResponse.json({ ...survey, oracle: o, payment: null }, { headers: { "cache-control": "public, max-age=15" } });
}
