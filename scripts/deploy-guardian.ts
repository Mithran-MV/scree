/**
 * Compile and deploy the Guardian verdict ledger.
 *
 *   npm run guardian:deploy                             # Sepolia, both forwarders below
 *   npm run guardian:deploy -- --forwarders 0xa,0xb     # an explicit list
 *   npm run guardian:deploy -- --compile-only           # just prove the source compiles
 *
 * Signs with BURNER_PRIVATE_KEY (testnet only). Writes the ABI and bytecode to
 * cre/contracts/Guardian.json, and on deploy prints the address to put in
 * cre/guardian/config.*.json under evm.guardian.
 */
import { readFileSync, writeFileSync } from "node:fs";
import solc from "solc";
import { createPublicClient, createWalletClient, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

/** The CRE KeystoneForwarder on Ethereum Sepolia, from the CLI's chain context. */
const SEPOLIA_FORWARDER = "0xf8344cfd5c43616a4366c34e3eee75af79a74482";
/**
 * The MockKeystoneForwarder the CRE simulator delivers through on Sepolia when
 * run with --broadcast. Allowed on this testnet ledger so simulated verdicts
 * land; it has no place on a production one.
 */
const SEPOLIA_SIMULATOR_FORWARDER = "0x15fc6ae953e024d975e77382eeec56a9101f9f88";

const args = process.argv.slice(2);
const compileOnly = args.includes("--compile-only");
const forwarders = (args.includes("--forwarders")
  ? (args[args.indexOf("--forwarders") + 1] ?? "").split(",").filter(Boolean)
  : [SEPOLIA_FORWARDER, SEPOLIA_SIMULATOR_FORWARDER]) as Hex[];

const source = readFileSync("cre/contracts/Guardian.sol", "utf8");
const input = {
  language: "Solidity",
  sources: { "Guardian.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { Guardian: ["abi", "evm.bytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input))) as {
  errors?: { severity: string; formattedMessage: string }[];
  contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>>;
};
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const artifact = out.contracts["Guardian.sol"]!.Guardian!;
writeFileSync(
  "cre/contracts/Guardian.json",
  JSON.stringify({ contractName: "Guardian", abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }, null, 2) + "\n",
);
console.log(`compiled     Guardian, ${artifact.evm.bytecode.object.length / 2} bytes, abi written to cre/contracts/Guardian.json`);
if (compileOnly) process.exit(0);

const key = process.env.BURNER_PRIVATE_KEY as Hex | undefined;
if (!key) {
  console.error("BURNER_PRIVATE_KEY is not set. Nothing was deployed.");
  process.exit(1);
}
const rpc = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

const balance = await publicClient.getBalance({ address: account.address });
console.log(`deployer     ${account.address}, ${(Number(balance) / 1e18).toFixed(4)} ETH on Sepolia`);
console.log(`forwarders   ${forwarders.join(", ")}`);

const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: `0x${artifact.evm.bytecode.object}` as Hex,
  args: [forwarders],
});
console.log(`tx           https://sepolia.etherscan.io/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error("deployment failed", receipt.status);
  process.exit(1);
}
console.log(`guardian     ${receipt.contractAddress}`);
console.log(`explorer     https://sepolia.etherscan.io/address/${receipt.contractAddress}`);
console.log(`\nPut it in cre/guardian/config.staging.json and config.production.json under evm.guardian.`);
