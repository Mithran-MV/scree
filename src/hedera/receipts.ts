import { createHash } from "node:crypto";
import {
  AccountId,
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";

/**
 * The audit trail of paid surveys, one message per settled request, on the
 * Hedera Consensus Service.
 *
 * A receipt names what was asked, what was paid and by whom, the settlement
 * transaction, and a digest of the exact bytes the buyer received, so anyone
 * holding a survey can prove it is the one that was paid for by hashing it and
 * reading the topic. The topic is public; so is everything in a receipt.
 */
export interface Receipt {
  v: 1;
  kind: "survey";
  at: string;
  address: string;
  asked: string[];
  healthy: string[];
  spot: number | null;
  shape: string | null;
  payer: string | null;
  payTo: string;
  network: string;
  asset: string;
  amount: string;
  transaction: string;
  /** SHA-256 of the response body exactly as it was sent. */
  bodySha256: string;
  /** The buyer's HCS-14 identifier, if it sent one. */
  agent?: string;
  /** Paid ahead by a scheduled transfer and honoured by the steward, rather than bought at request time. */
  standing?: true;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface HederaOperator {
  network: string;
  accountId: string;
  privateKey: string;
}

export function operatorFromEnv(env: Record<string, string | undefined> = process.env): HederaOperator | null {
  const accountId = env.HEDERA_ACCOUNT_ID;
  const privateKey = env.HEDERA_PRIVATE_KEY;
  if (!accountId || !privateKey) return null;
  return { network: env.HEDERA_NETWORK ?? "hedera:testnet", accountId, privateKey };
}

export function isMainnet(network: string): boolean {
  return network.endsWith("mainnet");
}

/** A client signing as the service account. The caller closes it. */
export function hederaClient(op: HederaOperator): Client {
  const client = isMainnet(op.network) ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(AccountId.fromString(op.accountId), PrivateKey.fromStringECDSA(op.privateKey));
  return client;
}

export async function createReceiptsTopic(op: HederaOperator, memo: string): Promise<string> {
  const client = hederaClient(op);
  try {
    const tx = await new TopicCreateTransaction().setTopicMemo(memo).execute(client);
    const receipt = await tx.getReceipt(client);
    if (!receipt.topicId) throw new Error("topic creation returned no topic id");
    return receipt.topicId.toString();
  } finally {
    client.close();
  }
}

export interface Submitted {
  topic: string;
  sequence: number | null;
  transactionId: string;
}

export async function submitReceipt(op: HederaOperator, topic: string, receipt: Receipt): Promise<Submitted> {
  const client = hederaClient(op);
  try {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topic))
      .setMessage(JSON.stringify(receipt))
      .execute(client);
    const r = await tx.getReceipt(client);
    return {
      topic,
      sequence: r.topicSequenceNumber ? Number(r.topicSequenceNumber.toString()) : null,
      transactionId: tx.transactionId.toString(),
    };
  } finally {
    client.close();
  }
}

/** Where to read the trail back: the public mirror node for the network. */
export function mirrorNodeUrl(network: string): string {
  return isMainnet(network)
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
}

export function hashscanUrl(network: string, kind: "transaction" | "topic" | "account", id: string): string {
  const net = isMainnet(network) ? "mainnet" : "testnet";
  return `https://hashscan.io/${net}/${kind}/${id}`;
}
