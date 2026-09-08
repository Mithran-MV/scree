/**
 * Pixel sprites, authored as art maps.
 *
 * Each sprite is a list of equal-length strings, one character per pixel, keyed
 * to a small palette. Writing them this way keeps the art readable and editable
 * in the source, and guarantees every mark lands on the pixel grid — which is
 * the whole discipline of the style. A dot is transparent.
 */

export type Palette = Record<string, string>;

type Ctx = CanvasRenderingContext2D;

export function blit(ctx: Ctx, art: string[], palette: Palette, x: number, y: number): void {
  for (let row = 0; row < art.length; row++) {
    const line = art[row]!;
    for (let col = 0; col < line.length; col++) {
      const key = line[col]!;
      if (key === ".") continue;
      const color = palette[key];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col, y + row, 1, 1);
    }
  }
}

export function spriteSize(art: string[]): { w: number; h: number } {
  return { w: art[0]?.length ?? 0, h: art.length };
}

/* ── the holdfasts ───────────────────────────────────────────────────── */

const STONE: Palette = {
  d: "#4a4238",
  s: "#7d7365",
  l: "#a89c89",
  h: "#c9bfa9",
  w: "#2b2620",
  r: "#8c3f2a",
  t: "#6a2f1f",
  g: "#c8b26a",
  i: "#6f6455",
  c: "#8f8574",
};

/** A walled keep with a gatehouse and a courtyard. */
export const KEEP = [
  "...hh......hh...",
  "...ll......ll...",
  ".hhhhhhhhhhhhhh.",
  ".llssssssssssll.",
  ".lswwssssswwssl.",
  ".lsssssssssssslic",
  ".lsswwsssswwssl.",
  ".lssssssssssssl.",
  ".lswwssgggsswsl.",
  ".dsssssgggssssd.",
  ".dsssssgggssssd.",
  "..dddddgggdddd..",
  "..ss.......ss...",
  ".sddssssssssdds.",
  ".sssssssssssssss",
  "..d..d..d..d..d.",
];

/** A longhouse with a steep roof, a byre and a stack. */
export const HALL = [
  "......rr........",
  ".....rrrr.......",
  "....rrrrrr......",
  "...rrrrrrrr.....",
  "..rrrrrrrrrr..w.",
  ".rrrrrrrrrrrr.w.",
  "tttttttttttttt..",
  ".lssssssssssl...",
  ".lswwsssswwsl...",
  ".lssssssssssl.gg",
  ".lsswwssssssl.gg",
  ".dsgggssssssd...",
  ".dsgggsssssdd...",
  "..dddddddddd....",
  "..sss....sss....",
  "...d......d.....",
];

/** A slim watchtower on a rocky footing. */
export const SPIRE = [
  ".....hh.....",
  "....hllh....",
  "...hlsslh...",
  "...lssssl...",
  "...lswwsl...",
  "...lssssl...",
  "...lssssl...",
  "...lswwsl...",
  "...lssssl...",
  "...lssssl...",
  "...lswwsl...",
  "...dssssd...",
  "..ddssssdd..",
  ".sddggggdds.",
  ".sssggggsss.",
  "..d..dd..d..",
];

export const HOLDFASTS = [KEEP, HALL, SPIRE];
export const HOLDFAST_PALETTE = STONE;

/* ── scatter ─────────────────────────────────────────────────────────── */

const FLORA: Palette = {
  t: "#2f4a2b",
  m: "#3f6136",
  l: "#547a41",
  b: "#4a3524",
  r: "#6e6455",
  s: "#8a8072",
  f: "#c7546a",
  y: "#d7bb56",
};

export const PINE = ["..t..", ".ttt.", ".mmm.", "mmmmm", "..b.."];
export const BROADLEAF = [".lll.", "lllll", "lmmml", "..b..", "..b.."];
export const BOULDER = ["..ss.", ".srrs", "srrrr", ".rrr."];
export const FLOWERS = [".f.y.", "fylyf", ".lll."];
export const REEDS = ["l.l.l", "lllll", "..b.."];

export const SCATTER_PALETTE = FLORA;

/* ── the surveyor ────────────────────────────────────────────────────── */

const FIGURE: Palette = {
  k: "#241f19",
  c: "#3b5a86",
  d: "#2a3f60",
  f: "#d8ab86",
  h: "#5a3d29",
  s: "#c9bfa9",
  a: "#a0411f",
};

/**
 * You. Two frames so the figure breathes rather than standing dead still —
 * the cheapest possible signal that the world is live.
 */
export const SURVEYOR = [
  [
    "..hhh..",
    ".hfffh.",
    ".ffkff.",
    "..fff..",
    ".ccccc.",
    "fcccccf",
    ".ccccc.",
    "..c.c..",
    "..d.d..",
    "..k.k..",
  ],
  [
    "..hhh..",
    ".hfffh.",
    ".ffkff.",
    "..fff..",
    ".ccccc.",
    "fcccccf",
    ".ccccc.",
    "..c.c..",
    "..d.d..",
    ".k...k.",
  ],
];

export const FIGURE_PALETTE = FIGURE;

/** The levelling staff, drawn to a measured height beside the figure. */
export function drawStaff(ctx: Ctx, x: number, footY: number, heightPx: number): void {
  const top = footY - heightPx;
  for (let y = top; y < footY; y++) {
    const band = Math.floor((footY - y) / 3) % 2 === 0;
    ctx.fillStyle = band ? "#efe9dc" : "#241f19";
    ctx.fillRect(x, y, 1, 1);
  }
  // One of the two accents rationed to the whole scene.
  ctx.fillStyle = FIGURE.a!;
  ctx.fillRect(x - 1, top - 2, 3, 2);
}

/* ── more of the country ─────────────────────────────────────────────── */

export const BUSH = [".mm..", "mlllm", "mlllm", ".mm.."];
export const STUMP = [".....", ".bbb.", "bmmmb", ".bbb."];
export const CAIRN = ["..s..", ".srs.", ".rrs.", "srrrs", ".sss."];

/** A jetty running out from the shore, for the settlements on the water. */
export const JETTY = ["bb", "bb", "bb", "bb", "bb"];

/** Standing stones, planted only where the map has a genuine saddle. */
export const MENHIR = [".s.", "srs", "srs", "srs", "sss"];

/* ── more of the forest, so it does not tile ─────────────────────────── */

export const PINE_TALL = ["..t..", "..t..", ".ttt.", ".mmm.", "mmmmm", "..b.."];
export const PINE_YOUNG = ["..t..", ".mmm.", "..b.."];
export const BIRCH = [".ll..", "llll.", ".lml.", "..s..", "..s.."];

/** Tilled ground, only ever laid beside a settlement. */
export const FIELD = ["yyyyyy", "ymymym", "yyyyyy", "ymymym"];

const FARM: Palette = { y: "#a88f52", m: "#8a7440" };
export const FIELD_PALETTE = FARM;

/**
 * A ruin, drawn only in the shallows.
 *
 * These stand where the ground is underwater now: the drowned basins are where
 * a wallet is liquidated, so the shallows are exactly the places somebody
 * already lost. Marking them costs nothing and says the thing the map is for.
 */
export const RUIN = [".d.d.", "dsds.", ".d.ds", "ds..d"];
export const RUIN_PALETTE: Palette = { d: "#5d6d70", s: "#78888a" };

/** A hull drawn up on the strand. */
export const BOAT = [".bbbb.", "bwwwwb", ".bbbb."];
export const BOAT_PALETTE: Palette = { b: "#5a4429", w: "#8b6f45" };
