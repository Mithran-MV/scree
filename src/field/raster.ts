import type { Basket } from "../core/types";
import { bindingDeployment, dwellYears, elevation, healthFactor } from "../core/kernel";

/**
 * The window the map is drawn over.
 *
 * Price runs on a log scale because a percentage move should cover the same
 * distance whichever end of the axis it starts from. Dwell runs on a square
 * root scale because the first day matters far more than the thirtieth.
 */
export interface Window {
  spot: number;
  /** Fractional bounds around spot, e.g. -0.6 and 0.6. */
  priceLow: number;
  priceHigh: number;
  /** Dwell bounds in days. */
  dwellLow: number;
  dwellHigh: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW: Omit<Window, "spot"> = {
  priceLow: -0.6,
  priceHigh: 0.6,
  dwellLow: 0,
  dwellHigh: 30,
  width: 256,
  height: 256,
};

export function windowAt(spot: number, overrides: Partial<Window> = {}): Window {
  return { ...DEFAULT_WINDOW, spot, ...overrides };
}

/**
 * The one window both the picture and the geometry gate are measured on.
 *
 * These used to differ — the canvas rendered at 320x320 while the gate counted
 * folds and basins at 256x256 — which meant the numbers printed beside the map
 * were measured on a different grid from the map. Any feature that survives one
 * resolution and not the other would have gone unnoticed. Both now come here.
 */
export function renderWindow(spot: number): Window {
  return windowAt(spot);
}

/** Column index to price. Log-spaced across the fractional bounds. */
export function priceAt(w: Window, col: number): number {
  const lo = Math.log(w.spot * (1 + w.priceLow));
  const hi = Math.log(w.spot * (1 + w.priceHigh));
  const f = w.width <= 1 ? 0 : col / (w.width - 1);
  return Math.exp(lo + f * (hi - lo));
}

/** Row index to dwell in days. Row 0 is the bottom of the map, dwell zero. */
export function dwellAt(w: Window, row: number): number {
  const f = w.height <= 1 ? 0 : row / (w.height - 1);
  const lo = Math.sqrt(w.dwellLow);
  const hi = Math.sqrt(w.dwellHigh);
  const s = lo + f * (hi - lo);
  return s * s;
}

/** Inverse of `priceAt`, for placing the live ball and hover readouts. */
export function colOfPrice(w: Window, price: number): number {
  const lo = Math.log(w.spot * (1 + w.priceLow));
  const hi = Math.log(w.spot * (1 + w.priceHigh));
  return ((Math.log(price) - lo) / (hi - lo)) * (w.width - 1);
}

export interface Raster {
  window: Window;
  /** Elevation, row-major, `height * width` entries. */
  z: Float64Array;
  /** Index into the basket array that binds at each cell, or -1 if none does. */
  argmin: Int16Array;
  deploymentIds: string[];
  /** Finite elevation range actually present, for scaling the display. */
  range: { min: number; max: number };
}

/**
 * Sample the terrain. This is the only place the kernel is evaluated per pixel,
 * and it is deliberately allocation-free per cell so it can run in a worker
 * without stuttering the pan.
 */
export function rasterize(baskets: readonly Basket[], w: Window): Raster {
  const z = new Float64Array(w.width * w.height);
  const argmin = new Int16Array(w.width * w.height);

  for (let row = 0; row < w.height; row++) {
    const t = dwellYears(dwellAt(w, row));
    for (let col = 0; col < w.width; col++) {
      const P = priceAt(w, col);
      let lowest = Number.POSITIVE_INFINITY;
      let which = -1;
      for (let i = 0; i < baskets.length; i++) {
        const hf = healthFactor(baskets[i]!, P, t);
        if (hf < lowest) {
          lowest = hf;
          which = i;
        }
      }
      const at = row * w.width + col;
      z[at] = lowest === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : lowest - 1;
      argmin[at] = which;
    }
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < z.length; i++) {
    const v = z[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 1;
  }

  return {
    window: w,
    z,
    argmin,
    deploymentIds: baskets.map((b) => b.deploymentId),
    range: { min, max },
  };
}

/** Read the terrain at an arbitrary point, for the hover readout. */
export function sample(
  baskets: readonly Basket[],
  price: number,
  dwellDays: number,
): { z: number; binder: string | null } {
  const t = dwellYears(dwellDays);
  return {
    z: elevation(baskets, price, t),
    binder: bindingDeployment(baskets, price, t),
  };
}
