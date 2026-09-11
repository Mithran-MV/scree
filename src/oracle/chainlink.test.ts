import { describe, expect, it } from "vitest";
import { MAX_AGE_SECONDS, usableSpot, type OraclePrice } from "./chainlink";

const reading = (over: Partial<OraclePrice> = {}): OraclePrice => ({
  price: 2500,
  updatedAt: "2026-09-11T12:00:00.000Z",
  ageSeconds: 600,
  feed: "0xfeed",
  pair: "ETH / USD",
  network: "ethereum-mainnet",
  roundId: "1",
  ...over,
});

describe("the oracle's price", () => {
  it("is used when fresh and in agreement with the ledgers", () => {
    expect(usableSpot(reading(), 2480)).toBe(2500);
    expect(usableSpot(reading(), null)).toBe(2500);
  });
  it("is set aside when stale, absent, or far from what the ledgers say", () => {
    expect(usableSpot(reading({ ageSeconds: MAX_AGE_SECONDS + 1 }), 2480)).toBeNull();
    expect(usableSpot(null, 2480)).toBeNull();
    expect(usableSpot(reading({ price: 4000 }), 2480)).toBeNull();
    expect(usableSpot(reading({ price: 0 }), 2480)).toBeNull();
  });
});
