import type { Palette, Sprite } from "./figures";

/**
 * The furniture of the chart, drawn the way an old map draws country: mountains
 * as ranked peaks, settlements as elevations rather than pins, ruins where the
 * ground has drowned. Every one of these is placed from the field — a peak
 * stands where the ground is genuinely high, a temple on the territory that
 * genuinely rules there — so the density is a reading, not decoration.
 */

const LAND: Palette = {
  l: "#8fa8c8", // lit face
  m: "#4e6f9a", // mid face
  d: "#26405f", // shadowed face
  k: "#132840", // base shadow
  s: "#c9dcf0", // snow / highlight
  g: "#c9a052", // gilt edge
  G: "#ffe9a8", // gilt lit
};

export const PEAK_LARGE: Sprite = {
  palette: LAND,
  art: [
    "......s......",
    ".....sls.....",
    "....llsdd....",
    "...lllmddd...",
    "..lllmmdddd..",
    ".llllmmddddd.",
    "llllmmmdddddd",
    "kkkkkkkkkkkkk",
  ],
};

export const PEAK_MID: Sprite = {
  palette: LAND,
  art: [
    "....s....",
    "...lsd...",
    "..llmdd..",
    ".lllmddd.",
    "llllmdddd",
    "kkkkkkkkk",
  ],
};

export const PEAK_SMALL: Sprite = {
  palette: LAND,
  art: ["..s..", ".lmd.", "llmdd", "kkkkk"],
};

export const HILL: Sprite = {
  palette: LAND,
  art: ["..mmm..", ".mmmdd.", "mmmdddd", "kkkkkkk"],
};

/** A stepped pyramid: the largest holding on a territory. */
export const ZIGGURAT: Sprite = {
  palette: LAND,
  art: [
    "......G......",
    "......g......",
    ".....ggg.....",
    "....gGGgg....",
    "...ggGGggg...",
    "..gggGGgggg..",
    ".ggggGGggggg.",
    "gggggGGgggggg",
    "kkkkkkkkkkkkk",
  ],
};

/** A columned temple. */
export const TEMPLE: Sprite = {
  palette: LAND,
  art: [
    "...ggggg...",
    "..ggGGGgg..",
    ".ggggggggg.",
    "g.g.g.g.g.g",
    "g.g.g.g.g.g",
    "g.g.g.g.g.g",
    "ggggggggggg",
    "kkkkkkkkkkk",
  ],
};

/** A slim tower. */
export const TOWER: Sprite = {
  palette: LAND,
  art: [
    "..G..",
    ".ggg.",
    ".gGg.",
    ".ggg.",
    ".gGg.",
    ".ggg.",
    ".gGg.",
    "ggggg",
    "kkkkk",
  ],
};

export const OBELISK: Sprite = {
  palette: LAND,
  art: ["..G..", ".ggg.", ".ggg.", ".ggg.", ".ggg.", "ggggg", "kkkkk"],
};

/** A minor holding, scattered across the flanks of a territory. */
export const HOLDING: Sprite = {
  palette: LAND,
  art: ["..g..", ".ggg.", "ggggg", "kkkkk"],
};

const DROWNED: Palette = {
  d: "#2b4d68",
  s: "#3f6d8c",
  k: "#16324a",
};

/** Ruins, drawn only on ground that is already underwater. */
export const RUIN_SUNK: Sprite = {
  palette: DROWNED,
  art: [".d.d.", "dsds.", ".d.ds", "kkkkk"],
};

/** A standing circle, planted only where the chart has a genuine saddle. */
export const WARD_CIRCLE: Sprite = {
  palette: LAND,
  art: [
    "..g...g..",
    ".g.....g.",
    "g...G...g",
    "g..GGG..g",
    "g...G...g",
    ".g.....g.",
    "..g...g..",
  ],
};
