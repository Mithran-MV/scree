import type { Basket } from "./types";
import { exposure, liquidationPrice } from "./kernel";

/**
 * The two prices that bracket a wallet, at a given dwell.
 *
 *   lower — the highest price at which some long basket dies. A crash through
 *           this level liquidates you.
 *   upper — the lowest price at which some short basket dies. A pump through
 *           this level liquidates you.
 *
 * A wallet with both is survivable only between them, and that interval is the
 * only reason the terrain has a crest instead of a slope.
 */
export interface Bracket {
  lower: number | null;
  upper: number | null;
  lowerBinder: string | null;
  upperBinder: string | null;
}

export function bracket(baskets: readonly Basket[], t: number): Bracket {
  let lower: number | null = null;
  let upper: number | null = null;
  let lowerBinder: string | null = null;
  let upperBinder: string | null = null;

  for (const b of baskets) {
    const P = liquidationPrice(b, t);
    if (P === null) continue;
    const side = exposure(b);
    if (side === "LONG" && (lower === null || P > lower)) {
      lower = P;
      lowerBinder = b.deploymentId;
    } else if (side === "SHORT" && (upper === null || P < upper)) {
      upper = P;
      upperBinder = b.deploymentId;
    }
  }
  return { lower, upper, lowerBinder, upperBinder };
}

/**
 * Where the ridge sits and how high it stands, for a book whose long and short
 * legs are both *pure* — the charted asset on one side only, nothing else.
 *
 * For that case the crest of `min(P/lower, upper/P)` is exact:
 *
 *   ridge price     = sqrt(lower * upper)
 *   crest elevation = sqrt(upper / lower) - 1
 *
 * An affine leg (other collateral, or other debt) bends its own curve, so the
 * ridge shifts off the geometric mean and must be found on the raster instead.
 * `exact` reports which case you are in, so nothing downstream quotes a
 * closed form that does not hold.
 */
export interface Crest {
  price: number;
  elevation: number;
  exact: boolean;
}

export function closedFormCrest(
  baskets: readonly Basket[],
  t: number,
): Crest | null {
  const { lower, upper } = bracket(baskets, t);
  if (lower === null || upper === null) return null;
  if (upper <= lower) return null; // no survivable interval at this dwell
  const pure = baskets.every((b) => isPureLeg(b));
  return {
    price: Math.sqrt(lower * upper),
    elevation: Math.sqrt(upper / lower) - 1,
    exact: pure,
  };
}

/** A leg is pure when the charted asset sits on exactly one side, alone. */
export function isPureLeg(b: Basket): boolean {
  const longPure = b.a > 0 && b.c === 0 && b.u === 0 && b.v > 0;
  const shortPure = b.u > 0 && b.v === 0 && b.a === 0 && b.c > 0;
  return longPure || shortPure;
}
