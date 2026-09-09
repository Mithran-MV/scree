/**
 * Bake the sheets the scenes preload.
 *
 *   npm run bake:sprites
 *
 * Nothing here is hand-drawn at runtime. The surveyor's walk cycle and the
 * sea monsters' swim/dive/surface frames are derived from single CC0 frames
 * in Kenney's Tiny Dungeon; everything else — clutter, peaks, particle motes,
 * the interface's nine-slice panels and the top bar — is drawn from
 * the project's palette. Output goes to public/assets/scree/.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./lib/png";
import { CLEAR, Pix, hash, hex, mix, rgb, same, scale, sheet, type RGBA } from "./lib/pix";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/assets/scree");
mkdirSync(OUT, { recursive: true });

const town = Pix.from(decodePng(readFileSync(join(ROOT, "public/assets/kenney/tiny-town/tilemap_packed.png"))));
const dungeon = Pix.from(decodePng(readFileSync(join(ROOT, "public/assets/kenney/tiny-dungeon/tilemap_packed.png"))));
const frame16 = (src: Pix, index: number) => src.crop((index % 12) * 16, Math.floor(index / 12) * 16, 16, 16);

const save = (name: string, p: Pix) => {
  writeFileSync(join(OUT, name), encodePng(p.toImage()));
  console.log(`  ${name.padEnd(16)} ${p.width}×${p.height}`);
};

/* ── palette ─────────────────────────────────────────────────────────── */

const P = {
  outline: rgb(38, 40, 46),
  rock: rgb(122, 126, 134),
  rockLight: rgb(170, 174, 182),
  rockDark: rgb(78, 82, 92),
  snow: rgb(238, 242, 246),
  snowShade: rgb(196, 208, 222),
  ley: rgb(53, 224, 232),
  leyBright: rgb(190, 250, 255),
  leyDim: rgb(29, 125, 140),
  leyDeep: rgb(10, 58, 70),
  wood: rgb(112, 80, 50),
  woodLight: rgb(156, 116, 74),
  woodDark: rgb(70, 48, 30),
  bush: rgb(34, 74, 44),
  bushLight: rgb(56, 108, 62),
  bushDark: rgb(16, 40, 24),
  shadow: rgb(0, 0, 0, 80),
  foam: rgb(214, 240, 244, 230),
  vellum: hex(0xe4d5ad),
  vellumLit: hex(0xf2e6c6),
  vellumShade: hex(0xc9b68a),
  vellumInk: hex(0x2b2418),
  brass: hex(0xb08d4a),
  shellDark: hex(0x141c22),
  shell: hex(0x1e2a33),
  shellLit: hex(0x2c3d49),
  bevel: hex(0x3d5461),
  shellEdge: hex(0x0b1116),
};

/* ── the surveyor ────────────────────────────────────────────────────── */

/**
 * Tiny Dungeon's wizard is one 16×16 frame. The walk cycle is derived: the
 * body bobs, the hem sways, one hand lifts per stride. The back view
 * recolours the face into robe; the side views drop the far eye.
 */
function bakeSurveyor(): Pix {
  const base = frame16(dungeon, 84);
  const skin = base.get(5, 8);
  const eye = base.get(6, 8);
  const beard = base.get(7, 9);
  const beardShade = base.get(4, 8);
  const robe = base.get(4, 10);
  const robeLight = base.get(4, 5);
  const isFace = (c: RGBA) => same(c, skin) || same(c, eye) || same(c, beard) || same(c, beardShade);

  const front = base;
  const back = base.map((c, x, y) => {
    if (y >= 6 && x >= 4 && x <= 11 && isFace(c)) return x === 7 || x === 8 ? (y % 3 === 0 ? robeLight : robe) : robe;
    return c;
  });
  const right = base.map((c, x, y) => (y === 8 && (x === 6 || x === 7) && same(c, eye) ? skin : c));
  const blink = base.map((c, x, y) => (y === 8 && same(c, eye) ? (x === 6 || x === 10 ? beardShade : skin) : c));

  const pose = (view: Pix, k: number, flip = false): Pix => {
    const v = view.clone();
    if (k === 0) {
      v.moveBlock(2, 11, 2, 2, 0, -1, robe);
      for (let y = 13; y < 16; y++) v.moveBlock(0, y, 16, 1, 1, 0, CLEAR);
    } else if (k === 2) {
      v.moveBlock(12, 11, 2, 2, 0, -1, robe);
      for (let y = 13; y < 16; y++) v.moveBlock(0, y, 16, 1, -1, 0, CLEAR);
    }
    const f = new Pix(16, 18);
    f.blit(v, 0, k % 2 === 1 ? 1 : 2, { flipX: flip });
    return f;
  };
  const still = (view: Pix): Pix => {
    const f = new Pix(16, 18);
    f.blit(view, 0, 2);
    return f;
  };

  const frames: Pix[] = [
    still(front), still(front), still(blink), still(front),   // idle
    ...[0, 1, 2, 3].map((k) => pose(front, k)),               // walk_down
    ...[0, 1, 2, 3].map((k) => pose(back, k)),                // walk_up
    ...[0, 1, 2, 3].map((k) => pose(right, k, true)),         // walk_left
    ...[0, 1, 2, 3].map((k) => pose(right, k)),               // walk_right
  ];
  return sheet(frames, 4, 16, 18);
}

/* ── sea monsters ────────────────────────────────────────────────────── */

/**
 * Three leviathans from three Tiny Dungeon frames. Swim frames bob under a
 * moving waterline; dive frames sink the body below it behind a widening
 * ripple; surface frames are the dive in reverse.
 */
function bakeMonsters(): Pix {
  const sources = [123, 110, 111];
  const WATERLINE = 12;
  const frames: Pix[] = [];
  for (const index of sources) {
    const base = frame16(dungeon, index);
    const under = (p: Pix, k: number): Pix =>
      p.map((c, x, y) => {
        const line = WATERLINE + (((x + k * 2) >> 2) & 1);
        if (y > line) return CLEAR;
        if (y === line && c[3] > 0) return P.foam;
        return c;
      });
    for (let k = 0; k < 4; k++) frames.push(under(base.shifted(0, [0, -1, 0, 1][k]!), k));
    const dive = (k: number): Pix => {
      const sunk = base.shifted(0, [1, 4, 8, 12][k]!).map((c, _x, y) => (y >= WATERLINE ? CLEAR : c));
      const half = [3, 4, 5, 6][k]!;
      for (let x = 8 - half; x < 8 + half; x++) if ((x + k) % 2 === 0) sunk.put(x, WATERLINE, P.foam);
      return sunk;
    };
    for (let k = 0; k < 4; k++) frames.push(dive(k));
    for (let k = 3; k >= 0; k--) frames.push(dive(k));
  }
  return sheet(frames, 12, 16, 16);
}

/* ── clutter ─────────────────────────────────────────────────────────── */

function ellipse(p: Pix, cx: number, cy: number, rx: number, ry: number, fill: RGBA, light: RGBA, dark: RGBA, outline: RGBA): void {
  const inside = (x: number, y: number) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 < 1;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const t = (x + 0.5 - cx) / rx + (y + 0.5 - cy) / ry;
      p.put(x, y, edge ? outline : t < -0.55 ? light : t > 0.6 ? dark : fill);
    }
  }
}

function rock(size: number, seed: number, snowy = false): Pix {
  const p = new Pix(16, 16);
  const rx = 3 + size * 1.5;
  const ry = 2.2 + size;
  const cx = 8 + Math.floor(hash(seed, 1, 3) * 3) - 1;
  const cy = 11 - size * 0.5;
  for (let x = 2; x < 14; x++) if (hash(x, seed, 4) > 0.3) p.put(x, Math.round(cy + ry), P.shadow);
  ellipse(p, cx, cy, rx, ry, P.rock, P.rockLight, P.rockDark, P.outline);
  if (snowy) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (p.get(x, y)[3] > 0 && y < cy - 0.5 && !same(p.get(x, y), P.outline)) p.set(x, y, x + 0.5 < cx ? P.snow : P.snowShade);
  }
  if (size > 0) p.put(cx - 1, Math.round(cy), P.rockDark);
  return p;
}

function crystal(seed: number, bright = false): Pix {
  const p = new Pix(16, 16);
  const shards = [
    { cx: 8, base: 13, half: 2.5, h: 10 },
    { cx: 4 + Math.floor(hash(seed, 2, 5) * 2), base: 13, half: 1.5, h: 6 },
    { cx: 12 - Math.floor(hash(seed, 3, 5) * 2), base: 13, half: 1.6, h: 7 },
  ];
  for (let x = 1; x < 15; x++) if (hash(x, seed, 6) > 0.35) p.put(x, 14, P.shadow);
  for (let x = 4; x < 12; x++) p.put(x, 13, hash(x, seed, 7) > 0.5 ? P.rockDark : P.outline);
  for (const s of shards) {
    for (let y = s.base - s.h; y <= s.base; y++) {
      const t = (s.base - y) / s.h;
      const w = s.half * (1 - t) + 0.4;
      for (let x = Math.floor(s.cx - w); x <= Math.ceil(s.cx + w - 1); x++) {
        const edge = x <= Math.floor(s.cx - w) || x >= Math.ceil(s.cx + w - 1) || y === s.base - s.h;
        const face = x + 0.5 < s.cx ? (bright ? P.leyBright : mix(P.ley, P.leyBright, 0.5)) : bright ? P.ley : P.leyDim;
        p.put(x, y, edge ? P.leyDeep : face);
      }
    }
    p.put(Math.floor(s.cx) - 1, s.base - s.h + 2, P.leyBright);
  }
  return p;
}

function driftwood(seed: number, mossy = false): Pix {
  const p = new Pix(16, 16);
  const y0 = 9 + Math.floor(hash(seed, 1, 8) * 2);
  const x0 = 2 + Math.floor(hash(seed, 2, 8) * 2);
  const len = 9 + Math.floor(hash(seed, 3, 8) * 3);
  for (let x = x0; x < x0 + len; x++) p.put(x, y0 + 3, P.shadow);
  p.fill(x0, y0, len, 3, P.wood);
  p.fill(x0, y0, len, 1, P.woodLight);
  p.rectOutline(x0 - 1, y0 - 1, len + 2, 5, P.woodDark);
  p.put(x0, y0 + 1, P.woodLight);
  p.put(x0 + len - 1, y0 + 1, P.woodDark);
  for (let x = x0 + 2; x < x0 + len - 2; x += 3) p.put(x, y0 + 2, P.woodDark);
  if (mossy) for (let x = x0 + 1; x < x0 + len - 1; x++) if (hash(x, seed, 9) > 0.6) p.put(x, y0, P.bushLight);
  // A stub of branch.
  p.put(x0 + len - 3, y0 - 2, P.woodDark);
  p.put(x0 + len - 2, y0 - 2, P.wood);
  return p;
}

function ruinBlock(seed: number): Pix {
  const p = new Pix(16, 16);
  const w = 8 + Math.floor(hash(seed, 1, 10) * 3);
  const h = 5 + Math.floor(hash(seed, 2, 10) * 2);
  const x0 = Math.floor((16 - w) / 2);
  const y0 = 14 - h;
  for (let x = x0; x < x0 + w + 1; x++) p.put(x, y0 + h, P.shadow);
  p.fill(x0, y0, w, h, P.rock);
  p.fill(x0, y0, w, 1, P.rockLight);
  p.fill(x0, y0 + h - 1, w, 1, P.rockDark);
  p.rectOutline(x0 - 1, y0 - 1, w + 2, h + 2, P.outline);
  // A crack, and a broken corner.
  for (let i = 0; i < h - 1; i++) p.put(x0 + 2 + Math.floor(i / 2) + Math.floor(hash(i, seed, 11) * 2), y0 + i, P.rockDark);
  p.set(x0 + w - 1, y0 - 1, CLEAR);
  p.set(x0 + w, y0 - 1, CLEAR);
  p.set(x0 + w, y0, CLEAR);
  p.put(x0 + w - 1, y0, P.outline);
  return p;
}

function bush(seed: number): Pix {
  const p = new Pix(16, 16);
  for (let x = 3; x < 13; x++) p.put(x, 14, P.shadow);
  ellipse(p, 8, 10, 5.5, 3.6, P.bush, P.bushLight, P.bushDark, P.bushDark);
  ellipse(p, 6 + Math.floor(hash(seed, 1, 12) * 2), 7.5, 3.4, 2.6, P.bush, P.bushLight, P.bushDark, P.bushDark);
  ellipse(p, 10, 8, 3, 2.4, P.bush, P.bushLight, P.bushDark, P.bushDark);
  for (let i = 0; i < 4; i++) p.put(4 + Math.floor(hash(i, seed, 13) * 8), 6 + Math.floor(hash(i, seed, 14) * 6), P.bushLight);
  return p;
}

function bakeClutter(): Pix {
  return sheet(
    [
      rock(0, 1), rock(1, 2), rock(2, 3),                 // 0-2 rocks
      crystal(1), crystal(2), crystal(3, true),           // 3-5 aether crystals
      driftwood(1), driftwood(2),                         // 6-7 driftwood
      ruinBlock(1), ruinBlock(2),                         // 8-9 ruined blocks
      rock(1, 4, true), rock(2, 5, true),                 // 10-11 snow rocks
      bush(1), bush(2),                                   // 12-13 dark bushes
      driftwood(3, true),                                 // 14 mossy log
    ],
    16,
    16,
    16,
  );
}

/* ── peaks ───────────────────────────────────────────────────────────── */

/** A 16×24 mountain: two faces, a ridge, a snow cap on the high variants. */
function peak(seed: number, snowy: boolean): Pix {
  const p = new Pix(16, 24);
  const apexX = 6 + Math.floor(hash(seed, 1, 20) * 5);
  const apexY = 2 + Math.floor(hash(seed, 2, 20) * 2);
  const baseY = 22;
  const inside = (x: number, y: number) => {
    if (y < apexY || y > baseY) return false;
    const t = (y - apexY) / (baseY - apexY);
    const halfL = 1 + (apexX - 0) * t;
    const halfR = 1 + (15 - apexX) * t;
    const jag = hash(y, seed, 21) > 0.7 ? 1 : 0;
    return x + 0.5 >= apexX - halfL + jag && x + 0.5 <= apexX + halfR - jag;
  };
  for (let x = 1; x < 15; x++) p.put(x, 23, P.shadow);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 16; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1);
      const left = x + 0.5 < apexX + (y - apexY) * 0.15;
      const snowCap = snowy && y < apexY + 6 + Math.floor(hash(x, seed, 22) * 2);
      let c: RGBA = left ? P.rockLight : P.rock;
      if (!left && x > apexX + (y - apexY) * 0.7) c = P.rockDark;
      if (snowCap) c = left ? P.snow : P.snowShade;
      if (edge) c = snowCap ? mix(P.snowShade, P.outline, 0.35) : P.outline;
      if (!edge && hash(x, y + seed, 23) > 0.93) c = mix(c, P.outline, 0.4);
      p.put(x, y, c);
    }
  }
  // The ridge line down the lit face.
  for (let y = apexY + 1; y < baseY - 2; y += 2) p.put(apexX + Math.floor((y - apexY) * 0.15), y, snowy && y < apexY + 6 ? P.snowShade : P.rockDark);
  return p;
}

function bakePeaks(): Pix {
  return sheet([peak(1, false), peak(2, false), peak(3, false), peak(4, true), peak(5, true), peak(6, true)], 6, 16, 24);
}

/* ── particles and landmark parts ────────────────────────────────────── */

function circle(p: Pix, cx: number, cy: number, r: number, c: RGBA): void {
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 < r * r) p.put(x, y, c);
}

function bakeFx(): Pix {
  const bubble = new Pix(16, 16);
  circle(bubble, 8, 8, 2.6, rgb(200, 240, 250, 200));
  circle(bubble, 8, 8, 1.6, rgb(150, 215, 232, 120));
  bubble.put(6, 6, rgb(255, 255, 255, 240));

  const droplet = new Pix(16, 16);
  droplet.fill(7, 6, 2, 3, rgb(226, 246, 250, 235));
  droplet.put(7, 6, rgb(255, 255, 255, 255));

  const spark = new Pix(16, 16);
  spark.fill(7, 6, 2, 4, P.leyBright);
  spark.fill(6, 7, 4, 2, P.leyBright);
  spark.put(7, 7, rgb(255, 255, 255, 255));

  const smoke = new Pix(16, 16);
  circle(smoke, 8, 8, 3.4, rgb(150, 152, 162, 150));
  circle(smoke, 7, 7, 1.8, rgb(190, 192, 200, 120));

  const cog = new Pix(16, 16);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    cog.fill(Math.round(8 + Math.cos(a) * 5.5) - 1, Math.round(8 + Math.sin(a) * 5.5) - 1, 2, 2, P.brass);
  }
  circle(cog, 8, 8, 4.6, P.brass);
  circle(cog, 8, 8, 3.6, mix(P.brass, P.shellDark, 0.35));
  circle(cog, 8, 8, 1.4, P.shellDark);
  cog.put(6, 5, mix(P.brass, P.vellumLit, 0.5));

  const orb = new Pix(16, 16);
  circle(orb, 8, 8, 4.2, rgb(53, 224, 232, 90));
  circle(orb, 8, 8, 3.2, P.ley);
  circle(orb, 8, 8, 2.2, P.leyBright);
  orb.put(7, 6, rgb(255, 255, 255, 255));

  const glow = new Pix(16, 16);
  circle(glow, 8, 8, 7.5, rgb(53, 224, 232, 40));
  circle(glow, 8, 8, 5, rgb(53, 224, 232, 70));
  circle(glow, 8, 8, 2.5, rgb(190, 250, 255, 120));

  const window = new Pix(16, 16);
  window.fill(6, 5, 4, 6, rgb(255, 214, 120, 235));
  window.fill(7, 6, 2, 2, rgb(255, 244, 200, 255));

  return sheet([bubble, droplet, spark, smoke, cog, orb, glow, window], 8, 16, 16);
}

/* ── the interface ───────────────────────────────────────────────────── */

/** Parchment nine-slice, 48×48, sliced at 12. */
function bakePanel(): Pix {
  const p = new Pix(48, 48);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) p.set(x, y, hash(x, y, 40) > 0.92 ? P.vellumShade : hash(x, y, 41) > 0.94 ? P.vellumLit : P.vellum);
  p.rectOutline(0, 0, 48, 48, P.vellumInk);
  p.rectOutline(1, 1, 46, 46, P.brass);
  p.rectOutline(2, 2, 44, 44, P.vellumLit);
  // Shadow inside the bottom and right edge, so the stock reads as raised.
  for (let i = 3; i < 45; i++) {
    p.put(i, 45, P.vellumShade);
    p.put(45, i, P.vellumShade);
  }
  for (const [cx, cy] of [[3, 3], [41, 3], [3, 41], [41, 41]] as const) {
    p.fill(cx, cy, 4, 4, P.brass);
    p.fill(cx + 1, cy + 1, 2, 2, P.vellumInk);
  }
  return p;
}

/** Dark console nine-slice, 48×48, sliced at 12. */
function bakeConsole(): Pix {
  const p = new Pix(48, 48);
  p.fill(0, 0, 48, 48, P.shell);
  p.rectOutline(0, 0, 48, 48, P.shellEdge);
  for (let i = 1; i < 47; i++) {
    p.put(i, 1, P.bevel);
    p.put(1, i, P.bevel);
    p.put(i, 46, P.shellEdge);
    p.put(46, i, P.shellEdge);
  }
  p.rectOutline(2, 2, 44, 44, P.shellLit);
  for (const [cx, cy] of [[4, 4], [42, 4], [4, 42], [42, 42]] as const) {
    p.fill(cx, cy, 2, 2, P.bevel);
    p.put(cx, cy, P.shellEdge);
  }
  return p;
}

/** A grey button to be tinted by its tone, 32×32, sliced at 8. */
function bakeButton(): Pix {
  const p = new Pix(32, 32);
  p.fill(0, 0, 32, 32, rgb(150, 150, 150));
  p.fill(1, 1, 30, 2, rgb(205, 205, 205));
  p.fill(1, 29, 30, 2, rgb(105, 105, 105));
  p.fill(1, 1, 2, 30, rgb(185, 185, 185));
  p.fill(29, 1, 2, 30, rgb(115, 115, 115));
  p.rectOutline(0, 0, 32, 32, rgb(22, 22, 22));
  return p;
}

/** The top bar's ground: dark ashlar with brass rivets and a ley trim, tileable in x. */
function bakeTopbar(): Pix {
  const W = 64;
  const H = 44;
  const p = new Pix(W, H);
  p.fill(0, 0, W, H, P.shellDark);
  for (let y = 4; y < 38; y++) {
    for (let x = 0; x < W; x++) {
      const row = Math.floor((y - 4) / 11);
      const seamY = (y - 4) % 11 === 10;
      const seamX = ((x + (row % 2) * 16) % 32) === 31;
      const grain = hash(x, y, 50);
      let c: RGBA = grain > 0.9 ? P.shell : grain < 0.06 ? mix(P.shellDark, P.shellEdge, 0.6) : mix(P.shellDark, P.shell, 0.45);
      if (seamY || seamX) c = P.shellEdge;
      if ((y - 4) % 11 === 0 && !seamX) c = mix(c, P.shellLit, 0.35);
      p.set(x, y, c);
    }
  }
  p.fill(0, 0, W, 1, P.bevel);
  p.fill(0, 1, W, 1, P.shellLit);
  p.fill(0, 2, W, 2, P.shell);
  for (const x of [6, 38]) {
    p.fill(x, 8, 2, 2, P.brass);
    p.fill(x, 30, 2, 2, P.brass);
    p.put(x, 8, mix(P.brass, P.vellumLit, 0.5));
    p.put(x, 30, mix(P.brass, P.vellumLit, 0.5));
  }
  p.fill(0, 38, W, 1, P.shellLit);
  p.fill(0, 39, W, 1, P.leyDim);
  p.fill(0, 40, W, 1, hex(0x35e0e8));
  p.fill(0, 41, W, 3, P.shellEdge);
  return p;
}

/* ── run ─────────────────────────────────────────────────────────────── */

console.log("baking sheets → public/assets/scree/");
save("surveyor.png", bakeSurveyor());
save("monsters.png", bakeMonsters());
save("clutter.png", bakeClutter());
save("peaks.png", bakePeaks());
save("fx.png", bakeFx());
save("ui-panel.png", bakePanel());
save("ui-console.png", bakeConsole());
save("ui-button.png", bakeButton());
save("ui-topbar.png", bakeTopbar());
void scale;
