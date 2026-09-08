import type { Raster } from "../field/raster";
import { colOfPrice } from "../field/raster";
import type { Basket, Exposure } from "../core/types";
import { exposure, liquidationPrice } from "../core/kernel";
import { contour } from "../render/contours";

/**
 * Financial field → terrain grid.
 *
 * The raster is the product's arithmetic: one health-factor reading per
 * (price, dwell) cell, and which lending deployment binds there. This module
 * turns that into something a tilemap can draw, and nothing here invents a
 * feature. Every band edge is an elevation threshold on measured ground, every
 * territory is the argmin partition, and every citadel stands on the dry
 * centroid of the ground its deployment actually rules.
 */

/** Field pixels per tile. Four gives ~76 × 54 tiles on the default window. */
export const TILE_PX = 4;

export enum Band {
  WATER = 0,
  COAST = 1,
  GRASS = 2,
  HIGHLAND = 3,
  MOUNTAIN = 4,
}
export const BAND_COUNT = 5;

/** Elevation thresholds as fractions of the ceiling (max health-factor headroom). */
export const THRESHOLDS = { coast: 0.06, grass: 0.62, highland: 0.92 } as const;

export function bandOf(z: number, ceiling: number): Band {
  if (!Number.isFinite(z)) return Band.MOUNTAIN;
  if (z < 0) return Band.WATER;
  const t = z / Math.max(1e-9, ceiling);
  if (t < THRESHOLDS.coast) return Band.COAST;
  if (t < THRESHOLDS.grass) return Band.GRASS;
  if (t < THRESHOLDS.highland) return Band.HIGHLAND;
  return Band.MOUNTAIN;
}

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
  tx: number;
  ty: number;
  share: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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

  /* citadels: the dry centroid of each territory */
  const citadels: Citadel[] = [];
  for (const zone of zones) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const t = tiles[ty * cols + tx]!;
        if (t.owner !== zone.index || t.lo === Band.WATER) continue;
        sx += tx;
        sy += ty;
        n++;
      }
    }
    if (n === 0) continue;
    let tx = Math.round(sx / n);
    let ty = Math.round(sy / n);
    if (!ownsDry(tiles, cols, rows, zone.index, tx, ty)) {
      const found = nearestOwnedDry(tiles, cols, rows, zone.index, tx, ty);
      if (!found) continue;
      tx = found.tx;
      ty = found.ty;
    }
    citadels.push({ zone: zone.index, deploymentId: zone.deploymentId, tx, ty, share: zone.share });
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
  const boundaries = territoryBoundaries(tiles, cols, rows);

  return { cols, rows, ceiling, corners, tiles, zones, citadels, today, shoreline, boundaries };
}

function ownsDry(tiles: TerrainTile[], cols: number, rows: number, zone: number, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return false;
  const t = tiles[ty * cols + tx]!;
  return t.owner === zone && t.lo !== Band.WATER && t.mask === 0;
}

/** Spiral outward until an interior dry tile this zone owns turns up. */
function nearestOwnedDry(
  tiles: TerrainTile[],
  cols: number,
  rows: number,
  zone: number,
  tx: number,
  ty: number,
): { tx: number; ty: number } | null {
  for (let r = 1; r < Math.max(cols, rows); r++) {
    for (let d = -r; d <= r; d++) {
      for (const c of [
        { tx: tx + d, ty: ty - r },
        { tx: tx + d, ty: ty + r },
        { tx: tx - r, ty: ty + d },
        { tx: tx + r, ty: ty + d },
      ]) {
        if (ownsDry(tiles, cols, rows, zone, c.tx, c.ty)) return c;
      }
    }
  }
  return null;
}

/**
 * Edges between tiles whose binding deployment differs, as short segments
 * along the shared tile edge. On dry ground only: under water the question of
 * who kills you first is already answered.
 */
function territoryBoundaries(tiles: TerrainTile[], cols: number, rows: number): Segment[] {
  const out: Segment[] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const t = tiles[ty * cols + tx]!;
      if (t.owner < 0 || t.lo === Band.WATER) continue;
      if (tx + 1 < cols) {
        const r = tiles[ty * cols + tx + 1]!;
        if (r.owner >= 0 && r.lo !== Band.WATER && r.owner !== t.owner) {
          out.push({ x1: tx + 1, y1: ty, x2: tx + 1, y2: ty + 1 });
        }
      }
      if (ty + 1 < rows) {
        const b = tiles[(ty + 1) * cols + tx]!;
        if (b.owner >= 0 && b.lo !== Band.WATER && b.owner !== t.owner) {
          out.push({ x1: tx, y1: ty + 1, x2: tx + 1, y2: ty + 1 });
        }
      }
    }
  }
  return out;
}

/** Price axis fraction → tile x (float). */
export function priceFxToTileX(fx: number, cols: number): number {
  return fx * cols;
}

/** Dwell fraction (0 = today, 1 = full window) → tile y (float, row 0 at top). */
export function dwellFyToTileY(fy: number, rows: number): number {
  return (1 - Math.sqrt(Math.min(1, Math.max(0, fy)))) * rows;
}
