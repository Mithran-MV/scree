/**
 * The steward: turns scheduled payments into standing surveys.
 *
 * A buyer can pay ahead with Hedera Scheduled Transactions: transfers to the
 * service account that the network executes by itself at their expiry, each
 * carrying a memo that names the wallet and sources to survey. The steward
 * reads the service account's transfers from the mirror node, finds the
 * scheduled ones with a survey memo that it has not yet honoured, runs each
 * survey, and writes a receipt of kind "standing" to the topic with the
 * scheduled transfer as its settlement. Nothing about the survey is trusted
 * to a timer in the buyer; the ledger itself says when it was paid for.
 *
 *   npm run steward            # once
 *   npm run steward -- --watch # every 60 seconds
 */
import { createHash } from "node:crypto";
import { loadLocalEnv } from "./lib/env";
import { resolveSources, runSurvey } from "../src/survey/run";
import { parseSources } from "../src/registry/deployments";
import { mirrorNodeUrl, operatorFromEnv, submitReceipt, type Receipt } from "../src/hedera/receipts";
import { readTrail } from "../src/hedera/trail";
import { readEthUsd, usableSpot } from "../src/oracle/chainlink";

loadLocalEnv();

export const STANDING_MEMO = "scree:standing:";

/** What a standing survey's memo says: the wallet, and optionally the sources. */
export function parseStandingMemo(memo: string): { address: string; sources: string | null } | null {
  if (!memo.startsWith(STANDING_MEMO)) return null;
  const [address, sources] = memo.slice(STANDING_MEMO.length).split(":");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return { address, sources: sources && sources.length ? sources : null };
}

interface MirrorTransfer {
  transaction_id: string;
  scheduled: boolean;
  memo_base64: string | null;
  consensus_timestamp: string;
  result: string;
  transfers: { account: string; amount: number }[];
}

/** Scheduled transfers into the service account that carry a standing-survey memo. */
export async function scheduledPayments(network: string, service: string, limit = 50, fetchImpl: typeof fetch = fetch) {
  const url = `${mirrorNodeUrl(network)}/api/v1/transactions?account.id=${service}&transactiontype=cryptotransfer&result=success&limit=${limit}&order=desc`;
  const page = (await (await fetchImpl(url)).json()) as { transactions?: MirrorTransfer[] };
  const out: { transaction: string; consensusAt: string; amount: number; payer: string | null; address: string; sources: string | null }[] = [];
  for (const t of page.transactions ?? []) {
    if (!t.scheduled || !t.memo_base64) continue;
    const memo = Buffer.from(t.memo_base64, "base64").toString("utf8");
    const parsed = parseStandingMemo(memo);
    if (!parsed) continue;
    const received = t.transfers.find((x) => x.account === service);
    if (!received || received.amount <= 0) continue;
    const payer = t.transfers.find((x) => x.amount < 0 && x.account !== service)?.account ?? null;
    // The mirror node writes ids as 0.0.x-seconds-nanos; the SDK and HashScan as 0.0.x@seconds.nanos.
    const transaction = t.transaction_id.replace(/^([^-]+)-(\d+)-(\d+)$/, "$1@$2.$3");
    out.push({ transaction, consensusAt: t.consensus_timestamp, amount: received.amount, payer, ...parsed });
  }
  return out;
}

async function once(): Promise<number> {
  const op = operatorFromEnv();
  const topic = process.env.HCS_RECEIPTS_TOPIC;
  const apiKey = process.env.GRAPH_API_KEY;
  if (!op || !topic || !apiKey) {
    console.error("HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY, HCS_RECEIPTS_TOPIC and GRAPH_API_KEY are needed.");
    process.exit(1);
  }
  const paid = await scheduledPayments(op.network, op.accountId);
  if (paid.length === 0) {
    console.log("no scheduled payments to honour");
    return 0;
  }
  const honoured = new Set((await readTrail(op.network, topic, 100)).map((e) => e.transaction));
  let done = 0;
  for (const p of paid) {
    if (honoured.has(p.transaction)) continue;
    console.log(`\nscheduled payment ${p.transaction}: ${(p.amount / 1e8).toFixed(3)} HBAR from ${p.payer ?? "?"} for ${p.address}`);
    const sources = resolveSources(parseSources(p.sources));
    let oracle = null;
    try {
      oracle = await readEthUsd();
    } catch {
      oracle = null;
    }
    const survey = await runSurvey(p.address, sources, apiKey, usableSpot(oracle, null));
    const body = Buffer.from(JSON.stringify(survey));
    const receipt: Receipt & { standing: true } = {
      v: 1,
      kind: "survey",
      standing: true,
      at: new Date().toISOString(),
      address: p.address,
      asked: survey.askedOf,
      healthy: survey.healthy,
      spot: survey.spot,
      shape: survey.shape,
      payer: p.payer,
      payTo: op.accountId,
      network: op.network,
      asset: "0.0.0",
      amount: String(p.amount),
      transaction: p.transaction,
      bodySha256: createHash("sha256").update(body).digest("hex"),
    };
    const sub = await submitReceipt(op, topic, receipt);
    console.log(`  surveyed: ${survey.shape}, health at spot from ${survey.healthy.length} sources; receipt #${sub.sequence} on ${topic}`);
    done += 1;
  }
  return done;
}

if (process.argv.includes("--watch")) {
  for (;;) {
    await once();
    await new Promise((r) => setTimeout(r, 60_000));
  }
} else {
  await once();
}
