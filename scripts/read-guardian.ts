/**
 * Read the Guardian ledger back from Sepolia: how many verdicts it holds, the
 * latest one for a wallet, and, given a transaction hash, the delivery.
 *
 *   npm run guardian:read -- [0xwallet] [0xtxhash]
 */
import { readFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, http, type Abi, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

const GUARDIAN = (process.env.GUARDIAN_ADDRESS ?? "0x748d9c5791059f97dcaf950c6fe92c6b80451bd2") as Hex;
const VERDICTS = ["HOLD", "RAISE", "DROWNED"] as const;

const { abi } = JSON.parse(readFileSync("cre/contracts/Guardian.json", "utf8")) as { abi: Abi };
const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
});

const wallet = (process.argv[2] ?? "0xb7b7eb7e9611975bc9715f22ce7e6ee288296fd4") as Hex;
const tx = process.argv[3] as Hex | undefined;

const count = await client.readContract({ address: GUARDIAN, abi, functionName: "count" });
const FORWARDERS = {
  KeystoneForwarder: "0xf8344cfd5c43616a4366c34e3eee75af79a74482",
  MockKeystoneForwarder: "0x15fc6ae953e024d975e77382eeec56a9101f9f88",
} as const;
const trusted: string[] = [];
for (const [name, addr] of Object.entries(FORWARDERS)) {
  if (await client.readContract({ address: GUARDIAN, abi, functionName: "forwarders", args: [addr as Hex] })) trusted.push(name);
}
const latest = (await client.readContract({ address: GUARDIAN, abi, functionName: "latest", args: [wallet] })) as readonly [
  number, number, number, bigint, bigint, Hex,
];
console.log(`guardian     ${GUARDIAN} on Sepolia, ${count} verdicts, trusts ${trusted.join(" and ")}`);
console.log(`wallet       ${wallet}`);
if (latest[4] === 0n) {
  console.log("latest       none recorded");
} else {
  console.log(`latest       ${VERDICTS[latest[0]] ?? latest[0]}  health ${(latest[1] / 10000).toFixed(2)}  lift ${(latest[2] / 10000).toFixed(2)}`);
  console.log(`observed     ${new Date(Number(latest[3]) * 1000).toISOString()}`);
  console.log(`recorded     ${new Date(Number(latest[4]) * 1000).toISOString()}`);
  console.log(`policy       ${latest[5]} (keccak256 of the private policy)`);
}
if (tx) {
  const receipt = await client.getTransactionReceipt({ hash: tx });
  console.log(`delivery     ${receipt.status}, block ${receipt.blockNumber}, from ${receipt.from} via ${receipt.to}`);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== GUARDIAN.toLowerCase()) continue;
    const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
    console.log(`event        ${ev.eventName} ${JSON.stringify(ev.args, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  }
  console.log(`explorer     https://sepolia.etherscan.io/tx/${tx}`);
}
