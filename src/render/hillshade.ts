import type { Raster } from "../field/raster";

/**
 * Shared surface primitives.
 *
 * This module used to light the terrain with a sun at 315 degrees and 45 above
 * the horizon. That lamp does not exist. It was the largest piece of pure
 * fiction on a map whose entire argument is that its ground was measured, and
 * on a sheet cut in hachures it is worse than unnecessary: Lambertian tone and
 * hachure density encode the same slope nonlinearly, so stacking them produces
 * mud. Hachures are direction-agnostic by construction — a slope facing left
 * and a slope facing right of equal steepness are cut identically — so relief
 * became a countable measurement instead of a picture of a light, and the light
 * was deleted rather than dimmed.
 *
 * What survives is the surface arithmetic every layer needs to agree on.
 */

/** The elevation range the display is scaled against. */
export function spanOf(r: Raster): number {
  return Math.max(0.05, r.range.max - Math.max(r.range.min, -0.5));
}

/**
 * Vertical exaggeration.
 *
 * A health factor moves through a range of about one, so unexaggerated relief
 * is invisible. This is a display choice and it changes no number the interface
 * reports — but because it is a choice, the multiplier is printed on the plate.
 */
export function exaggerationFor(r: Raster): number {
  return 12 / spanOf(r);
}

/**
 * Gradient at a cell, already exaggerated. One definition, read by the wash,
 * the hachures and the staff, so none of them can disagree about the surface.
 */
export function gradientAt(
  r: Raster,
  col: number,
  row: number,
  exaggeration: number,
): { dzdx: number; dzdy: number } {
  return {
    dzdx: (sampleZ(r, col + 1, row) - sampleZ(r, col - 1, row)) * 0.5 * exaggeration,
    dzdy: (sampleZ(r, col, row + 1) - sampleZ(r, col, row - 1)) * 0.5 * exaggeration,
  };
}

/**
 * Structurally an ImageData, without needing a DOM to construct one, so the
 * surface layers stay testable in plain Node. The buffer is pinned to a plain
 * ArrayBuffer so it can be handed straight to the real `ImageData`.
 */
export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export function sampleZ(r: Raster, col: number, row: number): number {
  const { width, height } = r.window;
  const c = Math.min(width - 1, Math.max(0, col));
  const y = Math.min(height - 1, Math.max(0, row));
  const z = r.z[y * width + c]!;
  return Number.isFinite(z) ? z : 1;
}
