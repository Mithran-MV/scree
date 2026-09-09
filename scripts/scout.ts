/**
 * A scout: an agent that finds the survey, pays for it, and checks the receipt.
 *
 * It has never seen the service before. It reads the manifest to learn the
 * endpoint, the rail and the price schedule, quotes the request against its
 * budget, makes the request, gets a 402 naming the exact price, signs a Hedera
 * transfer for it with its own account, retries, and gets the survey with the
 * settlement transaction in the headers. Then it hashes the body it received
 * and looks for that digest in the receipts topic on the mirror node.
 *
 *   npm run scout -- --address 0x… [--address 0x…] [--sources a,b] [--budget 0.5] [--service https://scree.hacklabs.in]
 *
 * Needs AGENT_HEDERA_ACCOUNT_ID and BURNER_PRIVATE_KEY (an ECDSA key) in the
 * environment. Testnet only; the budget is in HBAR.
 */
import { loadLocalEnv } from "./lib/env";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { createHash } from "node:crypto";
import { elevation, liquidationPrice } from "../src/core/kernel";
import type { Basket } from "../src/core/types";
import { hbar, TINYBAR_PER_HBAR } from "../src/x402/pricing";

loadLocalEnv();

/* ── arguments ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const addresses = args.flatMap((a, i) => (a === "--address" && args[i + 1] ? [args[i + 1]!] : []));
const sources = opt("sources") ?? null;
const budgetHbar = Number.parseFloat(opt("budget") ?? "0.5");
const service = (opt("service") ?? "http://localhost:3000").replace(/\/$/, "");
const everyMin = Number.parseFloat(opt("every") ?? "0");

if (addresses.length === 0) {
  console.error("usage: npm run scout -- --address 0x… [--sources a,b] [--budget 0.5] [--service URL] [--every MIN]");
  process.exit(1);
}

const accountId = process.env.AGENT_HEDERA_ACCOUNT_ID;
const privateKey = process.env.BURNER_PRIVATE_KEY;
if (!accountId || !privateKey) {
  console.error("AGENT_HEDERA_ACCOUNT_ID and BURNER_PRIVATE_KEY must be set.");
  process.exit(1);
}

/* ── discovery ─────────────────────────────────────────────────────── */

interface Manifest {
  name: string;
  endpoint: { url: string };
  payment: {
    network: string;
    asset: string;
    payTo: string;
    facilitator: string;
    pricing: { baseTinybar: number; perSourceTinybar: number };
  } | null;
  receipts: { topic: string; mirror: string; explorer: string } | null;
  sources: { id: string; verified: boolean }[];
}

const manifest = (await (await fetch(`${service}/api/survey/manifest`)).json()) as Manifest;
if (!manifest.payment) {
  console.error(`${service} has no payment rail configured.`);
  process.exit(1);
}
const pay = manifest.payment;
const verified = manifest.sources.filter((s) => s.verified).map((s) => s.id);
const asked = sources ? sources.split(",").filter((s) => verified.includes(s.trim())) : verified;
const quoteTinybar = pay.pricing.baseTinybar + asked.length * pay.pricing.perSourceTinybar;

console.log(`service   ${manifest.name} at ${manifest.endpoint.url}`);
console.log(`rail      x402 exact on ${pay.network}, ${pay.asset === "0.0.0" ? "HBAR" : pay.asset} to ${pay.payTo}, via ${pay.facilitator}`);
console.log(`price     ${hbar(pay.pricing.baseTinybar)} + ${hbar(pay.pricing.perSourceTinybar)} × ${asked.length} sources = ${hbar(quoteTinybar)} HBAR per survey`);
console.log(`budget    ${budgetHbar} HBAR from ${accountId}`);
if (manifest.receipts) console.log(`receipts  ${manifest.receipts.explorer}`);

/* ── the paying client ─────────────────────────────────────────────── */

const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(privateKey), { network: pay.network });
const client = new x402Client()
  .register(pay.network as `${string}:${string}`, new ExactHederaScheme(signer))
  .setSpendControls({
    // Never sign for more than the quote the manifest led us to expect.
    allowedAssets: [{ network: pay.network as `${string}:${string}`, asset: pay.asset, maxAmountPerPayment: String(quoteTinybar) }],
  });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

/* ── one survey ────────────────────────────────────────────────────── */

interface Survey {
  address: string;
  spot: number | null;
  baskets: Basket[];
  shape: string;
  healthy: string[];
  failed: { deploymentId: string; reason: string }[];
  excluded: { deploymentId: string; reason: string }[];
  blockHeights: Record<string, number>;
  metering: { sourcesAsked: number; priceTinybar: number; priceHbar: string };
}

const usd = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
let spentTinybar = 0;

async function survey(address: string): Promise<void> {
  if ((spentTinybar + quoteTinybar) / TINYBAR_PER_HBAR > budgetHbar) {
    console.log(`\n${address}: skipped, ${hbar(quoteTinybar)} HBAR would exceed the budget (${hbar(spentTinybar)} spent)`);
    return;
  }
  const url = new URL(`${service}/api/survey`);
  url.searchParams.set("address", address);
  if (sources) url.searchParams.set("sources", sources);

  console.log(`\n== ${address}`);
  const t0 = Date.now();
  const res = await fetchWithPayment(url.toString());
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  if (!res.ok) {
    console.log(`  ${res.status}: ${text.slice(0, 300)}`);
    return;
  }
  const settlement = httpClient.getPaymentSettleResponse((name) => res.headers.get(name));
  const s = JSON.parse(text) as Survey;
  const digest = createHash("sha256").update(bytes).digest("hex");
  spentTinybar += s.metering.priceTinybar;

  console.log(`  paid      ${s.metering.priceHbar} HBAR for ${s.metering.sourcesAsked} sources, in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (settlement) {
    console.log(`  settled   ${settlement.transaction}`);
    console.log(`            https://hashscan.io/${pay.network.endsWith("mainnet") ? "mainnet" : "testnet"}/transaction/${settlement.transaction}`);
  }
  const health = s.spot !== null && s.baskets.length ? elevation(s.baskets, s.spot, 0) + 1 : null;
  const lows = s.baskets.map((b) => liquidationPrice(b, 0)).filter((p): p is number => p !== null);
  console.log(`  spot      ${usd(s.spot)}   health ${health === null ? "—" : health.toFixed(3)}   shape ${s.shape}`);
  console.log(`  ground    ${s.baskets.map((b) => b.deploymentId).join(", ") || "none: no borrowing on any source"}`);
  if (lows.length) console.log(`  coast     nearest liquidation ${usd(Math.max(...lows))}`);
  console.log(`  sources   ${s.healthy.length} answered${s.failed.length ? `, failed: ${s.failed.map((f) => f.deploymentId).join(", ")}` : ""}${s.excluded.length ? `, set aside: ${s.excluded.map((e) => e.deploymentId).join(", ")}` : ""}`);
  console.log(`  digest    sha256 ${digest.slice(0, 16)}…`);

  if (manifest.receipts && settlement) await confirmReceipt(manifest.receipts, settlement.transaction, digest);
}

async function confirmReceipt(r: { topic: string; mirror: string }, transaction: string, digest: string): Promise<void> {
  // Consensus takes a few seconds; the mirror node a few more.
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((f) => setTimeout(f, 3000));
    try {
      const page = (await (await fetch(`${r.mirror}?limit=10&order=desc`)).json()) as { messages?: { sequence_number: number; message: string; consensus_timestamp: string }[] };
      for (const m of page.messages ?? []) {
        const body = JSON.parse(Buffer.from(m.message, "base64").toString("utf8")) as { transaction?: string; bodySha256?: string };
        if (body.transaction === transaction) {
          const match = body.bodySha256 === digest ? "matches what I received" : "DOES NOT MATCH what I received";
          console.log(`  receipt   topic ${r.topic} #${m.sequence_number} at ${m.consensus_timestamp}, digest ${match}`);
          return;
        }
      }
    } catch (err) {
      console.log(`  receipt   mirror node not readable yet (${err instanceof Error ? err.message : err})`);
    }
  }
  console.log(`  receipt   not seen on the topic yet; it may still be in flight`);
}

async function round(): Promise<void> {
  for (const a of addresses) await survey(a);
  console.log(`\nspent ${hbar(spentTinybar)} of ${budgetHbar} HBAR`);
}

await round();
if (everyMin > 0) {
  console.log(`\nre-surveying every ${everyMin} min until stopped or the budget is spent`);
  while (spentTinybar / TINYBAR_PER_HBAR + quoteTinybar / TINYBAR_PER_HBAR <= budgetHbar) {
    await new Promise((f) => setTimeout(f, everyMin * 60_000));
    await round();
  }
}
