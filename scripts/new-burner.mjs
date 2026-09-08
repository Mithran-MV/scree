/**
 * Generate a throwaway testnet keypair for local development.
 *
 * This key is for testnet only. It is written to .env.local, which is ignored by
 * git, and it must never hold mainnet funds. Regenerating is free: run the script
 * again and fund the new address.
 *
 *   node scripts/new-burner.mjs
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV = ".env.local";

if (existsSync(ENV) && readFileSync(ENV, "utf8").includes("BURNER_PRIVATE_KEY=0x")) {
  const existing = readFileSync(ENV, "utf8").match(/BURNER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/);
  if (existing && !process.argv.includes("--force")) {
    const account = privateKeyToAccount(existing[1]);
    console.log(`A burner already exists: ${account.address}`);
    console.log("Pass --force to replace it. The old key and its funds would be lost.");
    process.exit(0);
  }
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

const previous = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
const kept = previous
  .split("\n")
  .filter((line) => !line.startsWith("BURNER_PRIVATE_KEY=") && !line.startsWith("BURNER_ADDRESS="))
  .join("\n")
  .trim();

writeFileSync(
  ENV,
  `${kept ? kept + "\n\n" : ""}# Testnet burner. Never fund this with real value.\n` +
    `BURNER_PRIVATE_KEY=${privateKey}\nBURNER_ADDRESS=${account.address}\n`,
);

console.log(`address     ${account.address}`);
console.log(`written to  ${ENV} (git-ignored)`);
