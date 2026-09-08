import type { Raster } from "../field/raster";
import { colOfPrice } from "../field/raster";
import type { Basket, Exposure } from "../core/types";
import { exposure, liquidationPrice } from "../core/kernel";
import { contour } from "../render/contours";
import { footprintFor, type Footprint } from "./holdfasts";

/**
 * Financial field → terrain grid.
 *
 * The raster is the product's arithmetic: one health-factor reading per
 * (price, dwell) cell, and which lending deployment binds there. This module
 * turns that into something a tilemap can draw, and nothing here invents a
 * feature. Every band edge is an elevation threshold on measured ground, every
 * territory is the argmin partition, every border is where the argmin changes,
 * and every holdfast stands on the highest ground its deployment rules.
 */

/** Field pixels per tile. Four gives 64 × 64 tiles on the default window. */
export const TILE_PX = 4;

export enum Band {
  /** Deep water: health well below one. The leviathans live here. */
  DEEP = 0,
  /** The shelf just under the surface: liquidated, but only just. */
  SHALLOW = 1,
  /** Beach, mudflat, driftwood: the first dry ground. */
  COAST = 2,
  /** Lowland plains. */
  GRASS = 3,
  /** Midland pine forest and rock. */
  FOREST = 4,
  /** Bare stone. */
  MOUNTAIN = 5,
  /** Snow and aether on the crest. */
  SNOW = 6,
}
export const BAND_COUNT = 7;

/**
 * Elevation thresholds. Water is split at an absolute depth; the dry bands
 * are fractions of the ceiling (the book's maximum health-factor headroom).
 */
export const THRESHOLDS = { shallow: -0.06, coast: 0.05, grass: 0.5, forest: 0.8, mountain: 0.95 } as const;

export function bandOf(z: number, ceiling: number): Band {
  if (!Number.isFinite(z)) return Band.SNOW;
  if (z < THRESHOLDS.shallow) return Band.DEEP;
  if (z < 0) return Band.SHALLOW;
  const t = z / Math.max(1e-9, ceiling);
  if (t < THRESHOLDS.coast) return Band.COAST;
  if (t < THRESHOLDS.grass) return Band.GRASS;
  if (t < THRESHOLDS.forest) return Band.FOREST;
  if (t < THRESHOLDS.mountain) return Band.MOUNTAIN;
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
  /** A road where two books of the same side meet; a ruined wall where long meets short. */
  kind: "road" | "wall";
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
}

/* ── sampling ────────────────────────────────────────────────────────── */

/** Field row (dwell grows upward) for a corner row (grows downward). */
function fieldRowForCornerRow(cy: number, rows: number, fieldH: number): number {
  return Math.min(fieldH - 1, Math.max(0, Math.round((rows - cy) * TILE_PX)));
}

function fieldColForCornerCol(cx: number, fieldW: number): number {
  return Math.min(fieldW - 1, Math.max(0, Math.round(cx * TILE_PX)));
}

export function buildTerrainGrid(raster: Raster, baskets: readonly Basket[], spot: number): TerrainGrid {
  const { width: fw, height: fh } = raster.window;
  const ceiling = Math.max(0.05, raster.range.max);
  const cols = Math.ceil(fw / TILE_PX);
  const rows = Math.ceil(fh / TILE_PX);

  /* corners */
  const corners = new Uint8Array((cols + 1) * (rows + 1));
  for (let cy = 0; cy <= rows; cy++) {
    const row = fieldRowForCornerRow(cy, rows, fh);
    for (let cx = 0; cx <= cols; cx++) {
      const col = fieldColForCornerCol(cx, fw);
      corners[cy * (cols + 1) + cx] = bandOf(raster.z[row * fw + col]!, ceiling);
    }
  }
  const cornerAt = (cx: number, cy: number): Band => corners[cy * (cols + 1) + cx]! as Band;

  /* tiles */
  const tiles: TerrainTile[] = new Array(cols * rows);
  const zoneTiles = new Map<number, number>();
  for (let ty = 0; ty < rows; ty++) {
    const centreRow = Math.min(fh - 1, Math.max(0, Math.round((rows - ty - 0.5) * TILE_PX)));
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

      const centreCol = Math.min(fw - 1, Math.round((tx + 0.5) * TILE_PX));
      const at = centreRow * fw + centreCol;
      const owner = raster.argmin[at]!;
      const z = raster.z[at]!;
      tiles[ty * cols + tx] = { lo, hi, mask, owner, z: Number.isFinite(z) ? z : ceiling };
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
    const seat = highestSeat(tiles, cols, rows, zone.index, footprint) ?? highestSeat(tiles, cols, rows, zone.index, { w: 1, h: 1, rise: 1 });
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

  /* today's price */
  const today = { fx: colOfPrice(raster.window, spot) / (fw - 1) };

  /* the liquidation line and the territory boundaries, in tile units */
  const toTile = (col: number, row: number) => ({ x: col / TILE_PX, y: (fh - 1 - row) / TILE_PX });
  const shoreline: Segment[] = contour(raster, 0).segments.map((s) => {
    const a = toTile(s.x1, s.y1);
    const b = toTile(s.x2, s.y2);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });
  const { boundaries, borders } = territoryBorders(tiles, cols, rows, zones);

  return { cols, rows, ceiling, corners, tiles, zones, citadels, today, shoreline, boundaries, borders };
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
  // The whole structure must stand inside the map: its top row is `rise - 1` tiles above the anchor.
  for (let ty = footprint.rise - 1; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
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
 * for drawing and as the tiles that carry the feature. A road runs where two
 * books of the same side hand over; a ruined wall stands on the pass where a
 * long book meets a short one, because that crest is the only place the
 * ground can be crossed in both directions.
 */
function territoryBorders(tiles: TerrainTile[], cols: number, rows: number, zones: Zone[]): { boundaries: Segment[]; borders: Border[] } {
  const side = new Map<number, Exposure>(zones.map((z) => [z.index, z.exposure]));
  const boundaries: Segment[] = [];
  const marked = new Map<string, Border>();
  const mark = (tx: number, ty: number, a: number, b: number) => {
    const opposite = side.get(a) !== side.get(b) && side.get(a) !== "FLAT" && side.get(b) !== "FLAT";
    const key = `${tx},${ty}`;
    const prior = marked.get(key);
    if (!prior || (opposite && prior.kind === "road")) marked.set(key, { tx, ty, kind: opposite ? "wall" : "road" });
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
