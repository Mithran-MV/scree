import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { mainnet } from "viem/chains";

/**
 * Today's price from the oracle, not from the ledger's own price field.
 *
 * The subgraphs carry a price per market, and seven of them rarely agree to
 * the cent. The Chainlink ETH/USD aggregator on mainnet is one number with a
 * timestamp, and it is the number the lending protocols themselves liquidate
 * against. When it is fresh, the map's price axis is the oracle's.
 */
export const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" as const;

const abi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
]);

export interface OraclePrice {
  price: number;
  updatedAt: string;
  ageSeconds: number;
  feed: string;
  pair: string;
  network: "ethereum-mainnet";
  roundId: string;
}

/** A reading older than this is not today's price. Mainnet ETH/USD heartbeats hourly. */
export const MAX_AGE_SECONDS = 2 * 3600;

let cached: { at: number; value: OraclePrice } | null = null;

export async function readEthUsd(rpcUrl = process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com", now = Date.now()): Promise<OraclePrice> {
  if (cached && now - cached.at < 30_000) return cached.value;
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  const [round, decimals, description] = await Promise.all([
    client.readContract({ address: ETH_USD_FEED as Hex, abi, functionName: "latestRoundData" }),
    client.readContract({ address: ETH_USD_FEED as Hex, abi, functionName: "decimals" }),
    client.readContract({ address: ETH_USD_FEED as Hex, abi, functionName: "description" }),
  ]);
  const [roundId, answer, , updatedAt] = round;
  const price = Number(answer) / 10 ** Number(decimals);
  const updated = Number(updatedAt);
  const value: OraclePrice = {
    price,
    updatedAt: new Date(updated * 1000).toISOString(),
    ageSeconds: Math.max(0, Math.round(now / 1000 - updated)),
    feed: ETH_USD_FEED,
    pair: description,
    network: "ethereum-mainnet",
    roundId: roundId.toString(),
  };
  cached = { at: now, value };
  return value;
}

/** The oracle's price if it is fresh and sane, else null so the caller falls back. */
export function usableSpot(o: OraclePrice | null, subgraphSpot: number | null): number | null {
  if (!o || !(o.price > 0) || o.ageSeconds > MAX_AGE_SECONDS) return null;
  // A reading that disagrees with the ledgers by more than a fifth is a wrong feed or a broken RPC, not a market.
  if (subgraphSpot !== null && subgraphSpot > 0 && Math.abs(o.price / subgraphSpot - 1) > 0.2) return null;
  return o.price;
}
