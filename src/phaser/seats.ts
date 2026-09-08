import type { Sprite } from "../arcane/figures";

/**
 * The seats of the territories, drawn large.
 *
 * These are no longer baked into the terrain at ground scale. Each is its own
 * sprite standing over the map at nearly twice the ground's pixel size, with a
 * beacon at its apex, because the seat of a lending deployment is the thing on
 * the chart a viewer should be able to find from across the room.
 */

const STONE: Record<string, string> = {
  g: "#2f8f9c", // plating
  G: "#8ef0f7", // lit panel
  L: "#d8fbff", // beacon
  d: "#16505c", // shadow
  s: "#1d6b78", // mid
  w: "#0c2530", // window / void
  k: "#081820", // base shadow
  b: "#b08d4a", // brass
};

/** The grand ziggurat: the seat that rules most of the ground. */
export const SEAT_ZIGGURAT: Sprite = {
  palette: STONE,
  art: [
    "..............L..............",
    ".............LLL.............",
    "..............L..............",
    ".............bbb.............",
    "............ggGgg............",
    "...........ggwGwgg...........",
    "..........gggGGGggg..........",
    ".........ggggggggggg.........",
    "........ddddddddddddd........",
    ".......ggwwgggGgggwwgg.......",
    "......gggggggGGGggggggg......",
    ".....ggggggggggggggggggg.....",
    "....ddddddddddddddddddddd....",
    "...gggwwggggwwGwwggggwwggg...",
    "..gggggggggggGGGggggggggggg..",
    ".ggggggggggggggggggggggggggg.",
    "ddddddddddddddddddddddddddddd",
    "sgggwwgggwwgggGGGgggwwgggwwgs",
    "sggggggggggggGGGGGggggggggggs",
    "sggggggggggggwwwwwggggggggggs",
    "sggggggggggggwwwwwggggggggggs",
    "kkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
  ],
};

/** The columned temple: a seat with a solid share. */
export const SEAT_TEMPLE: Sprite = {
  palette: STONE,
  art: [
    "..........L..........",
    ".........LLL.........",
    "..........b..........",
    "........ggGgg........",
    "......gggGGGggg......",
    "....ggggggggggggg....",
    "..ggggggggggggggggg..",
    ".ddddddddddddddddddd.",
    ".gg.gg.gg.GG.gg.gg.g.",
    ".gg.gg.gg.GG.gg.gg.g.",
    ".gg.gg.gg.GG.gg.gg.g.",
    ".gg.gg.gg.GG.gg.gg.g.",
    ".gg.gg.gg.ww.gg.gg.g.",
    ".ggggggggggggggggggg.",
    "sddddddddddddddddddds",
    "kkkkkkkkkkkkkkkkkkkkk",
  ],
};

/** The watchtower: a seat holding little ground. */
export const SEAT_TOWER: Sprite = {
  palette: STONE,
  art: [
    "......L......",
    ".....LLL.....",
    "......b......",
    "....ggGgg....",
    "...gggggggg..",
    "..ggwwGGwwgg.",
    "..gggggggggg.",
    "....gggggg...",
    "....ggwwgg...",
    "....gGGGGg...",
    "....ggwwgg...",
    "....gggggg...",
    "....ggwwgg...",
    "....gGGGGg...",
    "...dgggggggd.",
    "..ddgg.gg.dd.",
    ".ggggggggggg.",
    "kkkkkkkkkkkkk",
  ],
};

export function seatFor(share: number): Sprite {
  if (share > 0.34) return SEAT_ZIGGURAT;
  if (share > 0.15) return SEAT_TEMPLE;
  return SEAT_TOWER;
}
