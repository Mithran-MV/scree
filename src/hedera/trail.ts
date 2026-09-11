import { hashscanUrl, mirrorNodeUrl, type Receipt } from "./receipts";

/**
 * The audit trail read back: the topic's messages from the mirror node,
 * decoded into receipts, newest first. Anything on the topic that is not a
 * receipt (there should be nothing) is skipped rather than trusted.
 */
export interface TrailEntry extends Receipt {
  sequence: number;
  consensusAt: string;
  /** Who paid the consensus fee for the message: the service account. */
  submittedBy: string;
  links: { message: string; transaction: string; topic: string };
}

interface MirrorMessage {
  sequence_number: number;
  consensus_timestamp: string;
  payer_account_id: string;
  message: string;
}

export function decodeReceipt(m: MirrorMessage, network: string, topic: string): TrailEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(m.message, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const r = parsed as Partial<Receipt>;
  if (r.v !== 1 || r.kind !== "survey" || typeof r.transaction !== "string" || typeof r.address !== "string") return null;
  const seconds = Number.parseFloat(m.consensus_timestamp);
  return {
    v: 1,
    kind: "survey",
    at: r.at ?? "",
    address: r.address,
    asked: Array.isArray(r.asked) ? r.asked : [],
    healthy: Array.isArray(r.healthy) ? r.healthy : [],
    spot: typeof r.spot === "number" ? r.spot : null,
    shape: typeof r.shape === "string" ? r.shape : null,
    payer: typeof r.payer === "string" ? r.payer : null,
    payTo: r.payTo ?? "",
    network: r.network ?? network,
    asset: r.asset ?? "0.0.0",
    amount: r.amount ?? "0",
    transaction: r.transaction,
    bodySha256: r.bodySha256 ?? "",
    ...(typeof r.agent === "string" ? { agent: r.agent } : {}),
    ...(r.standing === true ? { standing: true as const } : {}),
    sequence: m.sequence_number,
    consensusAt: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : "",
    submittedBy: m.payer_account_id,
    links: {
      message: `${hashscanUrl(network, "topic", topic)}?sequence=${m.sequence_number}`,
      transaction: hashscanUrl(network, "transaction", r.transaction),
      topic: hashscanUrl(network, "topic", topic),
    },
  };
}

export async function readTrail(network: string, topic: string, limit = 25, fetchImpl: typeof fetch = fetch): Promise<TrailEntry[]> {
  const url = `${mirrorNodeUrl(network)}/api/v1/topics/${topic}/messages?limit=${Math.min(100, Math.max(1, limit))}&order=desc`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`mirror node answered ${res.status}`);
  const page = (await res.json()) as { messages?: MirrorMessage[] };
  return (page.messages ?? []).map((m) => decodeReceipt(m, network, topic)).filter((e): e is TrailEntry => e !== null);
}
