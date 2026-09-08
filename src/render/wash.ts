import type { Raster } from "../field/raster";
import type { ImageDataLike } from "./hillshade";
import { SHEET, buildLUT, lookup, ALPHA_BUDGET, type Theme } from "./theme";
import { seaDatumFor } from "./palette";

export interface WashOptions {
  /** Plate size in CSS pixels. */
  size: number;
  /** Device pixel ratio the plate is baked at. */
  dpr?: number;
  theme?: Theme;
  ceiling?: number;
}

/**
 * The land wash and the sea ruling, in one pass at plate resolution.
 *
 * Two things are deliberate here.
 *
 * First, the land carries no lighting term whatsoever. It is a flat three-stop
 * wash that only has to separate high ground from low, because on a hachured
 * sheet the relief lives in the strokes. Tone under hachure would encode the
 * same slope a second time, nonlinearly, and the two together read as mud.
 *
 * Second, below the shoreline the pen changes hand. On land the ink is slanted,
 * broken and short; in the water it is level, continuous and relentless, and it
 * tightens as the water deepens. That contrast alone carries "this is fatal"
 * with no colour, no glow and no gradient — and it needs no sea polygon to clip
 * against, which matters because the contour tracer returns unordered segments
 * and there is no sea path to clip to.
 */
export function wash(r: Raster, opts: WashOptions): ImageDataLike {
  const theme = opts.theme ?? SHEET;
  const dpr = opts.dpr ?? 1;
  const size = Math.max(1, Math.round(opts.size * dpr));
  const { width: fw, height: fh } = r.window;

  const ceiling = Math.max(0.05, opts.ceiling ?? r.range.max);
  const seaDatum = seaDatumFor(r.range.min);
  const lut = buildLUT(theme, ceiling, seaDatum);

  // Sample on exactly the mapping the vector layers use, so the wash sits on
  // the same grid as everything drawn over it.
  const sx = size / (fw - 1);
  const sy = size / (fh - 1);

  const pixels = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const rulingMax = ALPHA_BUDGET.seaRuling!;

  for (let py = 0; py < size; py++) {
    const v = (size - py) / sy;
    for (let px = 0; px < size; px++) {
      const u = px / sx;
      const z = bilinear(r, u, v);
      const base = lookup(lut, z);
      let { r: cr, g: cg, b: cb } = base;

      if (z < 0) {
        const depth = Math.min(1, -z / seaDatum);
        // Floor the period at 3 CSS px. A 2px ruling resampled during a zoom
        // gesture beats visibly and reads as a rendering bug, not a style.
        const period = Math.max(3 * dpr, Math.round(lerp(6 * dpr, 3 * dpr, depth)));
        if (py % period === 0) {
          const alpha = lerp(0.1, rulingMax * 0.38, depth);
          cr = theme.ink.r * alpha + cr * (1 - alpha);
          cg = theme.ink.g * alpha + cg * (1 - alpha);
          cb = theme.ink.b * alpha + cb * (1 - alpha);
        }
      }

      const at = (py * size + px) * 4;
      pixels[at] = cr;
      pixels[at + 1] = cg;
      pixels[at + 2] = cb;
      pixels[at + 3] = 255;
    }
  }

  return { width: size, height: size, data: pixels };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bilinear read of the field in raster coordinates, clamped at the edges. */
function bilinear(r: Raster, u: number, v: number): number {
  const { width, height } = r.window;
  const x = Math.min(width - 1, Math.max(0, u));
  const y = Math.min(height - 1, Math.max(0, v));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

  const z00 = finite(r.z[y0 * width + x0]!);
  const z10 = finite(r.z[y0 * width + x1]!);
  const z01 = finite(r.z[y1 * width + x0]!);
  const z11 = finite(r.z[y1 * width + x1]!);

  return (
    z00 * (1 - fx) * (1 - fy) + z10 * fx * (1 - fy) + z01 * (1 - fx) * fy + z11 * fx * fy
  );
}

function finite(z: number): number {
  return Number.isFinite(z) ? z : 1;
}
