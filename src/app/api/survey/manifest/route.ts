import { NextResponse } from "next/server";
import { DEPLOYMENTS } from "@/registry/deployments";
import { verifiedIds } from "@/survey/run";
import { hashscanUrl, mirrorNodeUrl } from "@/hedera/receipts";
import { quoteFor, scheduleFromEnv } from "@/x402/pricing";
import { serviceConfig } from "@/x402/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How to find and pay for the survey, for an agent that has never seen it.
 *
 * Everything a buyer needs before making a request: the endpoint and its
 * parameters, the payment rail, the price schedule with a worked example,
 * which deployments can be asked, and where the receipts are written.
 */
export function GET() {
  const cfg = serviceConfig();
  const schedule = scheduleFromEnv();
  const verified = verifiedIds();
  const base = cfg?.publicUrl ?? "";
  return NextResponse.json(
    {
      name: "Scree survey",
      version: 1,
      wellKnown: `${base}/.well-known/x402`,
      description:
        "A liquidation survey of one address across standardized lending deployments: one query fanned out, minimised into baskets with today's price, wallet shape and per-source block heights.",
      endpoint: { method: "GET", url: `${base}/api/survey`, query: { address: "0x… (required)", sources: "comma-separated deployment ids (optional; default all verified)" } },
      free: { url: `${base}/api/terrain`, note: "the same reading, unmetered, for the map itself" },
      payment: cfg
        ? {
            protocol: "x402",
            x402Version: 2,
            scheme: "exact",
            network: cfg.network,
            asset: "0.0.0",
            assetSymbol: "HBAR",
            payTo: cfg.payTo,
            facilitator: cfg.facilitatorUrl,
            pricing: {
              baseTinybar: schedule.baseTinybar,
              perSourceTinybar: schedule.perSourceTinybar,
              rule: "base + perSource × verified deployments asked, quoted in the 402 before you sign",
              example: quoteFor(verified.length, schedule),
            },
          }
        : null,
      receipts: cfg?.receiptsTopic
        ? {
            service: "hcs",
            topic: cfg.receiptsTopic,
            explorer: hashscanUrl(cfg.network, "topic", cfg.receiptsTopic),
            mirror: `${mirrorNodeUrl(cfg.network)}/api/v1/topics/${cfg.receiptsTopic}/messages`,
            note: "one message per settled survey: what was asked, what was paid, the settlement transaction, and the SHA-256 of the body you received",
          }
        : null,
      sources: DEPLOYMENTS.map((d) => ({ id: d.id, protocol: d.protocol, network: d.network, verified: verified.includes(d.id) })),
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
