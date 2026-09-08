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
  H: "#2b4778", // hat shadow
  b: "#c9a866", // hat band
  f: "#e8c9a8", // face
  F: "#d3a985", // face shadow
  k: "#0a1330", // eyes / outline
  w: "#e9e6da", // beard
  W: "#c9c5b6", // beard shadow
  r: "#2f4f86", // robe
  R: "#1a2c52", // robe shadow
  g: "#c9a866", // trim
  c: "#3d5c8a", // cloak
  C: "#243a60", // cloak shadow
  s: "#6d5729", // staff
  o: "#8ef0f7", // crystal
  O: "#d8fbff", // crystal core
};

/**
 * The Data-Seeker, who walks the chart.
 *
 * Eighteen by twenty-eight, so the hat has a brim and a band, the beard has a
 * shadow, and the staff has a crystal that reads as lit. Two frames: the second
 * swaps the legs and lifts the staff, which is all a figure this size needs to
 * be seen walking. He faces east; the scene flips him to face west.
 */
export const MAGE_WALK: Sprite[] = [
  {
    palette: MAGE,
    art: [
      ".......hhhh.......",
      "......hHHHHh......",
      ".....hHHHHHHh.....",
      "....hHHHHHHHHh....",
      "...hHHHHoHHHHHh...",
      "..hHHHHHOHHHHHHh..",
      ".hHHHHHHHHHHHHHHh.",
      ".bbbbbbbbbbbbbbbb.",
      "......ffffff......",
      ".....ffkffkff.....",
      ".....ffffffff.....",
      "......fFFFFf......",
      ".....wwwwwwww.....",
      "....wwwwwwwwww....",
      "....wWwwwwwwWw....",
      ".....wwwwwwww.....",
      "......wwwwww......",
      "..cggrrrrrrrrggc.s",
      ".cCrrrRrrrrRrrrCcs",
      ".ccrrrrrrrrrrrrccs",
      ".ccrrrRrrrrRrrrccs",
      ".CcrrrrrrgrrrrrcCs",
      "..CrrrRrrgrrRrrC.s",
      "...RRrrrrgrrrrRR.s",
      "...RRrrrrgrrrrRR.s",
      "....RR......RR...s",
      "....kk......kk...s",
      "..................",
    ],
  },
  {
    palette: MAGE,
    art: [
      ".......hhhh.......",
      "......hHHHHh......",
      ".....hHHHHHHh.....",
      "....hHHHHHHHHh....",
      "...hHHHHoHHHHHh...",
      "..hHHHHHOHHHHHHh..",
      ".hHHHHHHHHHHHHHHh.",
      ".bbbbbbbbbbbbbbbb.",
      "......ffffff......",
      ".....ffkffkff.....",
      ".....ffffffff.....",
      "......fFFFFf......",
      ".....wwwwwwww.....",
      "....wwwwwwwwww....",
      "....wWwwwwwwWw....",
      ".....wwwwwwww.....",
      "......wwwwww......",
      "..cggrrrrrrrrggcs.",
      ".cCrrrRrrrrRrrrCs.",
      ".ccrrrrrrrrrrrrcs.",
      ".ccrrrRrrrrRrrrcs.",
      ".CcrrrrrrgrrrrrCs.",
      "..CrrrRrrgrrRrrCs.",
      "...RRrrrrgrrrrRRs.",
      "...RRrrrrgrrrrRR..",
      "...RR........RR...",
      "...kk........kk...",
      "..................",
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
