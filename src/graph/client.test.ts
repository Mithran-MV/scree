import { describe, expect, it } from "vitest";
import { fanOut } from "./client";
import type { Deployment } from "../core/types";

const DEPLOYMENTS: Deployment[] = [
  { id: "a", protocol: "A", network: "mainnet", subgraphId: "sa", dialect: "messari-lending-v1" },
  { id: "b", protocol: "B", network: "base", subgraphId: "sb", dialect: "messari-lending-v1" },
  { id: "c", protocol: "C", network: "arbitrum-one", subgraphId: "sc", dialect: "messari-lending-v1" },
];

function payload(block: number, positions: unknown[] = []) {
  return {
    ok: true,
    json: async () => ({ data: { account: { id: "0xabc", positions }, _meta: { block: { number: block } } } }),
  } as unknown as Response;
}

const POSITION = {
  id: "p",
  side: "LENDER",
  balance: "6000000000000000000",
  market: {
    id: "m",
    liquidationThreshold: "82.5",
    maximumLTV: "80",
    inputTokenPriceUSD: "4000",
    inputToken: { id: "0xweth", symbol: "WETH", decimals: 18 },
    rates: [{ side: "LENDER", type: "VARIABLE", rate: "2.1" }],
  },
};

describe("fanOut", () => {
  it("collects legs and block heights from every deployment that answers", async () => {
    const r = await fanOut("0xABC", DEPLOYMENTS, {
      apiKey: "k",
      fetchImpl: (async (url: string) => payload(url.includes("sb") ? 200 : 100, [POSITION])) as never,
    });
    expect(r.healthy.sort()).toEqual(["a", "b", "c"]);
    expect(r.failed).toEqual([]);
    expect(r.legs).toHaveLength(3);
    expect(r.blockHeights).toEqual({ a: 100, b: 200, c: 100 });
  });

  it("keeps going when one deployment is down, and names it", async () => {
    // A map drawn from two of three sources is still worth reading, but only
    // because it says which one is missing.
    const r = await fanOut("0xABC", DEPLOYMENTS, {
      apiKey: "k",
      fetchImpl: (async (url: string) =>
        url.includes("sb")
          ? ({ ok: false, status: 502, json: async () => ({}) } as unknown as Response)
          : payload(100, [POSITION])) as never,
    });
    expect(r.healthy.sort()).toEqual(["a", "c"]);
    expect(r.failed).toEqual([{ deploymentId: "b", reason: "HTTP 502" }]);
    expect(r.legs).toHaveLength(2);
  });

  it("reports a GraphQL error rather than treating it as an empty wallet", async () => {
    const r = await fanOut("0xABC", DEPLOYMENTS, {
      apiKey: "k",
      fetchImpl: (async () => ({
        ok: true,
        json: async () => ({ errors: [{ message: "indexers not responding" }] }),
      })) as never,
    });
    expect(r.healthy).toEqual([]);
    expect(r.failed.map((f) => f.reason)).toEqual([
      "indexers not responding",
      "indexers not responding",
      "indexers not responding",
    ]);
  });

  it("treats an address with no positions as healthy and empty, not as a failure", async () => {
    const r = await fanOut("0xABC", DEPLOYMENTS, {
      apiKey: "k",
      fetchImpl: (async () => ({
        ok: true,
        json: async () => ({ data: { account: null, _meta: { block: { number: 7 } } } }),
      })) as never,
    });
    expect(r.healthy).toHaveLength(3);
    expect(r.failed).toEqual([]);
    expect(r.legs).toEqual([]);
  });

  it("lowercases the address, because account ids are lowercase hex", async () => {
    let seen = "";
    await fanOut("0xAbCdEf0000000000000000000000000000000001", [DEPLOYMENTS[0]!], {
      apiKey: "k",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen = JSON.parse(init.body as string).variables.account;
        return payload(1);
      }) as never,
    });
    expect(seen).toBe("0xabcdef0000000000000000000000000000000001");
  });
});
