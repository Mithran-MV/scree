import { describe, expect, it } from "vitest";
import { decodeReceipt, readTrail } from "./trail";

const receipt = {
  v: 1,
  kind: "survey",
  at: "2026-09-09T13:37:16.469Z",
  address: "0xb7b7eb7e9611975bc9715f22ce7e6ee288296fd4",
  asked: ["aave-v3-ethereum", "spark-ethereum"],
  healthy: ["aave-v3-ethereum", "spark-ethereum"],
  spot: 2508.88,
  shape: "LONG-ONLY",
  payer: "0.0.10438429",
  payTo: "0.0.10438442",
  network: "hedera:testnet",
  asset: "0.0.0",
  amount: "2000000",
  transaction: "0.0.7162784@1788961026.599308167",
  bodySha256: "404e",
};
const message = (body: unknown, seq = 1) => ({
  sequence_number: seq,
  consensus_timestamp: "1788961037.753066104",
  payer_account_id: "0.0.10438442",
  message: Buffer.from(JSON.stringify(body)).toString("base64"),
});

describe("the trail", () => {
  it("decodes a receipt and links it", () => {
    const e = decodeReceipt(message(receipt), "hedera:testnet", "0.0.10439715")!;
    expect(e.sequence).toBe(1);
    expect(e.address).toBe(receipt.address);
    expect(e.amount).toBe("2000000");
    expect(e.consensusAt.startsWith("2026-09-09T")).toBe(true);
    expect(e.links.transaction).toBe("https://hashscan.io/testnet/transaction/0.0.7162784@1788961026.599308167");
    expect(e.links.topic).toBe("https://hashscan.io/testnet/topic/0.0.10439715");
  });

  it("skips what is not a receipt rather than trusting it", () => {
    expect(decodeReceipt(message({ hello: "world" }), "hedera:testnet", "t")).toBeNull();
    expect(decodeReceipt({ ...message(receipt), message: "not base64 json" }, "hedera:testnet", "t")).toBeNull();
  });

  it("reads the topic newest first through the mirror node", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      expect(String(url)).toContain("/topics/0.0.10439715/messages?limit=5&order=desc");
      return new Response(JSON.stringify({ messages: [message(receipt, 3), message({ junk: true }, 2), message(receipt, 1)] }), { status: 200 });
    }) as unknown as typeof fetch;
    const entries = await readTrail("hedera:testnet", "0.0.10439715", 5, fetchImpl);
    expect(entries.map((e) => e.sequence)).toEqual([3, 1]);
  });
});
