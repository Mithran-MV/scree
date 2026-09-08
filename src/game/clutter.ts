import { Band, type TerrainGrid } from "./terrain";

/**
 * Environmental clutter, planned from the terrain.
 *
 * Each biome has its own catalogue and densities; a slow noise groups trees
 * into groves and rocks into fields so the scatter reads as a landscape and
 * not as static. Everything is a rule of the tile under it: nothing stands on
 * a transition tile, in water, or on ground something else already claims.
 */

export type ClutterKind =
  | "tree"
  | "pine"
  | "bush"
  | "mushroom"
  | "rock"
  | "crystal"
  | "driftwood"
  | "log"
  | "ruin"
  | "pillar"
  | "statue"
  | "skull"
  | "snowrock"
  | "peak"
  | "snowpeak";

export interface Placement {
  tx: number;
  ty: number;
  kind: ClutterKind;
  /** Which frame of the kind's set, 0..n-1 (the scene picks the set). */
  variant: number;
  /** Position inside the tile, 0..1, so rows never line up. */
  ox: number;
  oy: number;
}

interface Roll {
  kind: ClutterKind;
  /** Chance per tile before the grove factor. */
  p: number;
  /** Follow the grove noise (trees) or ignore it (rocks). */
  grove?: boolean;
  variants: number;
}

const CATALOGUE: Partial<Record<Band, readonly Roll[]>> = {
  [Band.COAST]: [
    { kind: "driftwood", p: 0.07, variants: 2 },
    { kind: "rock", p: 0.04, variants: 3 },
    { kind: "skull", p: 0.004, variants: 1 },
  ],
  [Band.GRASS]: [
    { kind: "tree", p: 0.16, grove: true, variants: 5 },
    { kind: "bush", p: 0.07, grove: true, variants: 2 },
    { kind: "mushroom", p: 0.02, variants: 1 },
    { kind: "rock", p: 0.02, variants: 3 },
    { kind: "statue", p: 0.004, variants: 2 },
    { kind: "ruin", p: 0.004, variants: 2 },
  ],
  [Band.FOREST]: [
    { kind: "pine", p: 0.4, grove: true, variants: 8 },
    { kind: "bush", p: 0.08, variants: 2 },
    { kind: "rock", p: 0.06, variants: 3 },
    { kind: "log", p: 0.02, variants: 1 },
    { kind: "pillar", p: 0.008, variants: 2 },
    { kind: "skull", p: 0.004, variants: 1 },
  ],
  [Band.MOUNTAIN]: [
    { kind: "peak", p: 0.34, grove: true, variants: 3 },
    { kind: "rock", p: 0.18, variants: 3 },
    { kind: "crystal", p: 0.08, variants: 3 },
    { kind: "ruin", p: 0.02, variants: 2 },
    { kind: "pillar", p: 0.006, variants: 2 },
  ],
  [Band.SNOW]: [
    { kind: "snowpeak", p: 0.42, grove: true, variants: 3 },
    { kind: "snowrock", p: 0.1, variants: 2 },
    { kind: "crystal", p: 0.09, variants: 3 },
  ],
};

export function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Slow noise in about [0.3, 1.7]: groves and clearings five tiles across. */
function grove(tx: number, ty: number): number {
  const gx = Math.floor(tx / 5);
  const gy = Math.floor(ty / 5);
  const fx = (tx % 5) / 5;
  const fy = (ty % 5) / 5;
  const a = hash(gx, gy, 77);
  const b = hash(gx + 1, gy, 77);
  const c = hash(gx, gy + 1, 77);
  const d = hash(gx + 1, gy + 1, 77);
  const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  return 0.3 + v * 1.4;
}

/**
 * Plan the scatter. `blocked` says which tiles something else stands on:
 * terraces, holdfast footprints, borders, the surveyor's start.
 */
export function planClutter(grid: TerrainGrid, blocked: (tx: number, ty: number) => boolean): Placement[] {
  const out: Placement[] = [];
  for (let ty = 0; ty < grid.rows; ty++) {
    for (let tx = 0; tx < grid.cols; tx++) {
      const tile = grid.tiles[ty * grid.cols + tx]!;
      if (tile.mask !== 0 || blocked(tx, ty)) continue;
      const rolls = CATALOGUE[tile.lo];
      if (!rolls) continue;
      const g = grove(tx, ty);
      let r = hash(tx, ty, 101);
      for (const roll of rolls) {
        const p = roll.p * (roll.grove ? g : 1);
        if (r < p) {
          out.push({
            tx,
            ty,
            kind: roll.kind,
            variant: Math.floor(hash(tx, ty, 103) * roll.variants),
            ox: 0.2 + hash(tx, ty, 105) * 0.6,
            oy: 0.55 + hash(tx, ty, 107) * 0.4,
          });
          break;
        }
        r -= p;
      }
    }
  }
  return out;
}
