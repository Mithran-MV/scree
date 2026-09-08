import type { Raster } from "../field/raster";
import type { ImageDataLike } from "../render/hillshade";
import { exaggerationFor, gradientAt } from "../render/hillshade";
import { seaDatumFor } from "../render/palette";
import { LAND_BANDS, SEA_BANDS, rampAt } from "./biome";

/**
 * The world, painted as pixel art.
 *
 * Every pixel's terrain is read from the measured field: which biome a tile
 * gets is decided by the real elevation and the real slope at that point, and
 * the waterline is the real zero crossing. Nothing here invents topography. The
 * art is in how the surface is *drawn*, not in what is under it.
 *
 * The look comes from three constraints kept honestly: a small fixed palette, a
 * low internal resolution scaled up with nearest-neighbour, and ordered
 * dithering at the band edges instead of smooth blending. Those three together
 * are what separate pixel art from a downscaled photograph.
 */

/**
 * Internal resolution.
 *
 * Height is fixed and width follows the viewport, so the pixel size on screen
 * stays constant as the window changes shape. Scaling a fixed grid to fit
 * instead would make the pixels themselves stretch, which is the one thing the
 * style cannot survive.
 */
export const WORLD_H = 200;
export const DEFAULT_WORLD_W = 320;

export interface WorldSize {
  width: number;
  height: number;
}

/** World grid for a container of a given aspect ratio. */
export function worldSizeFor(aspect: number): WorldSize {
  const width = Math.round(WORLD_H * Math.min(3.2, Math.max(1.1, aspect)));
  return { width, height: WORLD_H };
}

/** Bayer 4x4, the classic ordered-dither threshold matrix. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * Quantise a ramp to a fixed number of steps, dithering across each boundary.
 *
 * A continuous ramp scaled up reads as a gradient, which is the one thing pixel
 * art never does. Snapping to steps and scattering the transition on a Bayer
 * lattice gives the stippled band edges the style is built on, and it costs a
 * lookup.
 */
function ditheredStep(t: number, steps: number, x: number, y: number): number {
  const scaled = Math.min(0.9999, Math.max(0, t)) * steps;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  const threshold = (BAYER[y & 3]![x & 3]! + 0.5) / 16;
  return (floor + (frac > threshold ? 1 : 0)) / steps;
}

export interface WorldPaint {
  width: number;
  height: number;
  image: ImageDataLike;
  /** Elevation sampled per pixel, so sprites can sit on the ground. */
  elevation: Float32Array;
  /** True where the pixel is below the waterline. */
  wet: Uint8Array;
  ceiling: number;
  seaDatum: number;
}

export function paintWorld(r: Raster, size: WorldSize): WorldPaint {
  const { width: W, height: H } = size;
  const { width: fw, height: fh } = r.window;
  const ceiling = Math.max(0.05, r.range.max);
  const seaDatum = seaDatumFor(r.range.min);
  const exaggeration = exaggerationFor(r);

  // Steepness is normalised against the steepest ground present, so a gentle
  // map still shows crags where it is relatively steep.
  let steepest = 1e-9;
  const slope = new Float32Array(fw * fh);
  for (let row = 0; row < fh; row++) {
    for (let col = 0; col < fw; col++) {
      const g = gradientAt(r, col, row, exaggeration);
      const m = Math.hypot(g.dzdx, g.dzdy);
      slope[row * fw + col] = m;
      if (m > steepest) steepest = m;
    }
  }

  const data = new Uint8ClampedArray(new ArrayBuffer(W * H * 4));
  const elevation = new Float32Array(W * H);
  const wet = new Uint8Array(W * H);

  for (let py = 0; py < H; py++) {
    // Screen y grows downward; dwell grows upward. The far edge of the world is
    // the long dwell, which is where the viewer is looking into.
    const v = (1 - py / (H - 1)) * (fh - 1);
    for (let px = 0; px < W; px++) {
      const u = (px / (W - 1)) * (fw - 1);
      const col = Math.round(u);
      const row = Math.round(v);
      const at = row * fw + col;
      const raw = r.z[at]!;
      const z = Number.isFinite(raw) ? raw : ceiling;
      const steepness = Math.min(1, slope[at]! / steepest);

      const i = py * W + px;
      elevation[i] = z;
      wet[i] = z < 0 ? 1 : 0;

      let color;
      if (z < 0) {
        const depth = Math.min(1, -z / seaDatum);
        color = rampAt(SEA_BANDS, ditheredStep(depth, 5, px, py));
      } else {
        const height = Math.min(1, z / ceiling);
        color = rampAt(LAND_BANDS, ditheredStep(height, 7, px, py));
        const bare = Math.min(1, Math.max(0, (steepness - 0.78) / 0.22));
        // Rock breaks through on steep faces, itself dithered so the boundary
        // is stippled rather than a clean sweep.
        if (ditheredStep(bare, 3, px + 2, py + 1) > 0.34) {
          const stone = steepness > 0.82 ? { r: 92, g: 84, b: 76 } : { r: 126, g: 118, b: 104 };
          color = { r: stone.r, g: stone.g, b: stone.b };
        }
      }

      const o = i * 4;
      data[o] = color.r;
      data[o + 1] = color.g;
      data[o + 2] = color.b;
      data[o + 3] = 255;
    }
  }

  drawSurf(data, wet, W, H);

  return {
    width: W,
    height: H,
    image: { width: W, height: H, data },
    elevation,
    wet,
    ceiling,
    seaDatum,
  };
}

/**
 * Foam along the waterline.
 *
 * Sea level is liquidation, so this is the only edge in the world that marks an
 * event rather than a reading. A bright two-pixel lip makes it the first thing
 * the eye finds, which is exactly the right priority.
 */
function drawSurf(data: Uint8ClampedArray, wet: Uint8Array, W: number, H: number): void {
  const foam = { r: 226, g: 244, b: 240 };
  const damp = { r: 176, g: 208, b: 202 };

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      if (!wet[i]) continue;
      let shore = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (!wet[ny * W + nx]) shore = true;
      }
      if (!shore) continue;
      // Break the lip on the dither lattice so it reads as surf, not an outline.
      const bright = (BAYER[py & 3]![px & 3]! + 0.5) / 16 > 0.35;
      const c = bright ? foam : damp;
      const o = i * 4;
      data[o] = c.r;
      data[o + 1] = c.g;
      data[o + 2] = c.b;
    }
  }
}
