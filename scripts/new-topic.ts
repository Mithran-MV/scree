/**
 * Create the HCS topic that receives one receipt per paid survey.
 *
 * Run once per deployment with the service account in the environment, then
 * put the printed id in `HCS_RECEIPTS_TOPIC`. Creating a topic costs a fraction
 * of an HBAR; on testnet, nothing real.
 *
 *   npm run hedera:topic
 */
import { loadLocalEnv } from "./lib/env";
import { createReceiptsTopic, hashscanUrl, operatorFromEnv } from "../src/hedera/receipts";

loadLocalEnv();

const op = operatorFromEnv();
if (!op) {
  console.error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are not set. Nothing was created.");
  process.exit(1);
}

const memo = process.argv[2] ?? "scree: receipts of paid liquidation surveys";
const topic = await createReceiptsTopic(op, memo);
console.log(`topic        ${topic}`);
console.log(`explorer     ${hashscanUrl(op.network, "topic", topic)}`);
console.log(`\nAdd to .env.local:\n  HCS_RECEIPTS_TOPIC=${topic}`);
