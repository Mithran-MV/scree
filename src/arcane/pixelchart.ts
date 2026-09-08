import type { Raster } from "../field/raster";
import { seaDatumFor } from "../render/palette";
import type { Sprite } from "./figures";
import {
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

type Ctx = CanvasRenderingContext2D;

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

const SEA = ["#0b1c34", "#10263f", "#16304c", "#1c3a58"];
const LAND = ["#1f3f60", "#27506f", "#2f5f7e", "#38708d", "#43829c", "#4f94ab"];

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function band(t: number, steps: number, x: number, y: number): number {
  const scaled = Math.min(0.9999, Math.max(0, t)) * (steps - 1);
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  return floor + (frac > (BAYER[y & 3]![x & 3]! + 0.5) / 16 ? 1 : 0);
}

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

export function paintGround(ctx: Ctx, field: ChartField): void {
  const { width: W, height: H } = field;
  const image = ctx.createImageData(W, H);
  const d = image.data;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const z = field.z[i]!;
      const hex = field.wet[i]
        ? SEA[Math.min(SEA.length - 1, band(Math.min(1, -z / field.seaDatum), SEA.length, px, py))]!
        : LAND[Math.min(LAND.length - 1, band(Math.min(1, z / field.ceiling), LAND.length, px, py))]!;

      const n = parseInt(hex.slice(1), 16);
      const o = i * 4;
      d[o] = (n >> 16) & 255;
      d[o + 1] = (n >> 8) & 255;
      d[o + 2] = n & 255;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/* ── contour rings, dotted ───────────────────────────────────────────── */

export function drawContourRings(ctx: Ctx, field: ChartField, steps = 9): void {
  const { width: W, height: H } = field;
  ctx.fillStyle = "rgba(224,178,90,0.34)";
  ctx.beginPath();

  for (let py = 1; py < H; py++) {
    for (let px = 1; px < W; px++) {
      const i = py * W + px;
      if (field.wet[i]) continue;
      const here = Math.floor((field.z[i]! / field.ceiling) * steps);
      const left = Math.floor((field.z[i - 1]! / field.ceiling) * steps);
      const up = Math.floor((field.z[i - W]! / field.ceiling) * steps);
      if (here === left && here === up) continue;
      // Dot on a lattice fixed in the plane, so independent crossings land on
      // the same rhythm and read as one ruled line.
      if ((px * 2 + py * 3) % 5 !== 0) continue;
      ctx.rect(px, py, 1, 1);
    }
  }
  ctx.fill();
}

export function drawShoreline(ctx: Ctx, field: ChartField): void {
  const { width: W, height: H } = field;
  const edge: number[] = [];
  for (let py = 1; py < H - 1; py++) {
    for (let px = 1; px < W - 1; px++) {
      const i = py * W + px;
      if (!field.wet[i]) continue;
      if (
        !field.wet[i - 1] ||
        !field.wet[i + 1] ||
        !field.wet[i - W] ||
        !field.wet[i + W]
      ) {
        edge.push(i);
      }
    }
  }
  // Sea level is liquidation: the only edge on the chart that marks an event.
  for (const [color, spread] of [["rgba(226,96,58,0.28)", 1], ["#ff9a6a", 0]] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const i of edge) {
      const px = i % W;
      const py = (i / W) | 0;
      ctx.rect(px - spread, py - spread, 1 + spread * 2, 1 + spread * 2);
    }
    ctx.fill();
  }
}

/* ── the furniture ───────────────────────────────────────────────────── */

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function blit(ctx: Ctx, sprite: Sprite, x: number, y: number): void {
  const { art, palette } = sprite;
  for (let row = 0; row < art.length; row++) {
    const line = art[row]!;
    for (let col = 0; col < line.length; col++) {
      const key = line[col]!;
      if (key === ".") continue;
      const color = palette[key];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col, y + row, 1, 1);
    }
  }
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
  const step = 11;

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
      if (roll > 0.86) continue;

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

/** The seat of a territory, sized by how much of the chart it holds. */
export function citadelFor(share: number): Sprite {
  if (share > 0.34) return ZIGGURAT;
  if (share > 0.15) return TEMPLE;
  return TOWER;
}

export function drawFurniture(ctx: Ctx, items: readonly Placed[]): void {
  for (const item of items) {
    ctx.fillStyle = "rgba(6,14,28,0.45)";
    ctx.fillRect(item.x, item.y + item.sprite.art.length - 1, item.sprite.art[0]?.length ?? 0, 1);
    blit(ctx, item.sprite, item.x, item.y);
  }
}

export { blit, WARD_CIRCLE };

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

export function drawLeyNetwork(ctx: Ctx, lines: readonly Node[][], pulse: number): void {
  const swell = 0.55 + 0.45 * pulse;

  // Bloom first, then the core, so the line reads as light rather than as ink.
  for (const [color, spread] of [
    [`rgba(224,178,90,${0.1 * swell})`, 2],
    [`rgba(224,178,90,${0.26 * swell})`, 1],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const line of lines) {
      for (const p of line) ctx.rect(p.x - spread, p.y - spread, 1 + spread * 2, 1 + spread * 2);
    }
    ctx.fill();
  }

  ctx.fillStyle = `rgba(255,233,168,${0.62 + 0.38 * swell})`;
  ctx.beginPath();
  for (const line of lines) {
    for (const p of line) ctx.rect(p.x, p.y, 1, 1);
  }
  ctx.fill();
}

/** A beacon burning on a citadel's apex. */
export function drawBeacon(ctx: Ctx, x: number, y: number, pulse: number): void {
  const r = 1 + pulse;
  ctx.fillStyle = `rgba(255,233,168,${0.18 + 0.16 * pulse})`;
  ctx.beginPath();
  ctx.arc(x, y, 4.5 + r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff6dd";
  ctx.fillRect(x - 1, y - 1, 2, 2);
}
