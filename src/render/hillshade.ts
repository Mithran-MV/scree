import type { Raster } from "../field/raster";
import { colorForElevation } from "./palette";

export interface ShadeOptions {
  /** Sun direction in degrees clockwise from the top of the map. */
  azimuth?: number;
  /** Sun height in degrees above the horizon. */
  altitude?: number;
  /** Vertical exaggeration. Terrain this shallow is invisible without it. */
  exaggeration?: number;
  /** Elevation the top of the palette represents. */
  ceiling?: number;
}

/**
 * Paint the raster as a shaded relief map.
 *
 * The elevations involved are tiny in absolute terms — a health factor moves
 * through a range of about one — so the surface is exaggerated hard before the
 * light is applied. The exaggeration is a display choice and changes no number
 * the interface reports; the readout and the counters always come from `z`.
 */
export function hillshade(r: Raster, opts: ShadeOptions = {}): ImageDataLike {
  const { width, height } = r.window;
  const azimuth = ((opts.azimuth ?? 315) * Math.PI) / 180;
  const altitude = ((opts.altitude ?? 45) * Math.PI) / 180;
  const exaggeration = opts.exaggeration ?? 140;
  const ceiling = opts.ceiling ?? 1.0;

  const pixels = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const zenith = Math.PI / 2 - altitude;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const z = r.z[row * width + col]!;
      const base = colorForElevation(z, ceiling);

      const dzdx = (sampleZ(r, col + 1, row) - sampleZ(r, col - 1, row)) * 0.5 * exaggeration;
      const dzdy = (sampleZ(r, col, row + 1) - sampleZ(r, col, row - 1)) * 0.5 * exaggeration;

      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      let light =
        Math.cos(zenith) * Math.cos(slope) +
        Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect);
      light = 0.55 + 0.65 * Math.max(0, Math.min(1, light));

      // Underwater ground is lit far more softly, so the shoreline reads as a
      // boundary between two materials rather than one continuous slope.
      const strength = z < 0 ? 0.45 : 1;
      const lit = 1 + (light - 1) * strength;

      const at = (row * width + col) * 4;
      pixels[at] = base.r * lit;
      pixels[at + 1] = base.g * lit;
      pixels[at + 2] = base.b * lit;
      pixels[at + 3] = 255;
    }
  }

  return { width, height, data: pixels };
}

/**
 * Structurally an ImageData, without needing a DOM to construct one, so the
 * shading is testable in plain Node. The buffer is pinned to a plain
 * ArrayBuffer so it can be handed straight to the real `ImageData`.
 */
export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

function sampleZ(r: Raster, col: number, row: number): number {
  const { width, height } = r.window;
  const c = Math.min(width - 1, Math.max(0, col));
  const y = Math.min(height - 1, Math.max(0, row));
  const z = r.z[y * width + c]!;
  return Number.isFinite(z) ? z : 1;
}
