import {
	bytesToHex,
	cre,
	getNetwork,
	hexToBase64,
	ok,
	text,
	TxStatus,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters, type Address } from 'viem'
import { z } from 'zod'

/**
 * The private terrace.
 *
 * Scree draws the field a wallet's liquidation stands in. This workflow reads
 * that field inside an enclave and compares it with a policy the owner never
 * publishes: the health they refuse to fall below, the price they refuse to be
 * liquidated above, and how much of a lift they are willing to buy. The survey
 * response (which deployments the wallet borrows from, and how much) and the
 * policy both stay inside the enclave. What crosses back to the DON, and from
 * there to the Guardian contract, is a verdict, a coarse health, and the lift
 * the verdict asks for. A watcher of the chain learns that a terrace was
 * raised, never where the owner's line is.
 */

// ─── Config Schema ──────────────────────────────────────────
export const configSchema = z.object({
	schedule: z.string(),
	/** The survey to read, e.g. https://scree.hacklabs.in/api/terrain */
	surveyUrl: z.string().regex(/^https?:\/\/\S+$/),
	/** The wallet under guard. Public: it is what the verdict is about. */
	wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
	/** Optional `?sources=` restriction on the survey. */
	sources: z.string().optional(),
	/** The Vault DON secret holding the policy JSON. */
	policySecretId: z.string(),
	/** Where the verdict goes. Omit to stop at the signed report. */
	evm: z
		.object({
			chainSelectorName: z.string(),
			guardian: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
			gasLimit: z.string().optional(),
		})
		.optional(),
})
export type Config = z.infer<typeof configSchema>

// ─── The confidential inputs ────────────────────────────────

/** The owner's line, held as a Vault DON secret and parsed inside the enclave. */
export const policySchema = z.object({
	/** Health the owner refuses to fall below. */
	minHealth: z.number().gt(1),
	/** Price the owner refuses to be liquidated above, on the crash side. */
	floorPrice: z.number().gt(0),
	/** The most health they are willing to buy in one lift. */
	maxLift: z.number().gt(0),
})
export type Policy = z.infer<typeof policySchema>

/** One deployment's position, as the survey reduces it. Health is (aP + c) / (uP + v). */
const basketSchema = z.object({
	deploymentId: z.string(),
	a: z.number(),
	c: z.number(),
	u: z.number(),
	v: z.number(),
})
const surveySchema = z.object({
	address: z.string(),
	spot: z.number().nullable(),
	baskets: z.array(basketSchema),
	shape: z.string(),
	readAt: z.string(),
})
export type Survey = z.infer<typeof surveySchema>
type Basket = z.infer<typeof basketSchema>

// ─── The arithmetic, the same as the map's ──────────────────

export const healthOf = (b: Basket, price: number): number => {
	const debt = b.u * price + b.v
	if (debt <= 0) return Number.POSITIVE_INFINITY
	return (b.a * price + b.c) / debt
}

/** The lowest health across deployments at a price: the map's elevation plus one. */
export const healthToday = (baskets: Basket[], price: number): number =>
	baskets.reduce((low, b) => Math.min(low, healthOf(b, price)), Number.POSITIVE_INFINITY)

/** The highest price at which some deployment's health reaches one from below: the crash coast. */
export const crashPrice = (baskets: Basket[], spot: number): number | null => {
	let coast: number | null = null
	for (const b of baskets) {
		// Health equals one where aP + c = uP + v, so P = (v - c) / (a - u), for a book long the asset.
		if (b.a <= b.u) continue
		const p = (b.v - b.c) / (b.a - b.u)
		if (p > 0 && p < spot && (coast === null || p > coast)) coast = p
	}
	return coast
}

export const VERDICT = { HOLD: 0, RAISE: 1, DROWNED: 2 } as const
export type VerdictName = keyof typeof VERDICT

export interface Decision {
	verdict: VerdictName
	health: number
	crash: number | null
	lift: number
}

/**
 * The decision, over the confidential inputs.
 *
 * Deterministic for a given survey and policy, as an attested enclave result
 * must be. A lift is first order: health scales the crash coast down in
 * proportion, so moving the coast below the floor needs health × coast / floor.
 */
export const decide = (survey: Survey, policy: Policy): Decision => {
	const spot = survey.spot
	if (spot === null || survey.baskets.length === 0) {
		return { verdict: 'HOLD', health: Number.POSITIVE_INFINITY, crash: null, lift: 0 }
	}
	const health = healthToday(survey.baskets, spot)
	const crash = crashPrice(survey.baskets, spot)
	if (health < 1) return { verdict: 'DROWNED', health, crash, lift: 0 }

	let lift = 0
	if (health < policy.minHealth) lift = Math.max(lift, policy.minHealth - health)
	if (crash !== null && crash >= policy.floorPrice) lift = Math.max(lift, (health * crash) / policy.floorPrice - health)
	if (lift <= 0) return { verdict: 'HOLD', health, crash, lift: 0 }
	return { verdict: 'RAISE', health, crash, lift: Math.min(lift, policy.maxLift) }
}

/** Health to the nearest hundredth, in basis points, so the exact number never leaves. */
export const coarseBps = (x: number): number => {
	if (!Number.isFinite(x)) return 0xffffffff
	return Math.min(0xffffffff, Math.max(0, Math.round(x * 100) * 100))
}

// ─── TEE Cron Callback ──────────────────────────────────────
// A `TeeRuntime`: everything here runs inside the enclave until `usingTheDons()`.
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config

	// The policy is released by the Vault DON into the attested enclave only.
	const policy = policySchema.parse(JSON.parse(runtime.getSecret({ id: config.policySecretId }).result().value))

	// The survey is fetched from inside the enclave; its body, the wallet's
	// positions across every deployment, is confidential from node operators.
	// Built by hand: the WASM runtime the workflow compiles to has no URL class.
	const query = `address=${encodeURIComponent(config.wallet)}${config.sources ? `&sources=${encodeURIComponent(config.sources)}` : ''}`
	const url = `${config.surveyUrl}${config.surveyUrl.includes('?') ? '&' : '?'}${query}`
	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, { url, method: 'GET' })
		.result()
	if (!ok(response)) {
		throw new Error(`survey request failed with status: ${response.statusCode}`)
	}
	const survey = surveySchema.parse(JSON.parse(text(response)))

	const decision = decide(survey, policy)

	// Simulator only: never log the policy, the survey, or the exact health.
	runtime.log(`Enclave decision for ${config.wallet}: ${decision.verdict}`)

	// ── Cross back to the DON with the verdict and nothing else ──
	const donRuntime = runtime.usingTheDons()
	const observedAt = BigInt(Math.floor(Date.parse(survey.readAt) / 1000))
	const encodedPayload = encodeAbiParameters(
		parseAbiParameters('address wallet, uint8 verdict, uint32 healthBps, uint32 liftBps, uint64 observedAt'),
		[config.wallet as Address, VERDICT[decision.verdict], coarseBps(decision.health), coarseBps(decision.lift), observedAt],
	)
	const report = donRuntime
		.report({
			encodedPayload: hexToBase64(encodedPayload),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	if (!config.evm) {
		return `${decision.verdict} (lift ${decision.lift.toFixed(3)} health, report signed, no chain configured)`
	}

	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.evm.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`network not found: ${config.evm.chainSelectorName}`)
	const evm = new cre.capabilities.EVMClient(network.chainSelector.selector)
	const write = evm
		.writeReport(donRuntime, {
			receiver: config.evm.guardian as Address,
			report,
			gasConfig: { gasLimit: config.evm.gasLimit ?? '300000' },
		})
		.result()
	if (write.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`verdict not delivered: ${write.errorMessage || write.txStatus}`)
	}
	// The forwarder's transaction can succeed while the receiver refuses the
	// report; that is a failure of this workflow, not a delivery.
	if (write.receiverContractExecutionStatus !== undefined && write.receiverContractExecutionStatus !== 0) {
		throw new Error(`the ledger refused the verdict: status ${write.receiverContractExecutionStatus}`)
	}
	const txHash = bytesToHex(write.txHash || new Uint8Array(32))
	return `${decision.verdict} (lift ${decision.lift.toFixed(3)} health) recorded on ${config.evm.chainSelectorName}, tx ${txHash}`
}

// ─── Workflow Init ──────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
