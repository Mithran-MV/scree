import { NextResponse } from "next/server";
import { readTrail } from "@/hedera/trail";
import { hashscanUrl } from "@/hedera/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The audit trail of paid surveys, read back from the public topic.
 *
 * Nothing here is ours to assert: every entry is a message the Consensus
 * Service ordered and the mirror node serves, decoded and linked. Anyone can
 * do the same with the topic id in the manifest.
 */
export async function GET(request: Request) {
  const topic = process.env.HCS_RECEIPTS_TOPIC;
  const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";
  if (!topic) return NextResponse.json({ error: "no receipts topic is configured on this deployment" }, { status: 503 });
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  try {
    const entries = await readTrail(network, topic, Number.isFinite(limit) ? limit : 25);
    return NextResponse.json(
      { topic, network, explorer: hashscanUrl(network, "topic", topic), entries, readAt: new Date().toISOString() },
      { headers: { "cache-control": "public, max-age=10" } },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
