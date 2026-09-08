import type { Sprite } from "../arcane/figures";

/**
 * The people and creatures of the world, authored as art maps.
 *
 * The mage has two walking frames; the second is the first with the legs and
 * staff swapped, which is enough for a 12-pixel figure to read as walking. He
 * faces east; the scene flips him to face west, so one map serves both.
 */

const MAGE: Record<string, string> = {
  h: "#3b5f9c", // hat
  H: "#2b4778",
  f: "#e8c9a8", // face
  w: "#e9e6da", // beard
  r: "#2f4f86", // robe
  R: "#1a2c52",
  g: "#c9a866", // trim
  s: "#6d5729", // staff
  c: "#8ef0f7", // crystal
  k: "#0a1330",
};

export const MAGE_WALK: Sprite[] = [
  {
    palette: MAGE,
    art: [
      ".....hh.....",
      "....hHHh....",
      "...hHHHHh...",
      "..hHHcHHHh..",
      ".HHHHHHHHHH.",
      "....ffff....",
      "....fkfk....",
      "....wwww....",
      "...wwwwww...",
      "..grrrrrrg.s",
      ".rrrRrrRrr.s",
      ".rrrrrrrrr.s",
      ".rrrRrrRrr.s",
      ".RRrrrrrrR.s",
      "..RR..RR...s",
      "..kk..kk....",
    ],
  },
  {
    palette: MAGE,
    art: [
      ".....hh.....",
      "....hHHh....",
      "...hHHHHh...",
      "..hHHcHHHh..",
      ".HHHHHHHHHH.",
      "....ffff....",
      "....fkfk....",
      "....wwww....",
      "...wwwwww...",
      "..grrrrrrg.s",
      ".rrrRrrRrr.s",
      ".rrrrrrrrr.s",
      ".rrrRrrRrrs.",
      ".RRrrrrrrRs.",
      ".RR....RR...",
      ".kk....kk...",
    ],
  },
];

/** A scout: three pixels of cloak, so two hundred of them stay cheap. */
export const SCOUT: Sprite = {
  palette: { c: "#8ef0f7", d: "#2b7f8e" },
  art: [".c.", "ccc", "d.d"],
};

/** A drowned scout, which is the only mark that stays behind. */
export const SCOUT_LOST: Sprite = {
  palette: { r: "#ff8a5a" },
  art: ["r.r", ".r.", "r.r"],
};

const SERPENT: Record<string, string> = {
  s: "#2f8f9c",
  S: "#5cc7d4",
  d: "#1d5c68",
  e: "#ffd27a",
  t: "#cfeef2",
  k: "#0c2530",
};

/** The guardian of the drowned ground: rises where a crash liquidates you. */
export const SERPENT_COILS: Sprite = {
  palette: SERPENT,
  art: [
    "..........SSS.........",
    ".........SsssS........",
    "........Sss.eS........",
    "........Ssssss.tt.....",
    ".........dssd.........",
    "..........ss..........",
    "...SSSS...ss...SSSS...",
    "..SssssS..ss..SssssS..",
    ".Sss..ssSsssSSss..ssS.",
    ".ss....sssssssss....ss",
    "kkk....kkkkkkkkk....kk",
  ],
};

const DRAKE: Record<string, string> = {
  b: "#8a4a2c",
  B: "#c96b3f",
  w: "#5e3320",
  e: "#ffd27a",
  h: "#e8b45a",
  k: "#1a120c",
};

/** The guardian of the high ground: stirs where a pump liquidates you. */
export const DRAKE_ROOST: Sprite = {
  palette: DRAKE,
  art: [
    "....ww......ww....",
    "...wwww....wwww...",
    "..wwwBBB..BBBwww..",
    ".wwwBBBBBBBBBBwww.",
    "....BBbbBBbbBB....",
    ".....BbeBBebB.....",
    ".....BbbbbbbB.....",
    "......hhhhhh......",
    ".....BBbbbbBB.....",
    "....BB.bbbb.BB....",
    "...kk..kkkk..kk...",
  ],
};
