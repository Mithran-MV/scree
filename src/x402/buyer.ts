import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import type { Network } from "@x402/core/types";
import { AGENT_HEADER, hederaAgent, uaid } from "@/agent/identity";

/**
 * The platform as a buyer.
 *
 * The map does not read the survey for free from the inside: when an agent
 * account is configured, every survey a visitor makes on the site is bought
 * from the paid endpoint by the platform's own account, exactly as any other
 * agent would buy it. The settlement comes back with the survey and is shown
 * in the feed; the receipt lands on the topic with everyone else's.
 */
export interface BuyerConfig {
  network: Network;
  accountId: string;
  privateKey: string;
  /** What this buyer calls itself; the identifier is derived from it. */
  name?: string;
  domain?: string;
}

/** The buyer's HCS-14 identifier, derived from its name and its Hedera account. */
export function buyerIdentity(cfg: BuyerConfig): string {
  return uaid(hederaAgent(cfg.name ?? "scree-platform", "0.1.0", cfg.network, cfg.accountId, cfg.domain ? { domain: cfg.domain } : {}));
}

export function buyerFromEnv(env: Record<string, string | undefined> = process.env): BuyerConfig | null {
  const accountId = env.AGENT_HEDERA_ACCOUNT_ID;
  const privateKey = env.BURNER_PRIVATE_KEY;
  if (!accountId || !privateKey) return null;
  const domain = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).host : undefined;
  return { network: (env.HEDERA_NETWORK ?? "hedera:testnet") as Network, accountId, privateKey, name: "scree-platform", ...(domain ? { domain } : {}) };
}

export interface Settlement {
  transaction: string;
  payer: string | null;
  network: string;
  /** Tinybar, as the requirement stated it. */
  amount: string | null;
  asset: string | null;
}

export interface Purchase<T> {
  body: T;
  settlement: Settlement | null;
  /** Milliseconds from first request to settled response. */
  tookMs: number;
}

let cached: { key: string; fetchWithPayment: typeof fetch; http: x402HTTPClient } | null = null;

function clientFor(cfg: BuyerConfig, maxTinybar: string) {
  const key = `${cfg.network}|${cfg.accountId}|${maxTinybar}`;
  if (cached && cached.key === key) return cached;
  const signer = createClientHederaSigner(cfg.accountId, PrivateKey.fromStringECDSA(cfg.privateKey), { network: cfg.network });
  const client = new x402Client()
    .register(cfg.network, new ExactHederaScheme(signer))
    .setSpendControls({ allowedAssets: [{ network: cfg.network, asset: "0.0.0", maxAmountPerPayment: maxTinybar }] });
  cached = { key, fetchWithPayment: wrapFetchWithPayment(fetch, client) as typeof fetch, http: new x402HTTPClient(client) };
  return cached;
}

/**
 * Buy a JSON resource: request, take the 402, sign for the quoted amount,
 * retry, and return the body with the settlement decoded from the headers.
 * Refuses to sign above `maxTinybar`.
 */
export async function buyJson<T>(cfg: BuyerConfig, url: string, maxTinybar: string): Promise<Purchase<T>> {
  const { fetchWithPayment, http } = clientFor(cfg, maxTinybar);
  const t0 = Date.now();
  const res = await fetchWithPayment(url, { method: "GET", headers: { [AGENT_HEADER]: buyerIdentity(cfg) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`paid request failed with ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as T;
  const raw = http.getPaymentSettleResponse((name) => res.headers.get(name));
  const settlement: Settlement | null = raw
    ? {
        transaction: raw.transaction,
        payer: raw.payer ?? null,
        network: raw.network,
        amount: (body as { metering?: { priceTinybar?: number } }).metering?.priceTinybar?.toString() ?? null,
        asset: "0.0.0",
      }
    : null;
  return { body, settlement, tookMs: Date.now() - t0 };
}

/** The explorer page for a settlement. */
export function hashscanTx(network: string, transaction: string): string {
  const net = network.endsWith("mainnet") ? "mainnet" : "testnet";
  return `https://hashscan.io/${net}/transaction/${transaction}`;
}
