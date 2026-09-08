import Phaser from "phaser";
import type { BakedChart } from "./bakeChart";

/**
 * The ground, as a tilemap of Kenney's Tiny Town.
 *
 * One tile is four chart pixels, sampled at its centre. Which tile a cell gets
 * follows the measured field: water where the ground is below the liquidation
 * line, a ring of bare earth along the shore, grass on the low country, earth
 * on the uplands and stone on the summits. The edges between bands are
 * autotiled from the pack's nine-slice, so the country reads as drawn rather
 * than as coloured squares — but every boundary is still where the field puts it.
 */

/** Chart pixels per tile. */
export const TILE_CHART_PX = 4;
const TILE = 16;

/** Tiny Town frame indices (12 columns). */
const TT = {
  grass: [0, 0, 0, 0, 1, 1, 2],
  earth: [39, 40, 41, 42],
  stone: [108, 109, 110, 120, 121, 122],
  // nine-slice for earth meeting grass: row of top edges, sides, bottom edges
  earthEdge: {
    tl: 12, t: 13, tr: 14,
    l: 24, c: 25, r: 26,
    bl: 36, b: 37, br: 38,
  },
} as const;

/** GID where the generated water tileset starts, well clear of Tiny Town. */
const WATER_GID = 1000;
const WATER_VARIANTS = 4;
export const WATER_KEY = "water-tiles";

/**
 * Tiny Town has no water, so four variants are generated in its palette: flat
 * teal with a few lighter wave marks, differing only in where the marks fall.
 */
export function ensureWaterTileset(scene: Phaser.Scene): void {
  if (scene.textures.exists(WATER_KEY)) return;
  const canvas = document.createElement("canvas");
  canvas.width = TILE * WATER_VARIANTS;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d")!;
  for (let v = 0; v < WATER_VARIANTS; v++) {
    const x0 = v * TILE;
    ctx.fillStyle = "#1a5064";
    ctx.fillRect(x0, 0, TILE, TILE);
    ctx.fillStyle = "#1f5c72";
    for (let i = 0; i < 6; i++) {
      const px = (i * 5 + v * 3) % TILE;
      const py = (i * 7 + v * 5) % TILE;
      ctx.fillRect(x0 + px, py, 2, 1);
    }
    ctx.fillStyle = "#3b8aa0";
    ctx.fillRect(x0 + ((v * 4 + 2) % 12), (v * 3 + 4) % 14, 3, 1);
    ctx.fillRect(x0 + ((v * 6 + 8) % 13), (v * 5 + 11) % 15, 2, 1);
  }
  scene.textures.addCanvas(WATER_KEY, canvas);
}

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Band = "water" | "shore" | "grass" | "earth" | "stone";

function bandAt(chart: BakedChart, tx: number, ty: number, tiles: { w: number; h: number }): Band {
  const cx = Math.min(chart.width - 1, tx * TILE_CHART_PX + 2);
  const cy = Math.min(chart.height - 1, ty * TILE_CHART_PX + 2);
  const i = cy * chart.width + cx;
  if (chart.wet[i]) return "water";
  const z = chart.z[i]!;
  const t = z / Math.max(1e-6, chart.ceiling);
  if (t < 0.06) return "shore";
  if (t < 0.62) return "grass";
  if (t < 0.92) return "earth";
  void tiles;
  return "stone";
}

export interface Ground {
  map: Phaser.Tilemaps.Tilemap;
  layer: Phaser.Tilemaps.TilemapLayer;
  /** Tile grid size. */
  cols: number;
  rows: number;
}

export function buildGround(
  scene: Phaser.Scene,
  chart: BakedChart,
  townKey: string,
  scale: number,
): Ground {
  ensureWaterTileset(scene);

  const cols = Math.ceil(chart.width / TILE_CHART_PX);
  const rows = Math.ceil(chart.height / TILE_CHART_PX);

  const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: cols, height: rows });
  const town = map.addTilesetImage("tiny-town", townKey, TILE, TILE, 0, 0, 0)!;
  const water = map.addTilesetImage("water", WATER_KEY, TILE, TILE, 0, 0, WATER_GID)!;
  const layer = map.createBlankLayer("ground", [town, water], 0, 0, cols, rows, TILE, TILE)!;
  layer.setScale(scale).setDepth(0);

  const size = { w: cols, h: rows };
  const bands: Band[] = new Array(cols * rows);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) bands[ty * cols + tx] = bandAt(chart, tx, ty, size);
  }
  const band = (tx: number, ty: number): Band =>
    tx < 0 || ty < 0 || tx >= cols || ty >= rows ? "water" : bands[ty * cols + tx]!;

  const pick = (list: readonly number[], tx: number, ty: number, salt: number) =>
    list[Math.floor(hash(tx, ty, salt) * list.length)]!;

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const b = band(tx, ty);
      let index: number;
      switch (b) {
        case "water":
          index = WATER_GID + Math.floor(hash(tx, ty, 9) * WATER_VARIANTS);
          break;
        case "shore":
          index = pick(TT.earth, tx, ty, 3);
          break;
        case "grass":
          index = pick(TT.grass, tx, ty, 1);
          break;
        case "stone":
          index = pick(TT.stone, tx, ty, 5);
          break;
        default: {
          // Earth meets grass through the nine-slice, so the upland has an
          // edge rather than a seam. Only grass counts as "outside": water,
          // shore and stone are drawn on their own and need no lip.
          const g = (dx: number, dy: number) => band(tx + dx, ty + dy) === "grass";
          const n = g(0, -1), s = g(0, 1), w = g(-1, 0), e = g(1, 0);
          const E = TT.earthEdge;
          if (n && w) index = E.tl;
          else if (n && e) index = E.tr;
          else if (s && w) index = E.bl;
          else if (s && e) index = E.br;
          else if (n) index = E.t;
          else if (s) index = E.b;
          else if (w) index = E.l;
          else if (e) index = E.r;
          else index = pick(TT.earth, tx, ty, 4);
        }
      }
      layer.putTileAt(index, tx, ty);
    }
  }

  return { map, layer, cols, rows };
}

/* ── trees and seats, from the same sheet ────────────────────────────── */

/** Tiny Town tree frames by the bake's altitude kinds. */
export const TREES: Record<"tall" | "mid" | "low" | "clump", readonly number[]> = {
  tall: [4, 7, 8, 18, 19],
  mid: [5, 16, 28],
  low: [17, 27],
  clump: [3, 9, 10, 15, 21, 22],
};

export function treeFrame(kind: keyof typeof TREES, x: number, y: number): number {
  const list = TREES[kind];
  return list[Math.floor(hash(x, y, 21) * list.length)]!;
}

/**
 * Seats composed from the pack's own castle and house pieces, so they sit in
 * the same pixel scale as the ground under them. Rows run top to bottom;
 * -1 is an empty cell.
 */
export const SEATS = {
  castle: [
    [96, 97, 97, 97, 98],
    [125, 126, 114, 126, 125],
    [126, 125, 111, 125, 126],
  ],
  hall: [
    [-1, 52, 53, 54, -1],
    [-1, 64, 65, 66, -1],
    [-1, 88, 89, 90, -1],
  ],
  tower: [[114], [125], [123]],
} as const;

export type SeatKind = keyof typeof SEATS;

export function seatKindFor(share: number): SeatKind {
  if (share > 0.34) return "castle";
  if (share > 0.15) return "hall";
  return "tower";
}
