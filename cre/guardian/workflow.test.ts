import { describe, expect } from 'bun:test'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { decodeAbiParameters, parseAbiParameters } from 'viem'
import { coarseBps, crashPrice, decide, healthToday, onCronTrigger, type Config, type Survey } from './workflow'

const WALLET = '0xb7b7eb7e9611975bc9715f22ce7e6ee288296fd4'

const policy = { minHealth: 1.6, floorPrice: 1200, maxLift: 0.3 }

/** Two deployments long ETH against stable debt, and one flat, like the live demo wallet. */
const survey: Survey = {
	address: WALLET,
	spot: 2500,
	baskets: [
		{ deploymentId: 'aave-v3-ethereum', a: 1874.7, c: 4_990_081, u: 0, v: 6_584_179 },
		{ deploymentId: 'aave-v3-avalanche', a: 0, c: 197_692, u: 0, v: 124_928 },
		{ deploymentId: 'spark-ethereum', a: 420, c: 0, u: 0, v: 559_425 },
	],
	shape: 'LONG-ONLY',
	readAt: '2026-09-09T13:00:00.000Z',
}

const makeConfig = (evm = false): Config => ({
	schedule: '0 */5 * * * *',
	surveyUrl: 'https://scree.hacklabs.in/api/terrain',
	wallet: WALLET,
	policySecretId: 'TERRACE_POLICY',
	...(evm ? { evm: { chainSelectorName: 'ethereum-testnet-sepolia', guardian: '0x0000000000000000000000000000000000000001' } } : {}),
})

const makeFakeTeeRuntime = ({ statusCode = 200, body = JSON.stringify(survey), secret = JSON.stringify(policy) } = {}) => {
	const reports: { encodedPayload: string }[] = []
	const logs: string[] = []
	const runtime = {
		config: makeConfig(),
		getSecret: (request: { id?: string }) => ({ result: () => ({ id: request.id, value: secret }) }),
		callCapability: () => ({
			result: () => ({ statusCode, body: new TextEncoder().encode(body) }),
		}),
		log: (message: string) => logs.push(message),
		usingTheDons: () => ({
			report: (input: { encodedPayload: string }) => {
				reports.push(input)
				return { result: () => ({}) }
			},
		}),
	}
	return { runtime: runtime as unknown as TeeRuntime<Config>, reports, logs }
}

describe('the arithmetic', () => {
	test('health today is the lowest deployment, as on the map', () => {
		const h = healthToday(survey.baskets, 2500)
		expect(h).toBeCloseTo(1.469, 2)
	})
	test('the crash coast is the highest price at which some deployment reaches one', () => {
		expect(crashPrice(survey.baskets, 2500)).toBeCloseTo(1332, 0)
	})
	test('coarse health never carries the hundredths', () => {
		expect(coarseBps(1.4712)).toBe(14700)
		expect(coarseBps(1.4751)).toBe(14800)
		expect(coarseBps(Number.POSITIVE_INFINITY)).toBe(0xffffffff)
	})
})

describe('the decision', () => {
	test('RAISEs when health is under the private floor, by the gap', () => {
		// The coast at ~$1,332 is below this floor, so only the health rule binds.
		const d = decide(survey, { minHealth: 1.6, floorPrice: 1400, maxLift: 0.3 })
		expect(d.verdict).toBe('RAISE')
		expect(d.lift).toBeCloseTo(1.6 - d.health, 6)
	})
	test('takes the larger of the two lifts when both rules bind', () => {
		const d = decide(survey, policy)
		expect(d.verdict).toBe('RAISE')
		expect(d.lift).toBeCloseTo((d.health * d.crash!) / 1200 - d.health, 6)
		expect(d.lift).toBeGreaterThan(1.6 - d.health)
	})
	test('HOLDs when the policy is satisfied', () => {
		const d = decide(survey, { minHealth: 1.2, floorPrice: 1400, maxLift: 0.3 })
		expect(d.verdict).toBe('HOLD')
		expect(d.lift).toBe(0)
	})
	test('RAISEs to move the coast under the floor price, first order', () => {
		const d = decide(survey, { minHealth: 1.2, floorPrice: 1300, maxLift: 1 })
		expect(d.verdict).toBe('RAISE')
		expect(d.lift).toBeCloseTo((d.health * d.crash!) / 1300 - d.health, 6)
	})
	test('caps the lift at what the owner will buy', () => {
		const d = decide(survey, { minHealth: 3, floorPrice: 1000, maxLift: 0.25 })
		expect(d.lift).toBe(0.25)
	})
	test('DROWNED when the book is under water at spot', () => {
		const d = decide({ ...survey, spot: 900 }, policy)
		expect(d.verdict).toBe('DROWNED')
	})
	test('HOLDs an empty book', () => {
		expect(decide({ ...survey, baskets: [] }, policy).verdict).toBe('HOLD')
	})
})

describe('onCronTrigger', () => {
	test('reads the policy from the enclave secret and the survey from the enclave request', () => {
		const { runtime } = makeFakeTeeRuntime()
		expect(onCronTrigger(runtime)).toContain('RAISE')
	})
	test('crosses back with the verdict, coarse health and lift, and nothing else', () => {
		const { runtime, reports, logs } = makeFakeTeeRuntime()
		onCronTrigger(runtime)
		expect(reports).toHaveLength(1)
		const hex = `0x${Buffer.from(reports[0]!.encodedPayload, 'base64').toString('hex')}` as `0x${string}`
		const [wallet, verdict, healthBps, liftBps] = decodeAbiParameters(
			parseAbiParameters('address wallet, uint8 verdict, uint32 healthBps, uint32 liftBps, uint64 observedAt'),
			hex,
		)
		expect(wallet.toLowerCase()).toBe(WALLET)
		expect(verdict).toBe(1)
		expect(healthBps).toBe(14700)
		const d = decide(survey, policy)
		expect(liftBps).toBe(coarseBps(d.lift))
		expect(liftBps).toBe(1600)
		// The policy numbers must not appear in anything that left the enclave.
		for (const line of logs) expect(line).not.toContain('1.6')
	})
	test('refuses a policy that is not one', () => {
		const { runtime } = makeFakeTeeRuntime({ secret: '{"minHealth":0.5}' })
		expect(() => onCronTrigger(runtime)).toThrow()
	})
	test('throws on a failed survey and never reaches the DON', () => {
		const { runtime, reports } = makeFakeTeeRuntime({ statusCode: 503 })
		expect(() => onCronTrigger(runtime)).toThrow('status: 503')
		expect(reports).toHaveLength(0)
	})
})
