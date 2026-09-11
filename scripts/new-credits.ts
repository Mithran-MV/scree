/**
 * Survey credits: an HTS token as a second rail, with a fee schedule of its own.
 *
 * SRV is a fungible token the service issues as treasury. Its custom fee
 * schedule takes a small fraction of every transfer back to the service, so
 * the rail carries its own metering on-chain: paying in credits costs the
 * quote plus the token's fee, which the network assesses, not the service.
 *
 *   npm run hedera:credits                  # create the token, associate the agent, send it credits
 *   npm run hedera:credits -- --send 500    # send more credits to the agent
 *
 * Needs the service operator (HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY) and the
 * agent (AGENT_HEDERA_ACCOUNT_ID / BURNER_PRIVATE_KEY) in the environment.
 * Afterwards put the printed id in SURVEY_CREDITS_TOKEN.
 */
import {
  AccountId,
  CustomFractionalFee,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenSupplyType,
  TokenType,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { loadLocalEnv } from "./lib/env";
import { hederaClient, operatorFromEnv } from "../src/hedera/receipts";

loadLocalEnv();

export const CREDITS = { symbol: "SRV", name: "Scree survey credit", decimals: 2, initialSupply: 1_000_000_00 } as const;

const op = operatorFromEnv();
const agentId = process.env.AGENT_HEDERA_ACCOUNT_ID;
const agentKey = process.env.BURNER_PRIVATE_KEY;
if (!op || !agentId || !agentKey) {
  console.error("HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY, AGENT_HEDERA_ACCOUNT_ID and BURNER_PRIVATE_KEY are needed.");
  process.exit(1);
}
const args = process.argv.slice(2);
const sendArg = args.includes("--send") ? Number.parseFloat(args[args.indexOf("--send") + 1] ?? "0") : 0;
let tokenId = process.env.SURVEY_CREDITS_TOKEN ?? "";

const service = hederaClient(op);
const agent = hederaClient({ ...op, accountId: agentId, privateKey: agentKey });
try {
  if (!tokenId) {
    // One part in fifty of every transfer comes back to the service, floor one hundredth, cap one credit.
    const fee = new CustomFractionalFee()
      .setNumerator(1)
      .setDenominator(50)
      .setMin(1)
      .setMax(100)
      .setFeeCollectorAccountId(AccountId.fromString(op.accountId));
    const create = await new TokenCreateTransaction()
      .setTokenName(CREDITS.name)
      .setTokenSymbol(CREDITS.symbol)
      .setTokenType(TokenType.FungibleCommon)
      .setSupplyType(TokenSupplyType.Infinite)
      .setDecimals(CREDITS.decimals)
      .setInitialSupply(CREDITS.initialSupply)
      .setTreasuryAccountId(AccountId.fromString(op.accountId))
      .setSupplyKey(PrivateKey.fromStringECDSA(op.privateKey))
      .setFeeScheduleKey(PrivateKey.fromStringECDSA(op.privateKey))
      .setCustomFees([fee])
      .setTokenMemo("scree survey credits: one credit buys one source of a survey; a fiftieth of each transfer returns to the service")
      // A token with a fee schedule costs about two dollars at the network's rate; the SDK's default cap is higher than a testnet account holds.
      .setMaxTransactionFee(new Hbar(36))
      .execute(service);
    const receipt = await create.getReceipt(service);
    tokenId = receipt.tokenId!.toString();
    console.log(`token        ${tokenId} (${CREDITS.symbol}, ${CREDITS.decimals} decimals, fee 1/50 to ${op.accountId})`);
    console.log(`explorer     https://hashscan.io/${op.network.endsWith("mainnet") ? "mainnet" : "testnet"}/token/${tokenId}`);
    console.log(`\nAdd to .env.local:\n  SURVEY_CREDITS_TOKEN=${tokenId}`);

    const assoc = await new TokenAssociateTransaction().setAccountId(AccountId.fromString(agentId)).setTokenIds([TokenId.fromString(tokenId)]).execute(agent);
    await assoc.getReceipt(agent);
    console.log(`associated   ${agentId} with ${tokenId}`);
  }
  const credits = sendArg > 0 ? sendArg : tokenId && !process.env.SURVEY_CREDITS_TOKEN ? 200 : 0;
  if (credits > 0) {
    const units = Math.round(credits * 10 ** CREDITS.decimals);
    const tx = await new TransferTransaction()
      .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(op.accountId), -units)
      .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(agentId), units)
      .execute(service);
    const r = await tx.getReceipt(service);
    console.log(`sent         ${credits} ${CREDITS.symbol} to ${agentId} (${r.status.toString()}); the fee schedule took its fiftieth on the way`);
  }
} finally {
  service.close();
  agent.close();
}
