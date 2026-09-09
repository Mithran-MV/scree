# The private terrace

A [CRE](https://docs.chain.link/cre) Confidential Workflow that reads a wallet's
survey inside an enclave, compares it with a policy the owner never publishes,
and records only a verdict on-chain.

Scree draws the field a wallet's liquidation stands in. The owner of that
wallet has a line in it: the health they refuse to fall below, the price they
refuse to be liquidated above, and how much of a lift they are willing to buy.
That line is exactly what a watcher of the chain must not learn; if the level
at which a whale defends is public, so is the level at which to push. This
workflow keeps it inside a TEE.

## What runs where

```
cron trigger (Workflow DON)
  │
  ▼
╔════════════════════════════ ENCLAVE ═══════════════════════════════╗
║ 1. runtime.getSecret({ id: 'TERRACE_POLICY' })                     ║
║      the owner's line, released by the Vault DON into the enclave  ║
║ 2. HTTPClient.sendRequest(runtime, survey?address=…)               ║
║      the wallet's baskets across every deployment, spot, shape     ║
║ 3. decide(survey, policy)                                          ║
║      health today, the crash coast, HOLD / RAISE / DROWNED, lift   ║
╚════════════════════════════╤═══════════════════════════════════════╝
                             │ runtime.usingTheDons()
                             │ crosses out: wallet, verdict, health to the hundredth, lift
                             ▼
Workflow DON: report(…) signed under consensus
  │
  ▼
EVMClient.writeReport → KeystoneForwarder → Guardian.onReport (Sepolia)
```

The survey body, the policy, and the exact health stay in the enclave. The
ledger learns that a terrace was raised, and by how much health, never where
the owner's line is.

## Files

| Path | What it is |
|---|---|
| `guardian/workflow.ts` | the handler registered with `cre.handlerInTee`, the arithmetic, the decision |
| `guardian/workflow.test.ts` | the arithmetic and the decision under `bun test`, with a fake TEE runtime |
| `guardian/config.*.json` | public config: schedule, survey URL, the wallet, the ledger address |
| `secrets.yaml` | maps `TERRACE_POLICY` to the environment variable behind it |
| `contracts/Guardian.sol` | the verdict ledger, a CRE `IReceiver` that trusts a set of forwarders |
| `contracts/Guardian.json` | its ABI and bytecode, as compiled |
| `evidence/` | simulator transcripts and the ledger read back, from real runs |

The policy is JSON, held as a secret:

```json
{"minHealth": 1.6, "floorPrice": 1200, "maxLift": 0.3}
```

## Running it

```bash
cp .env.example .env         # CRE_ETH_PRIVATE_KEY (testnet), SECRET_TERRACE_POLICY
bun install --cwd ./guardian
cd guardian && bun test && cd ..
cre workflow simulate guardian --target staging-settings --non-interactive --trigger-index 0
```

The simulator is not a real enclave and says so; it exercises the same
`handlerInTee` registration, secret fetch, in-enclave request and DON
crossing. Add `--broadcast` and the signed report is delivered to the ledger
on Sepolia through the simulator's forwarder:

```
[USER LOG] Enclave decision for 0xb7b7…6fd4: RAISE
✓ Workflow Simulation Result:
"RAISE (lift 0.161 health) recorded on ethereum-testnet-sepolia, tx 0x1855e4…3c04"
```

Read it back from the ledger with the root project's `npm run guardian:read`:

```
guardian     0x9e87c0d92585b7a57c050bfa77e0d4e15dcc7c66 on Sepolia, 1 verdicts
latest       RAISE  health 1.47  lift 0.16
event        VerdictRecorded {"verdict":1,"healthBps":14700,"liftBps":1600,…}
```

## The ledger

`Guardian.sol` is deployed on Sepolia at
[`0x9e87c0d92585b7a57c050bfa77e0d4e15dcc7c66`](https://sepolia.etherscan.io/address/0x9e87c0d92585b7a57c050bfa77e0d4e15dcc7c66).
It accepts reports from the network's KeystoneForwarder and, because this is
a testnet ledger meant to receive simulated runs, from the simulator's
MockKeystoneForwarder as well. A production ledger would list the real
forwarder alone; the owner can change the set. `npm run guardian:deploy` in
the root project compiles and deploys a fresh one.

## What the enclave decides

Health at a price is the lowest, across deployments, of
`(a·P + c) / (u·P + v)`, the same kernel the map uses. The crash coast is the
highest price at which some deployment reaches one from below. Then:

- `DROWNED` if health is under one at today's price.
- `RAISE` if health is under `minHealth`, or the coast is at or above
  `floorPrice`. The lift is the larger of the two gaps, first order: health
  scales the coast down in proportion, so moving it under the floor needs
  `health × coast / floorPrice`. Capped at `maxLift`.
- `HOLD` otherwise.

The decision is deterministic for a given survey and policy, as an attested
enclave result has to be.
