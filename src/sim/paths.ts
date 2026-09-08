import type { Basket } from "../core/types";
import { dwellYears, elevation } from "../core/kernel";
import { dwellSeries } from "./dwell";
import { seededRng } from "./rng";

export interface WalkOptions {
  /** Starting price of the charted asset. */
  spot: number;
  /** How many paths to walk. */
  count: number;
  /** How far ahead to walk, in days. */
  horizonDays: number;
  /** Samples per path. More steps means finer dwell resolution and more cost. */
  steps: number;
  /** Annualised volatility as a decimal, e.g. 0.65 for 65%. */
  volatility: number;
  /** Annualised drift. Zero is the honest default: this is not a forecast. */
  drift?: number;
  seed: number;
}

export interface Path {
  prices: number[];
  dwellDays: number[];
  /** Index of the step where the path first crossed the shoreline, or null. */
  diedAt: number | null;
}

export interface WalkResult {
  paths: Path[];
  survived: number;
  total: number;
  /** Share of paths that never crossed the shoreline, 0..1. */
  survivalRate: number;
}

/**
 * Walk price paths and ask, at every step, whether the wallet is above sea level
 * at that price *and* that dwell.
 *
 * The dwell coordinate is the reason this is worth doing at all. A path that
 * dips below a threshold and recovers within an hour traces a different route
 * across the plane than one that dips and stays, so the two are allowed to have
 * different outcomes — which is exactly the distinction a single trigger price
 * cannot express.
 *
 * Geometric Brownian motion in log space, one asset, no correlation structure.
 * That is a deliberate simplification and it is stated on the map: this walks
 * the charted asset only and holds every other price still.
 */
export function walkPaths(baskets: readonly Basket[], options: WalkOptions): WalkResult {
  const { spot, count, horizonDays, steps, volatility, seed } = options;
  const drift = options.drift ?? 0;

  const stepDays = horizonDays / steps;
  const dt = stepDays / 365;
  const sqrtDt = Math.sqrt(dt);
  const adjustedDrift = (drift - (volatility * volatility) / 2) * dt;

  const rng = seededRng(seed);
  const paths: Path[] = [];
  let survived = 0;

  for (let p = 0; p < count; p++) {
    const prices = new Array<number>(steps + 1);
    prices[0] = spot;
    let logPrice = Math.log(spot);
    for (let i = 1; i <= steps; i++) {
      logPrice += adjustedDrift + volatility * sqrtDt * rng.normal();
      prices[i] = Math.exp(logPrice);
    }

    const dwells = dwellSeries(prices, stepDays);

    let diedAt: number | null = null;
    for (let i = 0; i <= steps; i++) {
      if (elevation(baskets, prices[i]!, dwellYears(dwells[i]!)) < 0) {
        diedAt = i;
        break;
      }
    }
    if (diedAt === null) survived++;

    paths.push({ prices, dwellDays: dwells, diedAt });
  }

  return { paths, survived, total: count, survivalRate: count === 0 ? 1 : survived / count };
}
