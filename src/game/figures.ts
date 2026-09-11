/**
 * Everything that stands on the ground, as sheet keys and frame indices.
 *
 * Two CC0 sheets from Kenney (Tiny Town, Tiny Dungeon; 16px, 12 columns,
 * row-major) and the sheets baked by scripts/bake-sprites.ts.
 */
import type { ClutterKind } from "./clutter";

export const SHEET = {
  town: "kenney-tiny-town",
  dungeon: "kenney-tiny-dungeon",
  surveyor: "scree-surveyor",
  monsters: "scree-monsters",
  scouts: "scree-scouts",
  clutter: "scree-clutter",
  peaks: "scree-peaks",
  fx: "scree-fx",
} as const;

/** Particle motes and living parts, frames of the fx sheet. */
export const FX = { bubble: 0, droplet: 1, spark: 2, smoke: 3, cog: 4, orb: 5, glow: 6, window: 7, staff: 8, peg: 9 } as const;

/** The surveyor sheet: 32×40 frames, 8 per row, rows in this order. */
export const SURVEYOR = { frameWidth: 32, frameHeight: 40, perRow: 8, rows: ["idle", "walk_down", "walk_up", "walk_left", "walk_right"] as const };

/** The scouts sheet: 16×16 frames, a four-frame march then two frames sunk under the foam. */
export const SCOUT = { frameWidth: 16, frameHeight: 16, march: [0, 3], drowned: [4, 5] } as const;

/** The monsters sheet: 12 frames per monster, swim 0-3, dive 4-7, surface 8-11. */
export const MONSTERS = {
  frameWidth: 16,
  frameHeight: 16,
  kinds: [
    { key: "kraken", row: 0, name: "Slippage Kraken", warning: "Thin books down here turn a small sale into a deep one. Selling into this water moves the price you sell at." },
    { key: "leviathan", row: 1, name: "Cascading Liquidation Leviathan", warning: "One liquidation feeds the next. Forced sales push price into the next book's shore, and that book sells too." },
    { key: "wyrm", row: 2, name: "Oracle Drift Wyrm", warning: "Oracles lag the market. The water is deeper than the last print says, and the print is what liquidates you." },
  ] as const,
};
export type MonsterKind = (typeof MONSTERS.kinds)[number]["key"];

/** Clutter kinds → the sheet and frames that draw them. */
export const CLUTTER: Record<ClutterKind, { sheet: string; frames: readonly number[] }> = {
  tree: { sheet: SHEET.town, frames: [5, 6, 30, 31, 32] },
  pine: { sheet: SHEET.town, frames: [4, 7, 8, 16, 18, 19, 20, 28] },
  bush: { sheet: SHEET.clutter, frames: [12, 13] },
  mushroom: { sheet: SHEET.town, frames: [29] },
  rock: { sheet: SHEET.clutter, frames: [0, 1, 2] },
  crystal: { sheet: SHEET.clutter, frames: [3, 4, 5] },
  driftwood: { sheet: SHEET.clutter, frames: [6, 7] },
  log: { sheet: SHEET.clutter, frames: [14] },
  ruin: { sheet: SHEET.clutter, frames: [8, 9] },
  pillar: { sheet: SHEET.dungeon, frames: [18, 30] },
  statue: { sheet: SHEET.dungeon, frames: [19, 20] },
  skull: { sheet: SHEET.dungeon, frames: [74] },
  snowrock: { sheet: SHEET.clutter, frames: [10, 11] },
  peak: { sheet: SHEET.peaks, frames: [0, 1, 2] },
  snowpeak: { sheet: SHEET.peaks, frames: [3, 4, 5] },
};

/** Colours for zone flags and boundaries, by zone order. */
export const ZONE_COLOURS = [0x35e0e8, 0xe0b25a, 0xe2603a, 0x9bb06f, 0xc58bd6, 0x6fa8dc];
