import type { Raster } from "../field/raster";
import { colOfPrice, dwellAt, priceAt, windowAt, type Window } from "../field/raster";
import type { Basket, Exposure } from "../core/types";
import { dwellYears, exposure, healthFactor, liquidationPrice } from "../core/kernel";
import { footprintFor, type Footprint } from "./holdfasts";
import { fbm } from "./noise";

/**
 * Financial field → terrain grid.
 *
 * The raster is the product's arithmetic: one health-factor reading per
 * (price, dwell) cell, and which lending deployment binds there. This module
 * turns that into something a tilemap can draw. Every territory is the argmin
 * partition, every border is where the argmin changes, every holdfast stands
 * on the highest ground its deployment rules, and sea level is the exact
 * liquidation line.
 *
 * The one licence taken is relief. Health depends on price far more than on
 * dwell, so the raw field is a set of vertical stripes. Two things bend it
 * into a landscape without moving sea level: a domain warp that lets the
 * price axis wander with dwell (the same warp is applied to every reading, so
 * what the map shows at a point is what the book says there), and noise on
 * the height that fades to nothing at the shore and never crosses it.
 */

export const RELIEF = {
  /** Domain warp: how far the price axis wanders, as a fraction of the map width, and its frequency along price and dwell. */
  warp: 0.055,
  warpFreq: { x: 2.4, y: 1.6 },
  /** Height noise on land and under the sea, as a fraction of the ceiling. */
  amplitude: 0.3,
  frequency: 3.0,
  octaves: 3,
  /** Height, as a fraction of the ceiling, over which the noise fades in from sea level. */
  shoreGuard: 0.22,
  /** Tiles kept clear of the map edge when seating a holdfast. */
  seatMargin: 2,
  seed: 7,
} as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (edge: number, x: number) => {
  const t = clamp01(x / edge);
  return t * t * (3 - 2 * t);
};

/**
 * The price-axis fraction the map column `fxMap` actually samples, at map
 * height `vMap` (0 at the bottom row, 1 at the top — the square root of the
 * dwell fraction, because the dwell axis is drawn square-rooted).
 */
export function warpFx(fxMap: number, vMap: number): number {
  const n = fbm(fxMap * RELIEF.warpFreq.x, vMap * RELIEF.warpFreq.y, 2, RELIEF.seed + 11);
  return clamp01(fxMap + RELIEF.warp * n);
}

/** Inverse of `warpFx` by Newton's method: the map column that shows price fraction `fx` at map height `vMap`. */
export function mapFxOf(fx: number, vMap: number): number {
  let m = fx;
  const h = 1e-4;
  for (let i = 0; i < 8; i++) {
    const err = warpFx(m, vMap) - fx;
    if (Math.abs(err) < 1e-7) break;
    const slope = (warpFx(m + h, vMap) - warpFx(m - h, vMap)) / (2 * h) || 1;
    m -= err / slope;
  }
  return clamp01(m);
}

/** The kernel at a field position: lowest health-factor headroom across the book, and which basket has it. */
function kernelAt(raster: Raster, baskets: readonly Basket[], col: number, row: number, ceiling: number): { raw: number; owner: number } {
  const price = priceAt(raster.window, col);
  const t = dwellYears(dwellAt(raster.window, row));
  let raw = Infinity;
  let owner = -1;
  baskets.forEach((b, i) => {
    const z = healthFactor(b, price, t) - 1;
    if (z < raw) {
      raw = z;
      owner = i;
    }
  });
  return { raw: Number.isFinite(raw) ? raw : ceiling, owner };
}

/**
 * Height and owner at a map position, in field units: `col` along the map's
 * price axis (before the warp), `row` up the dwell axis. The kernel is
 * evaluated at the warped point itself, not interpolated, so the map and the
 * readings agree to the pixel. Sea level is exact: the noise is masked to
 * zero at the shore and clamped so it never changes which side of the shore
 * a point is on.
 */
export function heightAt(raster: Raster, baskets: readonly Basket[], col: number, row: number, ceiling: number): { z: number; owner: number } {
  const { width: fw, height: fh } = raster.window;
  const u = col / (fw - 1);
  const v = row / (fh - 1);
  const colField = warpFx(u, v) * (fw - 1);
  const { raw, owner } = kernelAt(raster, baskets, colField, row, ceiling);
  const guard = smoothstep(RELIEF.shoreGuard * ceiling, Math.abs(raw));
  const n = fbm(u * RELIEF.frequency, v * RELIEF.frequency * (fh / fw), RELIEF.octaves, RELIEF.seed);
  let z = raw + guard * RELIEF.amplitude * ceiling * n;
  if (raw >= 0) z = Math.max(0, z);
  else z = Math.min(-1e-6, z);
  return { z, owner };
}

/** Field pixels per tile. Four gives 64 × 64 tiles on the default window. */
export const TILE_PX = 4;

export enum Band {
  /** The abyss beyond the shelf: health far below one. */
  ABYSS = 0,
  /** Deep water: health well below one. The leviathans live here. */
  DEEP = 1,
  /** The shelf just under the surface: liquidated, but only just. */
  SHALLOW = 2,
  /** Beach, mudflat, driftwood: the first dry ground. */
  COAST = 3,
  /** Lowland plains. */
  GRASS = 4,
  /** Midland pine forest and rock. */
  FOREST = 5,
  /** Bare stone. */
  MOUNTAIN = 6,
  /** Snow and aether on the crest. */
  SNOW = 7,
}
export const BAND_COUNT = 8;

/**
 * Elevation thresholds. The dry bands are fractions of the ceiling (the
 * book's maximum health-factor headroom): the rock takes a broad band so the
 * ridge reads as a range, and snow caps only the crest. The water bands are
 * fractions of the floor (the deepest reading in the window), so every book
 * has a shelf, a deep and an abyss however deep its sea goes.
 */
export const THRESHOLDS = { coast: 0.05, grass: 0.4, forest: 0.62, snow: 0.9 } as const;
export const DEPTHS = { shallow: 0.18, deep: 0.5 } as const;

/**
 * The window the survey draws: the survivable bracket takes about two thirds
 * of the width, with real sea on both sides, on a landscape-shaped field.
 */
export function surveyWindow(spot: number, lower: number | null, upper: number | null): Window {
  const size = { width: 320, height: 208 };
  const low = lower ?? spot * 0.72;
  const high = upper ?? spot * 1.38;
  if (!(low > 0) || !(high > low)) return windowAt(spot, size);
  const centre = Math.sqrt(low * high);
  const padded = Math.log(high / low) / 2 / 0.68;
  return windowAt(spot, { ...size, priceLow: (centre * Math.exp(-padded)) / spot - 1, priceHigh: (centre * Math.exp(padded)) / spot - 1 });
}

/** `floor` is the deepest reading in the window (negative); `ceiling` the highest. */
export function bandOf(z: number, ceiling: number, floor = -1): Band {
  if (!Number.isFinite(z)) return Band.SNOW;
  if (z < 0) {
    const d = z / Math.min(-1e-9, floor);
    if (d > DEPTHS.deep) return Band.ABYSS;
    if (d > DEPTHS.shallow) return Band.DEEP;
    return Band.SHALLOW;
  }
  const t = z / Math.max(1e-9, ceiling);
  if (t < THRESHOLDS.coast) return Band.COAST;
  if (t < THRESHOLDS.grass) return Band.GRASS;
  if (t < THRESHOLDS.forest) return Band.FOREST;
  if (t < THRESHOLDS.snow) return Band.MOUNTAIN;
  return Band.SNOW;
}

export const isWater = (b: Band): boolean => b <= Band.SHALLOW;

/** Corner bits of a tile's dual-grid mask. */
export const CORNER = { TL: 1, TR: 2, BL: 4, BR: 8 } as const;

export interface TerrainTile {
  /** Lowest band among the tile's four corners. */
  lo: Band;
  /** The band the transition rises to: `lo + 1` when any corner is higher. */
  hi: Band;
  /** Corner bits (CORNER.*) set where the corner band is above `lo`. 0 = interior. */
  mask: number;
  /** Deployment index that binds at the tile centre, or -1. */
  owner: number;
  /** Elevation at the tile centre. */
  z: number;
}

export interface Zone {
  index: number;
  deploymentId: string;
  exposure: Exposure;
  /** Price at which this deployment liquidates the book at dwell zero. */
  liquidationPrice: number | null;
  /** Share of all tiles this deployment binds. */
  share: number;
}

export interface Citadel {
  zone: number;
  deploymentId: string;
  /** Anchor tile: bottom-centre of the footprint. */
  tx: number;
  ty: number;
  footprint: Footprint;
  z: number;
  share: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A tile on a territory border, and what stands on it. */
export interface Border {
  tx: number;
  ty: number;
  /** A fault where two books of the same side hand over; the pass where long meets short. */
  kind: "fault" | "pass";
}

export interface TerrainGrid {
  cols: number;
  rows: number;
  ceiling: number;
  /** Band per corner, (cols + 1) × (rows + 1), row-major, row 0 at the top. */
  corners: Uint8Array;
  tiles: TerrainTile[];
  zones: Zone[];
  citadels: Citadel[];
  /** Today's price as a fraction along the price axis; dwell zero is the bottom row. */
  today: { fx: number };
  /** The liquidation line as segments in tile units (y down). */
  shoreline: Segment[];
  /** Territory boundaries — where the binding deployment changes — in tile units. */
  boundaries: Segment[];
  /** The same boundaries as tiles, with the feature that marks them. */
  borders: Border[];
  /** Height at every corner, for anything that wants to draw the relief. */
  heights: Float32Array;
}

/* ── sampling ────────────────────────────────────────────────────────── */

/**
 * Map position → field position, unrounded, with the same convention the
 * world uses for a pointer (fraction of the map × (size − 1)), so a tile's
 * height and the reading at its centre are the same evaluation.
 */
function fieldRowForCornerRow(cy: number, rows: number, fieldH: number): number {
  return ((rows - cy) / rows) * (fieldH - 1);
}

function fieldColForCornerCol(cx: number, cols: number, fieldW: number): number {
  return (cx / cols) * (fieldW - 1);
}

export function buildTerrainGrid(raster: Raster, baskets: readonly Basket[], spot: number): TerrainGrid {
  const { width: fw, height: fh } = raster.window;
  const ceiling = Math.max(0.05, raster.range.max);
  const floor = Math.min(-0.03, raster.range.min);
  const cols = Math.ceil(fw / TILE_PX);
  const rows = Math.ceil(fh / TILE_PX);

  /* corners */
  const corners = new Uint8Array((cols + 1) * (rows + 1));
  const heights = new Float32Array((cols + 1) * (rows + 1));
  for (let cy = 0; cy <= rows; cy++) {
    const row = fieldRowForCornerRow(cy, rows, fh);
    for (let cx = 0; cx <= cols; cx++) {
      const col = fieldColForCornerCol(cx, cols, fw);
      const h = heightAt(raster, baskets, col, row, ceiling);
      heights[cy * (cols + 1) + cx] = h.z;
      corners[cy * (cols + 1) + cx] = bandOf(h.z, ceiling, floor);
    }
  }
  const cornerAt = (cx: number, cy: number): Band => corners[cy * (cols + 1) + cx]! as Band;

  /* tiles */
  const tiles: TerrainTile[] = new Array(cols * rows);
  const zoneTiles = new Map<number, number>();
  for (let ty = 0; ty < rows; ty++) {
    const centreRow = fieldRowForCornerRow(ty + 0.5, rows, fh);
    for (let tx = 0; tx < cols; tx++) {
      const tl = cornerAt(tx, ty);
      const tr = cornerAt(tx + 1, ty);
      const bl = cornerAt(tx, ty + 1);
      const br = cornerAt(tx + 1, ty + 1);
      const lo = Math.min(tl, tr, bl, br) as Band;
      const top = Math.max(tl, tr, bl, br) as Band;
      // A tile whose corners span more than one step is drawn as the step
      // above `lo`; the next tile up carries the following step. That keeps a
      // thin band of each material along steep ground instead of a cliff of
      // mismatched edges.
      const hi = top > lo ? ((lo + 1) as Band) : lo;
      let mask = 0;
      if (tl > lo) mask |= CORNER.TL;
      if (tr > lo) mask |= CORNER.TR;
      if (bl > lo) mask |= CORNER.BL;
      if (br > lo) mask |= CORNER.BR;

      const centreCol = fieldColForCornerCol(tx + 0.5, cols, fw);
      const { z, owner } = heightAt(raster, baskets, centreCol, centreRow, ceiling);
      tiles[ty * cols + tx] = { lo, hi, mask, owner, z };
      if (owner >= 0) zoneTiles.set(owner, (zoneTiles.get(owner) ?? 0) + 1);
    }
  }

  /* zones */
  const total = cols * rows;
  const zones: Zone[] = [...zoneTiles.entries()]
    .map(([index, count]) => {
      const basket = baskets[index];
      return {
        index,
        deploymentId: raster.deploymentIds[index] ?? `#${index}`,
        exposure: basket ? exposure(basket) : ("FLAT" as Exposure),
        liquidationPrice: basket ? liquidationPrice(basket, 0) : null,
        share: count / total,
      };
    })
    .sort((a, b) => b.share - a.share);

  /* citadels: the highest ground each territory rules, with room to stand */
  const citadels: Citadel[] = [];
  for (const zone of zones) {
    const footprint = footprintFor(zone.deploymentId, zone.share);
    const seat =
      highestSeat(tiles, cols, rows, zone.index, footprint, RELIEF.seatMargin) ??
      highestSeat(tiles, cols, rows, zone.index, footprint, 0) ??
      highestSeat(tiles, cols, rows, zone.index, { w: 1, h: 1, rise: 1 }, 0);
    if (!seat) continue;
    citadels.push({
      zone: zone.index,
      deploymentId: zone.deploymentId,
      tx: seat.tx,
      ty: seat.ty,
      footprint: seat.footprint,
      z: seat.z,
      share: zone.share,
    });
  }

  /* today's price, as the map column that shows it at dwell zero */
  const today = { fx: mapFxOf(colOfPrice(raster.window, spot) / (fw - 1), 0) };

  /* the liquidation line through the corner heights, and the territory boundaries, in tile units */
  const shoreline = contourCorners(heights, cols + 1, rows + 1, 0);
  const { boundaries, borders } = territoryBorders(tiles, cols, rows, zones);

  return { cols, rows, ceiling, corners, tiles, zones, citadels, today, shoreline, boundaries, borders, heights };
}

/**
 * Marching squares over the corner grid, with linear interpolation along
 * each edge, so the shoreline is a curve through the drawn relief rather
 * than a staircase. Coordinates are tile units, y down.
 */
function contourCorners(values: Float32Array, cw: number, ch: number, level: number): Segment[] {
  const out: Segment[] = [];
  const at = (x: number, y: number) => values[y * cw + x]!;
  const lerp = (a: number, b: number) => (level - a) / (b - a || 1e-9);
  for (let y = 0; y + 1 < ch; y++) {
    for (let x = 0; x + 1 < cw; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      let code = 0;
      if (tl > level) code |= 1;
      if (tr > level) code |= 2;
      if (br > level) code |= 4;
      if (bl > level) code |= 8;
      if (code === 0 || code === 15) continue;
      const top = { x: x + lerp(tl, tr), y };
      const right = { x: x + 1, y: y + lerp(tr, br) };
      const bottom = { x: x + lerp(bl, br), y: y + 1 };
      const left = { x, y: y + lerp(tl, bl) };
      const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      switch (code) {
        case 1: case 14: seg(left, top); break;
        case 2: case 13: seg(top, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(right, bottom); break;
        case 5: seg(left, top); seg(right, bottom); break;
        case 6: case 9: seg(top, bottom); break;
        case 7: case 8: seg(left, bottom); break;
        case 10: seg(top, right); seg(left, bottom); break;
        default: break;
      }
    }
  }
  return out;
}

/* ── seats ───────────────────────────────────────────────────────────── */

/** Cells under a footprint anchored at its bottom-centre tile. */
export function footprintCells(tx: number, ty: number, footprint: { w: number; h: number }): { tx: number; ty: number }[] {
  const x0 = tx - Math.floor(footprint.w / 2);
  const out: { tx: number; ty: number }[] = [];
  for (let dy = 0; dy < footprint.h; dy++) for (let dx = 0; dx < footprint.w; dx++) out.push({ tx: x0 + dx, ty: ty - dy });
  return out;
}

function dryOwned(tiles: TerrainTile[], cols: number, rows: number, zone: number, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return false;
  const t = tiles[ty * cols + tx]!;
  return t.owner === zone && !isWater(t.lo);
}

/**
 * The highest tile the zone owns on which the whole footprint stands on dry
 * ground it also owns. Height is the reading, so the seat marks the safest
 * point of the territory. Ties go to the tile nearest the territory's centre,
 * which keeps seats off the edge of thin ridges.
 */
function highestSeat(
  tiles: TerrainTile[],
  cols: number,
  rows: number,
  zone: number,
  footprint: Footprint,
  margin: number,
): { tx: number; ty: number; z: number; footprint: Footprint } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (!dryOwned(tiles, cols, rows, zone, tx, ty)) continue;
      sx += tx;
      sy += ty;
      n++;
    }
  }
  if (n === 0) return null;
  const cx = sx / n;
  const cy = sy / n;

  let best: { tx: number; ty: number; z: number; dist: number } | null = null;
  // The whole structure must stand inside the map, clear of its edge by `margin`: its top row is `rise - 1` tiles above the anchor.
  const halfL = Math.floor(footprint.w / 2);
  const halfR = footprint.w - halfL - 1;
  for (let ty = footprint.rise - 1 + margin; ty < rows - margin; ty++) {
    for (let tx = margin + halfL; tx < cols - margin - halfR; tx++) {
      const anchor = tiles[ty * cols + tx]!;
      if (anchor.mask !== 0 || !dryOwned(tiles, cols, rows, zone, tx, ty)) continue;
      if (!footprintCells(tx, ty, footprint).every((c) => dryOwned(tiles, cols, rows, zone, c.tx, c.ty))) continue;
      const dist = Math.hypot(tx - cx, ty - cy);
      // Height decides; only an exact tie is broken by the pull toward the centre.
      const higher = !best || anchor.z > best.z + 1e-9;
      const tied = best && Math.abs(anchor.z - best.z) <= 1e-9 && dist < best.dist;
      if (higher || tied) best = { tx, ty, z: anchor.z, dist };
    }
  }
  return best ? { tx: best.tx, ty: best.ty, z: best.z, footprint } : null;
}

/* ── borders ─────────────────────────────────────────────────────────── */

/**
 * Edges between dry tiles whose binding deployment differs, both as segments
 * for drawing and as the tiles that carry the feature: a fault where two
 * books of the same side hand over, the pass where a long book meets a short
 * one, because that crest is the only place the ground can be crossed in
 * both directions.
 */
function territoryBorders(tiles: TerrainTile[], cols: number, rows: number, zones: Zone[]): { boundaries: Segment[]; borders: Border[] } {
  const side = new Map<number, Exposure>(zones.map((z) => [z.index, z.exposure]));
  const boundaries: Segment[] = [];
  const marked = new Map<string, Border>();
  const mark = (tx: number, ty: number, a: number, b: number) => {
    const opposite = side.get(a) !== side.get(b) && side.get(a) !== "FLAT" && side.get(b) !== "FLAT";
    const key = `${tx},${ty}`;
    const prior = marked.get(key);
    if (!prior || (opposite && prior.kind === "fault")) marked.set(key, { tx, ty, kind: opposite ? "pass" : "fault" });
  };
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const t = tiles[ty * cols + tx]!;
      if (t.owner < 0 || isWater(t.lo)) continue;
      if (tx + 1 < cols) {
        const r = tiles[ty * cols + tx + 1]!;
        if (r.owner >= 0 && !isWater(r.lo) && r.owner !== t.owner) {
          boundaries.push({ x1: tx + 1, y1: ty, x2: tx + 1, y2: ty + 1 });
          mark(tx, ty, t.owner, r.owner);
        }
      }
      if (ty + 1 < rows) {
        const b = tiles[(ty + 1) * cols + tx]!;
        if (b.owner >= 0 && !isWater(b.lo) && b.owner !== t.owner) {
          boundaries.push({ x1: tx, y1: ty + 1, x2: tx + 1, y2: ty + 1 });
          mark(tx, ty, t.owner, b.owner);
        }
      }
    }
  }
  return { boundaries, borders: [...marked.values()] };
}

/* ── axes ────────────────────────────────────────────────────────────── */

/** Price axis fraction → tile x (float). */
export function priceFxToTileX(fx: number, cols: number): number {
  return fx * cols;
}

/** Dwell fraction (0 = today, 1 = full window) → tile y (float, row 0 at top). */
export function dwellFyToTileY(fy: number, rows: number): number {
  return (1 - Math.sqrt(Math.min(1, Math.max(0, fy)))) * rows;
}
