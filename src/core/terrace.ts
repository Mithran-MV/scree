/**
 * The two readings the panel charts: the ground along the price axis at one
 * dwell, from the coast past the point being read; and the crash edge against
 * dwell, with the enclave's lift applied to it. Pure arithmetic over the
 * baskets, so the panel draws only what the kernel says.
 */
import type { Basket, Exposure } from "./types";
import { bracket } from "./bracket";
import { dwellYears, elevation } from "./kernel";

export interface ProfilePoint {
  price: number;
  /** Health factor minus one: sea level is zero. */
  z: number;
}

export interface EdgePoint {
  /** Dwell, in days. */
  t: number;
  price: number;
}

/**
 * The ground at one dwell, sampled along price from a little beyond the
 * coast to a little beyond the point read, in log-price steps so the span
 * reads the same on either side of the point. Where nothing binds, a window
 * around the point. Which way the sea lies is the exposure's business: a
 * long book drowns downhill, a short one uphill; the span covers both ends.
 */
export function groundProfile(
  baskets: readonly Basket[],
  price: number,
  dwellDays: number,
  liquidationPrice: number | null,
  exposure: Exposure | null,
  points = 25,
): ProfilePoint[] {
  if (!(price > 0)) return [];
  const t = dwellYears(dwellDays);
  const coast = liquidationPrice !== null && liquidationPrice > 0 && exposure !== "FLAT" ? liquidationPrice : null;
  const lo = (coast === null ? price : Math.min(price, coast)) * (coast === null ? 0.85 : 0.95);
  const hi = (coast === null ? price : Math.max(price, coast)) * (coast === null ? 1.15 : 1.05);
  const n = Math.max(2, points);
  const out: ProfilePoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = lo * (hi / lo) ** (i / (n - 1));
    out.push({ price: p, z: elevation(baskets, p, t) });
  }
  return out;
}

/** The crash edge, the nearest liquidation below today's price, at each dwell from now to `dwellHighDays`. */
export function crashEdgeCurve(baskets: readonly Basket[], dwellHighDays: number, points = 31): EdgePoint[] {
  const out: EdgePoint[] = [];
  const n = Math.max(2, points);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dwellHighDays;
    const p = bracket(baskets, dwellYears(t)).lower;
    if (p !== null && Number.isFinite(p)) out.push({ t, price: p });
  }
  return out;
}

/**
 * Lifting health by `lift` at today's price scales collateral by
 * (H + lift) / H, which moves the crash edge down by the inverse ratio.
 * First order, as the panel says.
 */
export function liftedEdge(curve: readonly EdgePoint[], healthToday: number, lift: number): EdgePoint[] {
  const ratio = healthToday > 0 && lift > 0 ? healthToday / (healthToday + lift) : 1;
  return curve.map((c) => ({ t: c.t, price: c.price * ratio }));
}

/** A fixed price scale around today's edge: fifteen percent either way, so a flat edge looks flat and a lift shows its true size. */
export function edgeScale(edge: number): { lo: number; hi: number } {
  return { lo: edge * 0.85, hi: edge * 1.15 };
}

/** The ground chart's fixed vertical scale, in health minus one: from a little under the sea to a health of two. */
export const PROFILE_SCALE = { lo: -0.25, hi: 1.0 } as const;
