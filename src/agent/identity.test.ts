import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { base58, canonicalAgentJson, hederaAgent, parseUaid, uaid } from "./identity";

describe("HCS-14 identity", () => {
  const vector = { registry: "hol", name: "Support Agent", version: "1.0.0", protocol: "hcs-10", nativeId: "hedera:testnet:0.0.123456", skills: [17, 0] };

  it("serialises the six fields with sorted keys, lowercased registry and protocol, sorted skills", () => {
    expect(canonicalAgentJson({ ...vector, registry: " HOL ", protocol: "HCS-10" })).toBe(
      '{"name":"Support Agent","nativeId":"hedera:testnet:0.0.123456","protocol":"hcs-10","registry":"hol","skills":[0,17],"version":"1.0.0"}',
    );
  });

  it("hashes with SHA-384 to Base58 and orders the routing parameters uid, registry, proto, nativeId", () => {
    const expected = base58(createHash("sha384").update(canonicalAgentJson(vector), "utf8").digest());
    expect(uaid(vector)).toBe(`uaid:aid:${expected};uid=0;registry=hol;proto=hcs-10;nativeId=hedera:testnet:0.0.123456`);
    expect(uaid(vector)).toBe(uaid({ ...vector, skills: [0, 17] }));
    expect(uaid(vector)).not.toBe(uaid({ ...vector, version: "1.0.1" }));
  });

  it("base58 keeps leading zero bytes as ones", () => {
    expect(base58(new Uint8Array([0, 0, 1]))).toBe("112");
    expect(base58(new Uint8Array([0xff]))).toBe("5Q");
  });

  it("rejects reserved skills and empty fields", () => {
    expect(() => canonicalAgentJson({ ...vector, skills: [45] })).toThrow();
    expect(() => canonicalAgentJson({ ...vector, name: " " })).toThrow();
  });

  it("parses what it emits", () => {
    const id = uaid(hederaAgent("scout", "0.1.0", "hedera:testnet", "0.0.10438429", { domain: "scree.hacklabs.in" }));
    const p = parseUaid(id)!;
    expect(p.target).toBe("aid");
    expect(p.params).toMatchObject({ uid: "0.0.10438429", registry: "scree", proto: "rest", nativeId: "hedera:testnet:0.0.10438429", domain: "scree.hacklabs.in" });
    expect(parseUaid("nonsense")).toBeNull();
  });
});
