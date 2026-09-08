import type { RGB } from "./theme";
import { SHEET, buildLUT, lookup, type LUT } from "./theme";

export type { RGB };

/**
 * Colour for elevation, read off a baked ramp.
 *
 * The ramps themselves now live in the theme, so the wash, the auditors and the
 * gate all read the same stops. What stays here is the question of how deep the
 * sea should be drawn.
 *
 * `ceiling` is the health-factor headroom the top of the land ramp represents;
 * beyond it the wash flattens, because the difference between very safe and
 * extremely safe is not worth a colour. `seaDatum` is the matching depth for
 * the water, and it is scaled to the book actually on screen rather than fixed:
 * a wallet whose worst corner is barely underwater should not be painted the
 * same black as one that is catastrophically so.
 */
export function seaDatumFor(minZ: number): number {
  // Floored, so a book that only just dips below the line still gets a legible
  // band of water rather than a single saturated step.
  return Math.max(0.35, -minZ);
}

let cached: LUT | null = null;

function lutFor(ceiling: number, seaDatum: number): LUT {
  if (cached && cached.ceiling === ceiling && cached.seaDatum === seaDatum) return cached;
  cached = buildLUT(SHEET, ceiling, seaDatum);
  return cached;
}

export function colorForElevation(z: number, ceiling = 1.0, seaDatum = 0.5): RGB {
  return lookup(lutFor(Math.max(0.05, ceiling), Math.max(0.05, seaDatum)), z);
}
