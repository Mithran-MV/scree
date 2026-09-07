import type { Deployment } from "../core/types";
import { WALLET_POSITIONS } from "./query";
import { normalizeResponse, type RawResponse } from "./normalize";
import type { WalletLeg } from "./reduce";

const GATEWAY = "https://gateway.thegraph.com/api";

export interface FanOutResult {
  legs: WalletLeg[];
  /** Block height per deployment, so every number on the map can cite a source. */
  blockHeights: Record<string, number>;
  /** Deployments that answered, and deployments that did not, both named. */
  healthy: string[];
  failed: { deploymentId: string; reason: string }[];
}

export interface FanOutOptions {
  apiKey: string;
  positionsPerAccount?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Ask every deployment the same question, at the same time.
 *
 * A deployment that is down, rate-limited or has never heard of the address is
 * recorded as failed and the scan continues. A map drawn from four of seven
 * sources is still worth reading, but only if it says so, so the failures are
 * returned rather than swallowed.
 */
export async function fanOut(
  address: string,
  deployments: readonly Deployment[],
  opts: FanOutOptions,
): Promise<FanOutResult> {
  const account = address.toLowerCase();
  const first = opts.positionsPerAccount ?? 100;
  const doFetch = opts.fetchImpl ?? fetch;

  const settled = await Promise.all(
    deployments.map(async (d) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
      try {
        const res = await doFetch(`${GATEWAY}/${opts.apiKey}/subgraphs/id/${d.subgraphId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: WALLET_POSITIONS, variables: { account, first } }),
          signal: controller.signal,
        });
        if (!res.ok) return { d, error: `HTTP ${res.status}` } as const;

        const body = (await res.json()) as {
          data?: RawResponse;
          errors?: { message: string }[];
        };
        if (body.errors?.length) return { d, error: body.errors[0]!.message } as const;
        if (!body.data) return { d, error: "empty response" } as const;
        return { d, data: body.data } as const;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { d, error: reason === "The operation was aborted." ? "timed out" : reason } as const;
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const legs: WalletLeg[] = [];
  const blockHeights: Record<string, number> = {};
  const healthy: string[] = [];
  const failed: { deploymentId: string; reason: string }[] = [];

  for (const r of settled) {
    if ("error" in r && r.error !== undefined) {
      failed.push({ deploymentId: r.d.id, reason: r.error });
      continue;
    }
    if (!("data" in r) || !r.data) continue;
    healthy.push(r.d.id);
    blockHeights[r.d.id] = r.data._meta.block.number;
    legs.push(...normalizeResponse(r.data, r.d.id));
  }

  return { legs, blockHeights, healthy, failed };
}
