import type { Raster } from "../field/raster";
import { exaggerationFor, gradientAt } from "./hillshade";
import { distanceToShore } from "./distance";
import { ALPHA_BUDGET } from "./theme";

/**
 * Lehmann hachures.
 *
 * A hachure is a stroke cut straight down the fall line, and its weight is a
 * function of steepness alone: Lehmann's rule is that the ratio of ink to white
 * equals the slope angle over 45 degrees, so a 45-degree slope is solid black
 * and flat ground is bare paper. That makes relief *countable* — you read the
 * gradient off the density of the marks — where a hillshade only lets you read
 * it off a light that was never there.
 *
 * Two properties follow that matter more than they look.
 *
 * Direction-agnostic: a slope facing left and a slope facing right of equal
 * steepness are cut identically. Nothing on the plate depends on an invented
 * sun position.
 *
 * Length is a fixed vertical DROP rather than a fixed pixel count. Every stroke
 * spans the same rise in health factor, so the ends of neighbouring strokes
 * land on shared levels and the comb self-organises into contour-parallel bands
 * without any code ever consulting contour geometry.
 */

export interface Seed {
  /** Stroke start, in plate pixels. */
  x: number;
  y: number;
  /** Unit vector down the fall line. */
  dx: number;
  dy: number;
  length: number;
  /** Half-width at the head, in plate pixels. */
  half: number;
  /** Half-width at the tail. */
  tip: number;
  /** Width bucket, so the whole comb draws in a handful of fills. */
  bucket: number;
}

export interface HachureOptions {
  /** Plate size in CSS pixels. */
  size: number;
  /** Contour interval in health factor, so stroke drop can be tied to it. */
  interval: number;
  /** Lattice pitch in CSS pixels. */
  pitch?: number;
  /** Number of width buckets. */
  buckets?: number;
}

export const HACHURE_BUCKETS = 6;

/**
 * The slope the steepest ground on the plate is cut at.
 *
 * Lehmann's rule maps a 45-degree slope to solid black, but a health-factor
 * surface has no 45-degree slopes: measured in plate pixels its steepest ground
 * sits near three degrees, which under the raw rule would put every stroke in
 * the lightest bucket and cut a shallower book as bare paper. So the comb
 * carries a gain that normalises the slope distribution actually present onto
 * Lehmann's range, stopping short of solid so the steepest ground still reads
 * as ink and white rather than a blot. The gain is a display choice like the
 * vertical exaggeration beside it, and like it, it is printed on the plate.
 */
const COMB_TOP_DEGREES = 22;

/**
 * The heaviest a stroke is ever cut, as a fraction of the lattice pitch.
 * Lehmann's rule ends at solid black; a solid hillside is a blot rather than a
 * reading, so the top of the range stops short of it.
 */
const MAX_INK = 0.55;

/**
 * Deterministic hash for lattice jitter.
 *
 * Never `Math.random()` here. The comb is baked once and reused across pan and
 * zoom, so a random jitter would differ between bakes and the whole hillside
 * would shimmer every time the plate was rebuilt.
 */
function hash2(cx: number, cy: number): number {
  let h = Math.imul(cx, 374761393) ^ Math.imul(cy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Where the comb thins out to nothing.
 *
 * Derived from the raster's own slope distribution rather than fixed. This is
 * the most sensitive number in the skin: set it too high and a genuinely
 * shallow real wallet renders as a blank sheet, which would be a rendering
 * failure presented as a finding.
 */
export function cullAngleFor(slopeDegrees: number[]): number {
  if (slopeDegrees.length === 0) return 3;
  const sorted = [...slopeDegrees].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  return Math.min(6, Math.max(3, q1));
}

/**
 * Gain that puts the 95th-percentile slope at the top of the comb's range.
 * The percentile rather than the maximum, so one pathological cell at a fold
 * cannot flatten the whole hillside.
 */
export function slopeGainFor(magnitudes: number[]): number {
  if (magnitudes.length === 0) return 1;
  const sorted = [...magnitudes].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (p95 <= 1e-9) return 1;
  return Math.tan((COMB_TOP_DEGREES * Math.PI) / 180) / p95;
}

export interface Comb {
  seeds: Seed[];
  /** Slope normalisation applied before Lehmann's rule. Printed on the plate. */
  gain: number;
  /** Angle below which ground is left bare, in degrees after gain. */
  cullDeg: number;
}

/**
 * Pure and DOM-free, so the gate can count seeds without a canvas.
 */
export function hachureSeeds(r: Raster, opts: HachureOptions): Comb {
  const { width: fw, height: fh } = r.window;
  const size = opts.size;
  const pitch = opts.pitch ?? 8;
  const buckets = opts.buckets ?? HACHURE_BUCKETS;

  const exaggeration = exaggerationFor(r);
  const shoreDist = distanceToShore(r);
  const sx = size / (fw - 1);
  const sy = size / (fh - 1);

  // Gradient per plate pixel, not per raster cell: the strokes are drawn in
  // plate space, so their length has to be measured there too.
  const perPixel = (g: { dzdx: number; dzdy: number }) =>
    Math.hypot(g.dzdx / sx, g.dzdy / sy);

  // One sampling pass to learn the slope distribution, then the cull follows
  // from the terrain rather than from a constant someone guessed.
  const sampled: number[] = [];
  for (let row = 2; row < fh - 2; row += 4) {
    for (let col = 2; col < fw - 2; col += 4) {
      if (r.z[row * fw + col]! < 0) continue;
      sampled.push(perPixel(gradientAt(r, col, row, exaggeration)));
    }
  }
  const gain = slopeGainFor(sampled);
  const cullDeg = cullAngleFor(sampled.map((m) => (Math.atan(m * gain) * 180) / Math.PI));

  const seeds: Seed[] = [];
  const columns = Math.ceil(size / pitch);
  const rows = Math.ceil(size / pitch);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const jx = hash2(cx, cy);
      const jy = hash2(cx + 9173, cy + 4421);
      const px = (cx + 0.5 + (jx - 0.5) * 0.72) * pitch;
      const py = (cy + 0.5 + (jy - 0.5) * 0.72) * pitch;
      if (px >= size || py >= size) continue;

      // Plate pixel back to field cell, on the same mapping the wash uses.
      const u = px / sx;
      const v = (size - py) / sy;
      const col = Math.round(u);
      const row = Math.round(v);
      if (col < 0 || col >= fw || row < 0 || row >= fh) continue;

      const z = r.z[row * fw + col]!;
      if (!Number.isFinite(z) || z < 0) continue; // the sea is ruled, not hachured
      if (shoreDist[row * fw + col]! * Math.min(sx, sy) < 3) continue;

      const g = gradientAt(r, col, row, exaggeration);
      const mag = perPixel(g);
      const slopeDeg = (Math.atan(mag * gain) * 180) / Math.PI;
      if (slopeDeg < cullDeg) continue;

      // Stroke length is a real vertical drop, so it is measured against the
      // TRUE gradient, not the exaggerated one the width is cut from. Dividing
      // by the exaggerated gradient makes every stroke collapse onto the lower
      // clamp and the comb reads as speckle rather than engraving.
      const rawMag = mag / exaggeration;

      // Downhill, always.
      const gx = g.dzdx / sx;
      const gy = g.dzdy / sy;
      const norm = Math.hypot(gx, gy) || 1;
      // Field row grows upward while the plate's y grows downward, so the
      // vertical component flips on the way onto the sheet.
      const dx = -gx / norm;
      const dy = gy / norm;

      // Capped near the lattice pitch: a stroke longer than the spacing runs
      // into the row below it and the comb closes into a solid mass.
      const length = clamp(opts.interval / Math.max(rawMag, 1e-9), 3, pitch + 1);
      // Lehmann's ratio, measured against the range this plate was gained onto
      // rather than against a literal 45 degrees. Against 45 the whole surface
      // would land in the lightest bucket or two and the comb would carry no
      // detail at all.
      const inkFraction = clamp(slopeDeg / COMB_TOP_DEGREES, 0, 1) * MAX_INK;
      const half = (inkFraction * pitch) / 2;
      if (half < 0.18) continue;

      seeds.push({
        x: px,
        y: py,
        dx,
        dy,
        length,
        half,
        tip: half * 0.35,
        bucket: Math.min(buckets - 1, Math.floor((inkFraction / MAX_INK) * buckets)),
      });
    }
  }

  return { seeds, gain, cullDeg };
}

/**
 * The slice of a 2D context this module touches, kept narrow so the drawing
 * path is exercisable from a test with a counting stub and no DOM.
 */
type Ctx = {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
};

/**
 * Draw the comb.
 *
 * Filled tapered quads, never `stroke()`. A constant-width line reads as hair;
 * a wedge reads as engraving, and it is the single largest quality difference
 * available on this sheet for no extra cost. Strokes are accumulated by width
 * bucket so several thousand marks cost a handful of fills.
 */
export function drawHachures(ctx: Ctx, seeds: readonly Seed[], ink: string): number {
  const byBucket = new Map<number, Seed[]>();
  for (const s of seeds) {
    const list = byBucket.get(s.bucket);
    if (list) list.push(s);
    else byBucket.set(s.bucket, [s]);
  }

  ctx.fillStyle = ink;
  ctx.globalAlpha = ALPHA_BUDGET.hachureFill!;
  for (const list of byBucket.values()) {
    ctx.beginPath();
    for (const s of list) {
      const nx = -s.dy;
      const ny = s.dx;
      const ex = s.x + s.dx * s.length;
      const ey = s.y + s.dy * s.length;
      ctx.moveTo(s.x + nx * s.half, s.y + ny * s.half);
      ctx.lineTo(s.x - nx * s.half, s.y - ny * s.half);
      ctx.lineTo(ex - nx * s.tip, ey - ny * s.tip);
      ctx.lineTo(ex + nx * s.tip, ey + ny * s.tip);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return byBucket.size;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
