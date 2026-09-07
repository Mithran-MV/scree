import type { Basket, Exposure, WalletShape } from "./types";

export const DAYS_PER_YEAR = 365;

/** Convert a dwell in days to the year fraction the rate terms expect. */
export function dwellYears(days: number): number {
  return days / DAYS_PER_YEAR;
}

/**
 * Health factor of a single deployment at price `P`, after price has dwelled at
 * or below that level for `t` years.
 *
 *   HF = ((a*P + c) * exp(rs*t)) / ((u*P + v) * exp(rb*t))
 *
 * Returns `Infinity` for a basket with no debt: nothing can liquidate it.
 */
export function healthFactor(b: Basket, P: number, t: number): number {
  const debt = (b.u * P + b.v) * Math.exp(b.rb * t);
  if (debt <= 0) return Number.POSITIVE_INFINITY;
  const collateral = (b.a * P + b.c) * Math.exp(b.rs * t);
  return collateral / debt;
}

/**
 * Sign of dHF/dP.
 *
 * d/dP of (a*P + c)/(u*P + v) has numerator (a*v - u*c), which carries no P at
 * all. So a basket's direction is fixed: it is monotone in price everywhere,
 * and the rate terms scale it without ever changing its sign. This is exactly
 * why a wallet holding one sign renders an honest ramp and never a ridge.
 */
export function exposure(b: Basket, epsilon = 1e-12): Exposure {
  const d = b.a * b.v - b.u * b.c;
  if (Math.abs(d) <= epsilon) return "FLAT";
  return d > 0 ? "LONG" : "SHORT";
}

/**
 * Local sensitivity of log(HF) to log(P), i.e. how hard this basket is pulling
 * at a given price. Zero for a FLAT basket, positive for LONG, negative for
 * SHORT, and it decays as either side is dominated by its non-charted leg.
 */
export function elasticity(b: Basket, P: number): number {
  const col = b.a * P + b.c;
  const debt = b.u * P + b.v;
  const supplyTerm = col > 0 ? (b.a * P) / col : 0;
  const borrowTerm = debt > 0 ? (b.u * P) / debt : 0;
  return supplyTerm - borrowTerm;
}

/**
 * The price at which this basket's health factor is exactly 1, at dwell `t`.
 *
 * Solving (a*P + c)*exp(rs*t) = (u*P + v)*exp(rb*t) with g = exp((rb - rs)*t):
 *
 *   P* = (g*v - c) / (a - g*u)
 *
 * A LONG basket dies below its P*, a SHORT basket dies above it. Returns null
 * when the basket cannot be liquidated at any positive price — no debt, or a
 * root that falls at or below zero.
 */
export function liquidationPrice(b: Basket, t: number): number | null {
  const g = Math.exp((b.rb - b.rs) * t);
  const denominator = b.a - g * b.u;
  if (Math.abs(denominator) < 1e-15) return null;
  const P = (g * b.v - b.c) / denominator;
  return Number.isFinite(P) && P > 0 ? P : null;
}

/**
 * Elevation of the terrain: the minimum of (HF - 1) across every deployment.
 * Zero is sea level, which is liquidation. Negative is underwater.
 */
export function elevation(baskets: readonly Basket[], P: number, t: number): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (const b of baskets) {
    const hf = healthFactor(b, P, t);
    if (hf < lowest) lowest = hf;
  }
  return lowest === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : lowest - 1;
}

/** Which deployment is closest to killing you at this point on the map. */
export function bindingDeployment(
  baskets: readonly Basket[],
  P: number,
  t: number,
): string | null {
  let bestId: string | null = null;
  let lowest = Number.POSITIVE_INFINITY;
  for (const b of baskets) {
    const hf = healthFactor(b, P, t);
    if (hf < lowest) {
      lowest = hf;
      bestId = b.deploymentId;
    }
  }
  return bestId;
}

/**
 * Classify a wallet. Only a MIXED wallet can produce a ridge and a pass; every
 * other shape is a ramp, and the product says so rather than drawing creases
 * that are not there.
 */
export function walletShape(baskets: readonly Basket[]): WalletShape {
  let long = 0;
  let short = 0;
  for (const b of baskets) {
    if ((b.u * 1 + b.v) <= 0) continue; // no debt, cannot bind
    const e = exposure(b);
    if (e === "LONG") long++;
    else if (e === "SHORT") short++;
  }
  if (long > 0 && short > 0) return "MIXED";
  if (long > 0) return "LONG-ONLY";
  if (short > 0) return "SHORT-ONLY";
  return "DEGENERATE";
}
