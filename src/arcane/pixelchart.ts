import type { Raster } from "../field/raster";
import { seaDatumFor } from "../render/palette";
import type { Sprite } from "./figures";
import {
  CONIFER_CLUMP,
  CONIFER_LOW,
  CONIFER_MID,
  CONIFER_TALL,
  HILL,
  HOLDING,
  OBELISK,
  PEAK_LARGE,
  PEAK_MID,
  PEAK_SMALL,
  RUIN_SUNK,
  TEMPLE,
  TOWER,
  WARD_CIRCLE,
  ZIGGURAT,
} from "./terrain-sprites";

/** Internal resolution. Everything is drawn here, then scaled up hard. */
export const CHART_H = 216;

export interface ChartSize {
  width: number;
  height: number;
}

export function chartSizeFor(aspect: number): ChartSize {
  return { width: Math.round(CHART_H * Math.min(3.4, Math.max(1.2, aspect))), height: CHART_H };
}

/* ── the ground ──────────────────────────────────────────────────────── */

export interface ChartField {
  width: number;
  height: number;
  /** Elevation per chart pixel. */
  z: Float32Array;
  /** Territory index per chart pixel, or -1. */
  owner: Int16Array;
  wet: Uint8Array;
  ceiling: number;
  seaDatum: number;
}

/** Resample the field onto the chart grid, once, for everything downstream. */
export function sampleField(r: Raster, size: ChartSize): ChartField {
  const { width: W, height: H } = size;
  const { width: fw, height: fh } = r.window;
  const z = new Float32Array(W * H);
  const owner = new Int16Array(W * H);
  const wet = new Uint8Array(W * H);

  for (let py = 0; py < H; py++) {
    const row = Math.min(fh - 1, Math.max(0, Math.round((1 - py / (H - 1)) * (fh - 1))));
    for (let px = 0; px < W; px++) {
      const col = Math.min(fw - 1, Math.max(0, Math.round((px / (W - 1)) * (fw - 1))));
      const at = row * fw + col;
      const raw = r.z[at]!;
      const i = py * W + px;
      z[i] = Number.isFinite(raw) ? raw : r.range.max;
      owner[i] = r.argmin[at]!;
      wet[i] = z[i]! < 0 ? 1 : 0;
    }
  }

  return {
    width: W,
    height: H,
    z,
    owner,
    wet,
    ceiling: Math.max(0.05, r.range.max),
    seaDatum: seaDatumFor(r.range.min),
  };
}

/* ── the furniture ───────────────────────────────────────────────────── */

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface Placed {
  sprite: Sprite;
  x: number;
  y: number;
}

/**
 * Populate the country.
 *
 * Height decides what stands where: ranked peaks on the summits, hills on the
 * shoulders, minor holdings on the low ground, ruins in the shallows. Placement
 * is deterministic, so the chart never reshuffles between repaints.
 */
export function placeFurniture(field: ChartField, keepOut: Placed[]): Placed[] {
  const { width: W, height: H } = field;
  const placed: Placed[] = [];
  const step = 15;

  const clash = (x: number, y: number, w: number, h: number) =>
    [...keepOut, ...placed].some(
      (p) =>
        x < p.x + (p.sprite.art[0]?.length ?? 0) + 1 &&
        x + w + 1 > p.x &&
        y < p.y + p.sprite.art.length + 1 &&
        y + h + 1 > p.y,
    );

  for (let gy = 3; gy < H - 10; gy += step) {
    for (let gx = 3; gx < W - 13; gx += step) {
      const roll = hash(gx, gy, 1);
      if (roll > 0.9) continue;

      const x = gx + Math.floor(hash(gx, gy, 2) * (step - 2));
      const y = gy + Math.floor(hash(gx, gy, 3) * (step - 2));
      const i = y * W + x;
      if (i < 0 || i >= field.z.length) continue;

      const t = field.z[i]! / field.ceiling;
      const pick = hash(x, y, 4);

      let sprite: Sprite | null = null;
      if (field.wet[i]) {
        if (-field.z[i]! < field.seaDatum * 0.34 && pick > 0.74) sprite = RUIN_SUNK;
      } else if (t > 0.82) {
        sprite = pick > 0.55 ? PEAK_LARGE : PEAK_MID;
      } else if (t > 0.6) {
        sprite = pick > 0.66 ? PEAK_MID : pick > 0.3 ? PEAK_SMALL : HILL;
      } else if (t > 0.34) {
        sprite = pick > 0.72 ? PEAK_SMALL : pick > 0.42 ? HILL : HOLDING;
      } else if (t > 0.1) {
        sprite = pick > 0.6 ? HOLDING : pick > 0.32 ? OBELISK : HILL;
      }
      if (!sprite) continue;

      const w = sprite.art[0]?.length ?? 0;
      const h = sprite.art.length;
      const sx = Math.min(W - w - 1, Math.max(1, x - (w >> 1)));
      const sy = Math.min(H - h - 1, Math.max(1, y - h));
      if (clash(sx, sy, w, h)) continue;

      placed.push({ sprite, x: sx, y: sy });
    }
  }

  // Painter's order: whatever is lower on the sheet is nearer, so it draws last.
  return placed.sort((a, b) => a.y - b.y);
}

/**
 * The canopy.
 *
 * Laid on a tighter lattice than the landmarks and drawn under them, because a
 * country with a few mountains on bare ground reads as a diagram while the same
 * country under forest reads as somewhere. Species follow altitude: tall stands
 * on the shoulders, low scrub near the water, clumps in the middle belt.
 */
export function placeForest(field: ChartField): Placed[] {
  const { width: W, height: H } = field;
  const trees: Placed[] = [];
  // The forest is drawn as 16px sprites on a 4-pixel tile grid, so the lattice
  // is one tile: at most one tree per tile, and only one tile in five. Denser
  // than that and the canopy hides the ground the trees are supposed to be on.
  const step = 4;

  for (let gy = 4; gy < H - 4; gy += step) {
    for (let gx = 4; gx < W - 4; gx += step) {
      if (hash(gx, gy, 21) > 0.22) continue;
      const x = gx + 2;
      const y = gy + 2;
      const i = y * W + x;
      if (field.wet[i]) continue;
      const t = field.z[i]! / field.ceiling;
      // Above the treeline nothing grows, and the bare tops are the point.
      if (t > 0.9) continue;
      const pick = hash(x, y, 24);
      let sprite: Sprite;
      if (t > 0.6) sprite = pick > 0.5 ? CONIFER_TALL : CONIFER_MID;
      else if (t > 0.3) sprite = pick > 0.68 ? CONIFER_CLUMP : pick > 0.3 ? CONIFER_TALL : CONIFER_MID;
      else sprite = pick > 0.55 ? CONIFER_MID : CONIFER_LOW;
      const w = sprite.art[0]?.length ?? 0;
      const h = sprite.art.length;
      trees.push({ sprite, x: x - (w >> 1), y: y - h });
    }
  }
  return trees.sort((a, b) => a.y - b.y);
}

/* ── the ley network ─────────────────────────────────────────────────── */

export interface Node {
  x: number;
  y: number;
}

/**
 * Trace a route between two seats, keeping to dry ground.
 *
 * At each step it walks toward the destination but takes the highest of the
 * candidate cells, so the line climbs over the ridge instead of swimming across
 * a basin. That is why the network bends: the ground bends it.
 */
function route(field: ChartField, from: Node, to: Node): Node[] {
  const { width: W, height: H } = field;
  const path: Node[] = [];
  let { x, y } = from;
  const steps = Math.round(Math.hypot(to.x - from.x, to.y - from.y)) + 1;

  for (let s = 0; s <= steps; s++) {
    path.push({ x, y });
    if (x === to.x && y === to.y) break;

    const stepX = Math.sign(to.x - x);
    const stepY = Math.sign(to.y - y);
    const candidates: Node[] = [];
    if (stepX !== 0) candidates.push({ x: x + stepX, y });
    if (stepY !== 0) candidates.push({ x, y: y + stepY });
    if (stepX !== 0 && stepY !== 0) candidates.push({ x: x + stepX, y: y + stepY });
    // Allow a sideways drift, which is what lets the route curve round water.
    if (stepX !== 0) candidates.push({ x: x + stepX, y: y + (s % 2 === 0 ? 1 : -1) });

    let best: Node | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (c.x < 1 || c.x >= W - 1 || c.y < 1 || c.y >= H - 1) continue;
      const i = c.y * W + c.x;
      const toward = -Math.hypot(to.x - c.x, to.y - c.y);
      const dry = field.wet[i] ? -18 : 0;
      const high = (field.z[i]! / field.ceiling) * 4;
      const score = toward + dry + high;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) break;
    x = best.x;
    y = best.y;
  }
  return path;
}

/**
 * Every seat joined to every other, and each joined to the pass when the chart
 * has one. The network is the argmin partition made walkable: a line between
 * two citadels is a route between two regimes of how you die.
 */
export function leyNetwork(field: ChartField, seats: Node[], pass: Node | null): Node[][] {
  const lines: Node[][] = [];
  const ordered = [...seats].sort((a, b) => a.x - b.x);

  for (let i = 1; i < ordered.length; i++) {
    lines.push(route(field, ordered[i - 1]!, ordered[i]!));
  }
  if (pass) {
    for (const seat of ordered) lines.push(route(field, seat, pass));
  }
  return lines;
}

/** The seat of a territory, sized by how much of the chart it holds. */
export function citadelFor(share: number): Sprite {
  if (share > 0.34) return ZIGGURAT;
  if (share > 0.15) return TEMPLE;
  return TOWER;
}

export { WARD_CIRCLE };
