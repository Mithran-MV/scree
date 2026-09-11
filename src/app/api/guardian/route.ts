import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { ADDRESS } from "@/survey/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Guardian ledger on Sepolia: the confidential workflow's verdicts, as the forwarder delivered them. */
const DEFAULT_GUARDIAN = "0x748d9c5791059f97dcaf950c6fe92c6b80451bd2";
const VERDICTS = ["HOLD", "RAISE", "DROWNED"] as const;

const abi = parseAbi([
  "function count() view returns (uint256)",
  "function latest(address wallet) view returns (uint8 verdict, uint32 healthBps, uint32 liftBps, uint64 observedAt, uint64 recordedAt, bytes32 policyHash)",
]);

export interface GuardianReading {
  guardian: string;
  count: number;
  wallet: string;
  verdict: (typeof VERDICTS)[number] | null;
  /** Health to the hundredth, as the enclave let it out. */
  health: number | null;
  lift: number | null;
  policyHash: string | null;
  observedAt: string | null;
  recordedAt: string | null;
  links: { contract: string; events: string };
}

/**
 * What the enclave decided about a wallet, read back from the chain.
 *
 * The policy that produced the verdict never left the enclave; its hash did,
 * and is returned so the owner can prove which line the verdict was measured
 * against. Anyone can read the same slot from the same contract.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("address")?.trim() ?? "";
  if (!ADDRESS.test(wallet)) {
    return NextResponse.json({ error: "expected a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  const guardian = (process.env.GUARDIAN_ADDRESS ?? DEFAULT_GUARDIAN) as Hex;
  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
  });
  try {
    const [count, latest] = await Promise.all([
      client.readContract({ address: guardian, abi, functionName: "count" }),
      client.readContract({ address: guardian, abi, functionName: "latest", args: [wallet as Hex] }),
    ]);
    const [verdict, healthBps, liftBps, observedAt, recordedAt, policyHash] = latest;
    const recorded = recordedAt !== 0n;
    const reading: GuardianReading = {
      guardian,
      count: Number(count),
      wallet,
      verdict: recorded ? (VERDICTS[verdict] ?? null) : null,
      health: recorded ? healthBps / 10000 : null,
      lift: recorded ? liftBps / 10000 : null,
      policyHash: recorded ? policyHash : null,
      observedAt: recorded ? new Date(Number(observedAt) * 1000).toISOString() : null,
      recordedAt: recorded ? new Date(Number(recordedAt) * 1000).toISOString() : null,
      links: {
        contract: `https://sepolia.etherscan.io/address/${guardian}`,
        events: `https://sepolia.etherscan.io/address/${guardian}#events`,
      },
    };
    return NextResponse.json(reading, { headers: { "cache-control": "public, max-age=20" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
