/**
 * The chamber's pixel art, authored as maps.
 *
 * One character per pixel, keyed to a small palette; a dot is transparent.
 * Writing the art this way keeps it editable in the source and guarantees every
 * mark lands on the grid, which is the whole discipline of the style — and it
 * is a form a hand can actually author well, where a half-rendered painting
 * would only ever read as a placeholder.
 */

export type Palette = Record<string, string>;
export interface Sprite {
  art: string[];
  palette: Palette;
}

const SEEKER: Palette = {
  h: "#2b4778", // hat, shadowed
  H: "#3b5f9c", // hat, lit
  b: "#1a2b4d", // brim
  f: "#e8c9a8", // face
  F: "#d3a985", // face shadow
  w: "#e9e6da", // beard and brow
  W: "#c9c5b6", // beard shadow
  r: "#2f4f86", // robe
  R: "#1a2c52", // robe shadow
  g: "#c9a866", // gold trim
  s: "#6d5729", // staff
  c: "#8ce8f6", // crystal
  C: "#d9f7ff", // crystal core
  k: "#0a1330", // ink
};

/** The Data-Seeker: the one who reads the chart. */
export const DATA_SEEKER: Sprite = {
  palette: SEEKER,
  art: [
    "..........hh..........",
    ".........hHHh.........",
    "........hHHHHh........",
    ".......hHHHHHHh.......",
    "......hHHHcHHHHh......",
    ".....hHHHHCHHHHHh.....",
    "....hHHHHHHHHHHHHh....",
    "...bbbbbbbbbbbbbbbb...",
    "....ffffffffffff......",
    "....fFffkffkffFf......",
    "....fFffffffffFf......",
    ".....fffkkkkfff.......",
    "......wwwwwwww........",
    ".....wWwwwwwwWw.......",
    "....wWwwwwwwwwWw......",
    ".....wwwwwwwwww.......",
    "......wwwwwwww........",
    "..ggggrrrrrrrrgggg....",
    ".grrrrrrrrrrrrrrrrg..s",
    ".rrrrRrrrrrrrrRrrrr.cs",
    "rrrrRRrrrrrrrrRRrrrrCs",
    "rrrrRrrrrggrrrrRrrrrcs",
    "rrrRRrrrrggrrrrrRRrr.s",
    "rrrRrrrrrggrrrrrrRrr.s",
    "rrRRrrrrrggrrrrrrRRr.s",
    "rrRrrrrrrggrrrrrrrRr.s",
    "rRRrrrrrrggrrrrrrrRR.s",
    "rRrrrrrrrggrrrrrrrrR.s",
    "RRrrrrrrrggrrrrrrrrRR.",
    "RRRRRRRRRRRRRRRRRRRRR.",
    "kkkkkkkkkkkkkkkkkkkkk.",
    "......................",
  ],
};

const ENGINE: Palette = {
  p: "#8a6f3c", // plate
  P: "#c9a866", // plate lit
  d: "#4e3d1e", // plate shadow
  k: "#0a1330", // void
  c: "#57d6e8", // aether
  C: "#d9f7ff", // aether core
  r: "#e2603a", // warning lamp
  g: "#2b7f8e", // dim aether
  s: "#3a2f18", // strut
};

/** The Risk-Engineer: the one who executes what the chart decides. */
export const RISK_ENGINEER: Sprite = {
  palette: ENGINE,
  art: [
    ".........rr...........",
    ".........ss...........",
    ".........ss...........",
    "....PPPPPPPPPPPP......",
    "...PppppppppppppP.....",
    "...PpkkkkkkkkkkpP.....",
    "...Ppkccckkkgggkp.....",
    "...PpkcCckkkgggkp.....",
    "...Ppkccckkkgggkp.....",
    "...Ppkkkkkkkkkkkp.....",
    "...Pppddddddddppp.....",
    "...Pppddddddddppp.....",
    "....PppppppppppP......",
    "......pp....pp........",
    ".....sppssssppps......",
    "...ssssssssssssss.....",
    "..sPPPssssssssPPPs....",
    "..sPppsccccccsppPs....",
    "..sPppsCCCCCCsppPs....",
    "..sPppsccccccsppPs....",
    "..sPppssssssssppPs....",
    "..sPppppppppppppPs....",
    "..sPpdddddddddddPs....",
    "..sPpdppppppppdpPs....",
    "...sPddddddddddPs.....",
    "....sssssssssss.......",
    "....sPPs....sPPs......",
    "....sppd....dpps......",
    "....sppd....dpps......",
    "....dddd....dddd......",
    "......................",
    "......................",
  ],
};

/* ── the objects on the desk ─────────────────────────────────────────── */

const DESK: Palette = {
  a: "#7a3b2c", // red binding
  b: "#3d5f7a", // blue binding
  c: "#6b5a2f", // olive binding
  p: "#e6dcc0", // paper
  P: "#c9bfa2", // paper shadow
  g: "#c9a866", // brass
  G: "#e7c98a", // brass lit
  d: "#4e3d1e", // brass shadow
  k: "#241c0c", // ink
  w: "#f2ede0", // quill
  i: "#1b2b4a", // inkwell glass
  r: "#8c2f22", // wax
};

export const BOOKS: Sprite = {
  palette: DESK,
  art: [
    "..............",
    "..aaaaaaaaaa..",
    "..akkkkkkkka..",
    "..aaaaaaaaaa..",
    ".bbbbbbbbbbbb.",
    ".bkkkkkkkkkkb.",
    ".bbbbbbbbbbbb.",
    "cccccccccccccc",
    "ckkkkkkkkkkkkc",
    "cccccccccccccc",
    "..............",
  ],
};

export const KEYS: Sprite = {
  palette: DESK,
  art: [
    "..gg......",
    ".g..g.....",
    ".g..g.....",
    "..gg......",
    "...gggggg.",
    "......g.g.",
    "..........",
    "..GG......",
    ".G..G.....",
    "..GG.GGGG.",
    ".......G.G",
  ],
};

export const QUILL: Sprite = {
  palette: DESK,
  art: [
    "......ww",
    ".....www",
    "....www.",
    "...www..",
    "..www...",
    ".www....",
    "kww.....",
    "kk......",
    ".iiii...",
    ".iiii...",
    ".dddd...",
  ],
};

export const SEAL: Sprite = {
  palette: DESK,
  art: [
    "..rrrr..",
    ".rrrrrr.",
    "rrrkkrrr",
    "rrkrrkrr",
    "rrkrrkrr",
    "rrrkkrrr",
    ".rrrrrr.",
    "..rrrr..",
  ],
};

export const SCROLL: Sprite = {
  palette: DESK,
  art: [
    "................",
    ".gpppppppppppg..",
    ".gpkkkkkkkkkpg..",
    ".gppppppppppPg..",
    ".gpkkkkkkkkkpg..",
    ".gppppppppppPg..",
    ".gpkkkkkkkkkpg..",
    ".gpppppppppppg..",
    "................",
  ],
};
