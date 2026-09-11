/**
 * Bake the sheets the scenes preload.
 *
 *   npm run bake:sprites
 *
 * Nothing here is hand-drawn at runtime. The surveyor's walk cycle and the
 * sea monsters' swim/dive/surface frames are derived from single CC0 frames
 * in Kenney's Tiny Dungeon; the scouts, the clutter, peaks, particle motes,
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

type View = "front" | "back" | "side";

interface Pose {
  /** Whole-body rise, negative is up. */
  bob: number;
  /** Feet: for front and back views, down is forward; for the side view, right is forward. */
  leftFoot: number;
  rightFoot: number;
  /** Arm swing, -1..1: front/back views swing up and down, the side view swings fore and aft. */
  swing: number;
  /** Hem sway in pixels. */
  sway: number;
  /** Breathing: chest and head rise by this much. */
  breathe: number;
  blink: boolean;
  /** The staff lifted off the ground by this much. */
  staffLift: number;
  /** Dust where the staff just struck. */
  dust: boolean;
}

const REST: Pose = { bob: 0, leftFoot: 0, rightFoot: 0, swing: 0, sway: 0, breathe: 0, blink: false, staffLift: 0, dust: false };

const S = {
  hat: rgb(122, 60, 158),
  hatLight: rgb(178, 96, 210),
  hatDark: rgb(78, 34, 104),
  band: rgb(176, 141, 74),
  skin: rgb(226, 194, 132),
  skinShade: rgb(196, 156, 100),
  eye: rgb(28, 22, 40),
  beard: rgb(206, 208, 216),
  beardShade: rgb(150, 152, 168),
  robe: rgb(108, 54, 140),
  robeLight: rgb(146, 84, 178),
  robeDark: rgb(70, 32, 94),
  belt: rgb(176, 141, 74),
  buckle: rgb(60, 44, 20),
  boot: rgb(58, 40, 30),
  bootLight: rgb(92, 66, 48),
  staff: rgb(118, 84, 52),
  staffLight: rgb(160, 120, 78),
  outline: rgb(26, 20, 34),
  dust: rgb(200, 190, 170, 170),
};

function span(p: Pix, x0: number, x1: number, y: number, c: RGBA): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) p.put(x, y, c);
}

function disc(p: Pix, cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) p.put(x, y, c);
}

/** A one-pixel dark outline around everything opaque, the pixel-art silhouette. */
function outline(p: Pix, c: RGBA): void {
  const src = p.clone();
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      if (src.get(x, y)[3] > 0) continue;
      const near = src.get(x - 1, y)[3] > 0 || src.get(x + 1, y)[3] > 0 || src.get(x, y - 1)[3] > 0 || src.get(x, y + 1)[3] > 0;
      if (near) p.set(x, y, c);
    }
}

/**
 * The surveyor, 32×40, feet on the bottom row, drawn from a pose. One drawing
 * routine per view; the left walk is the right walk mirrored.
 */
function drawSurveyor(view: View, pose: Pose): Pix {
  const p = new Pix(32, 40);
  const b = pose.bob;
  const br = pose.breathe;
  const ground = 38;

  // ── feet and hem ──
  const hemY = ground - 2 + b;
  if (view === "side") {
    // Profile: boots step fore and aft.
    const back = 13 - pose.leftFoot;
    const fore = 17 + pose.rightFoot;
    p.fill(back, ground - 2, 4, 3, S.boot);
    p.fill(fore, ground - 2, 5, 3, S.boot);
    p.fill(fore, ground - 2, 5, 1, S.bootLight);
  } else {
    const lx = 11 + (view === "back" ? 1 : 0);
    const rx = 17 + (view === "back" ? 1 : 0);
    p.fill(lx, ground - 2 + Math.max(0, pose.leftFoot), 4, 3 - Math.max(0, pose.leftFoot), S.boot);
    p.fill(rx, ground - 2 + Math.max(0, pose.rightFoot), 4, 3 - Math.max(0, pose.rightFoot), S.boot);
    if (pose.leftFoot < 0) p.fill(lx, ground - 2, 4, 1, S.bootLight);
    if (pose.rightFoot < 0) p.fill(rx, ground - 2, 4, 1, S.bootLight);
  }

  // ── robe ──
  const shoulderY = 22 + b - br;
  const robeTop = shoulderY;
  for (let y = robeTop; y <= hemY; y++) {
    const t = (y - robeTop) / (hemY - robeTop);
    const half = view === "side" ? 5 + t * 2 : 6 + t * 3;
    const swayHere = Math.round(pose.sway * t);
    const cx = 16 + swayHere;
    span(p, Math.round(cx - half), Math.round(cx + half), y, S.robe);
    // The fold of light down the front, and shade at the hem.
    if (view === "front") span(p, cx - 1, cx + 1, y, S.robeLight);
    if (view === "back") p.put(cx, y, S.robeDark);
    if (y >= hemY - 1) span(p, Math.round(cx - half), Math.round(cx + half), y, S.robeDark);
  }
  // Belt.
  const beltY = robeTop + 7;
  const beltHalf = view === "side" ? 5 : 7;
  span(p, 16 - beltHalf, 16 + beltHalf, beltY, S.belt);
  span(p, 16 - beltHalf, 16 + beltHalf, beltY + 1, mix(S.belt, S.robeDark, 0.5));
  if (view === "front") p.fill(15, beltY, 2, 2, S.buckle);

  // ── arms ──
  const swingUp = Math.round(pose.swing * 2);
  if (view === "side") {
    // One arm, on the near side, swinging fore and aft; it carries the staff.
    const ax = 18 + Math.round(pose.swing * 3);
    p.fill(ax, shoulderY + 1, 3, 9, S.robeDark);
    p.fill(ax, shoulderY + 9, 3, 3, S.skin);
  } else {
    const leftHandY = shoulderY + 9 - swingUp;
    const rightHandY = shoulderY + 9 + swingUp;
    p.fill(7, shoulderY + 1, 3, leftHandY - shoulderY - 1, S.robeDark);
    p.fill(7, leftHandY, 3, 3, S.skin);
    p.fill(22, shoulderY + 1, 3, rightHandY - shoulderY - 1, S.robeDark);
    p.fill(22, rightHandY, 3, 3, S.skin);
  }

  // ── head ──
  const headY = 13 + b - br;
  if (view === "front" || view === "side") {
    const fx0 = view === "side" ? 13 : 11;
    const fx1 = view === "side" ? 21 : 21;
    for (let y = headY; y < headY + 9; y++) {
      const inset = y === headY || y === headY + 8 ? 1 : 0;
      span(p, fx0 + inset, fx1 - inset, y, S.skin);
    }
    p.put(fx1, headY + 4, S.skinShade);
    // Eyes and nose.
    if (view === "front") {
      if (pose.blink) {
        span(p, 13, 14, headY + 5, S.eye);
        span(p, 18, 19, headY + 5, S.eye);
      } else {
        p.fill(13, headY + 4, 2, 2, S.eye);
        p.fill(18, headY + 4, 2, 2, S.eye);
      }
      p.put(16, headY + 6, S.skinShade);
    } else {
      if (pose.blink) span(p, 19, 20, headY + 5, S.eye);
      else p.fill(19, headY + 4, 2, 2, S.eye);
      p.put(21, headY + 6, S.skinShade);
    }
    // Beard: a long one, strands drawn in the shade colour.
    const beardTop = headY + 7;
    const beardX0 = view === "side" ? 14 : 11;
    const beardX1 = view === "side" ? 21 : 21;
    for (let y = beardTop; y < beardTop + 12; y++) {
      const t = (y - beardTop) / 12;
      const shrink = Math.round(t * (view === "side" ? 3 : 4));
      span(p, beardX0 + shrink, beardX1 - shrink, y, S.beard);
      for (let x = beardX0 + shrink; x <= beardX1 - shrink; x += 3) if ((x + y) % 2 === 0) p.put(x, y, S.beardShade);
    }
    span(p, view === "side" ? 15 : 12, view === "side" ? 21 : 20, beardTop, S.beardShade); // moustache
  } else {
    // The back of the head: the hood, with its seam.
    for (let y = headY; y < headY + 10; y++) span(p, 11, 21, y, S.robe);
    for (let y = headY; y < headY + 10; y++) p.put(16, y, S.robeDark);
  }

  // ── hat ──
  const brimY = headY - 1;
  const tipX = view === "side" ? 7 : 19;
  const tipY = brimY - 11;
  for (let y = tipY; y <= brimY; y++) {
    const t = (y - tipY) / (brimY - tipY);
    const half = 0.5 + t * 6.5;
    const cx = tipX + (16 - tipX) * t;
    span(p, Math.round(cx - half), Math.round(cx + half), y, S.hat);
    span(p, Math.round(cx - half), Math.round(cx - half + Math.max(0, half * 0.6)), y, S.hatLight);
    p.put(Math.round(cx + half), y, S.hatDark);
  }
  // Brim.
  const brimHalf = view === "side" ? 8 : 10;
  span(p, 16 - brimHalf + 1, 16 + brimHalf - 1, brimY, S.hatDark);
  span(p, 16 - brimHalf, 16 + brimHalf, brimY + 1, S.hat);
  span(p, 16 - brimHalf + 1, 16 + brimHalf - 1, brimY + 2, S.hatDark);
  span(p, 16 - brimHalf + 2, 16 + brimHalf - 2, brimY - 1, S.band);

  // ── staff ──
  const staffX = view === "side" ? 27 : view === "back" ? 5 : 26;
  const lift = pose.staffLift;
  const staffTop = 3 - lift;
  const staffBottom = ground + 1 - lift;
  for (let y = staffTop; y <= staffBottom; y++) {
    p.put(staffX, y, S.staff);
    p.put(staffX + 1, y, mix(S.staff, S.outline, 0.4));
    if (y % 3 === 0) p.put(staffX, y, S.staffLight);
  }
  span(p, staffX - 2, staffX + 3, staffTop + 5, S.band);
  disc(p, staffX + 1, staffTop + 1.5, 2.6, 2.6, P.leyDeep);
  disc(p, staffX + 1, staffTop + 1.5, 1.7, 1.7, P.ley);
  p.put(staffX, staffTop, P.leyBright);

  outline(p, S.outline);

  if (pose.dust) {
    for (const [dx, dy] of [[-2, 0], [3, 0], [-3, -1], [4, -1], [0, 1]] as const) p.put(staffX + 1 + dx, ground + 1 + dy, S.dust);
  }
  return p;
}

/**
 * Forty frames: an idle that breathes, blinks and taps the staff, and
 * eight-frame walks in four directions, the left one mirrored from the right.
 */
function bakeSurveyor(): Pix {
  const frames: Pix[] = [];
  const idle: Pose[] = Array.from({ length: 8 }, (_, f) => ({
    ...REST,
    breathe: [0, 0, 1, 1, 1, 0, 0, 0][f]!,
    blink: f === 6,
    staffLift: [0, 0, 0, 0, 3, 1, 0, 0][f]!,
    dust: f === 6,
    swing: [0, 0, 0.3, 0.3, 0.3, 0, 0, 0][f]!,
  }));
  const walk = (f: number): Pose => {
    const phase = (f / 8) * Math.PI * 2;
    const s = Math.sin(phase);
    return {
      ...REST,
      bob: [0, -1, -2, -1, 0, -1, -2, -1][f]!,
      leftFoot: Math.round(s * 2),
      rightFoot: Math.round(-s * 2),
      swing: s,
      sway: Math.round(Math.cos(phase) * 1.4),
      breathe: 0,
      blink: false,
      staffLift: Math.max(0, Math.round(s * 2)),
      dust: false,
    };
  };
  for (const pose of idle) frames.push(drawSurveyor("front", pose));
  for (let f = 0; f < 8; f++) frames.push(drawSurveyor("front", walk(f)));
  for (let f = 0; f < 8; f++) frames.push(drawSurveyor("back", walk(f)));
  for (let f = 0; f < 8; f++) {
    const right = drawSurveyor("side", walk(f));
    const left = new Pix(32, 40);
    left.blit(right, 0, 0, { flipX: true });
    frames.push(left);
  }
  for (let f = 0; f < 8; f++) frames.push(drawSurveyor("side", walk(f)));
  return sheet(frames, 8, 32, 40);
}

/* ── the scouts ──────────────────────────────────────────────────────── */

const K = {
  helmet: rgb(98, 116, 62),
  helmetLight: rgb(134, 154, 86),
  helmetDark: rgb(62, 76, 40),
  tunic: rgb(86, 104, 56),
  tunicLight: rgb(112, 132, 72),
  tunicDark: rgb(58, 70, 38),
  belt: rgb(104, 78, 44),
  buckle: rgb(206, 176, 92),
  trouser: rgb(72, 62, 46),
  boot: rgb(42, 32, 26),
  rifle: rgb(62, 66, 76),
  rifleLight: rgb(146, 150, 162),
  stock: rgb(110, 78, 46),
  outline: rgb(22, 24, 28),
};

/**
 * A scout: a small soldier, 16×16, feet on the bottom row, facing right,
 * rifle on the shoulder. `stride` swings the legs (-2..2), `bob` lifts the
 * body (negative is up); the legs stretch to keep the boots on the ground.
 */
function drawScout(stride: number, bob: number): Pix {
  const p = new Pix(16, 16);
  const b = bob;
  // legs and boots: the front leg leads by the stride, the back leg trails
  const back = 6 - Math.round(stride / 2);
  const front = 8 + Math.round(stride / 2);
  for (const x of [back, front]) {
    p.fill(x, 11 + b, 2, 3 - b, K.trouser);
    p.fill(x, 14, 2, 2, K.boot);
  }
  // tunic, lit from the left, with the belt and its buckle
  p.fill(5, 7 + b, 6, 3, K.tunic);
  p.fill(5, 7 + b, 1, 3, K.tunicLight);
  p.fill(10, 7 + b, 1, 3, K.tunicDark);
  p.fill(5, 10 + b, 6, 1, K.belt);
  p.put(8, 10 + b, K.buckle);
  // the rifle, slung up and to the right, and the hand that holds it
  for (let k = 0; k < 6; k++) p.put(9 + k, 9 + b - k, k === 5 ? K.rifleLight : k < 2 ? K.stock : K.rifle);
  p.put(10, 8 + b, S.skin);
  // face: an eye on the leading side
  p.fill(6, 4 + b, 4, 3, S.skin);
  p.put(6, 5 + b, S.skinShade);
  p.put(9, 5 + b, S.eye);
  // helmet with a dark rim
  p.fill(6, 1 + b, 4, 1, K.helmetLight);
  p.fill(5, 2 + b, 6, 1, K.helmet);
  p.fill(5, 3 + b, 6, 1, K.helmetDark);
  outline(p, K.outline);
  return p;
}

/**
 * Six frames: a four-frame march, then two frames of a scout sunk to the
 * chest under a moving line of foam, for the ones that crossed the shore.
 */
function bakeScouts(): Pix {
  const frames: Pix[] = [];
  const march: [number, number][] = [
    [2, 0],
    [0, -1],
    [-2, 0],
    [0, -1],
  ];
  for (const [stride, bob] of march) frames.push(drawScout(stride, bob));
  const WATERLINE = 11;
  for (let k = 0; k < 2; k++) {
    const sunk = drawScout(0, 0)
      .shifted(0, 5 + k)
      .map((c, _x, y) => (y > WATERLINE ? CLEAR : c));
    for (let x = 3; x < 13; x++) if ((x + k) % 2 === 0) sunk.put(x, WATERLINE, P.foam);
    frames.push(sunk);
  }
  return sheet(frames, 6, 16, 16);
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

  // The surveyor's levelling staff: a pole, a crossbar, a sighting orb.
  const staff = new Pix(16, 16);
  staff.fill(7, 3, 2, 13, P.wood);
  staff.fill(7, 3, 1, 13, P.woodLight);
  staff.put(7, 15, P.woodDark);
  staff.put(8, 15, P.woodDark);
  staff.fill(5, 6, 6, 1, P.brass);
  staff.put(5, 5, P.brass);
  staff.put(10, 5, P.brass);
  circle(staff, 8, 2.5, 2.2, P.leyDeep);
  circle(staff, 8, 2.5, 1.4, P.ley);
  staff.put(7, 1, P.leyBright);

  // The survey peg at today's price: a brass post with a peril pennant.
  const peg = new Pix(16, 16);
  for (let x = 3; x < 13; x++) if (hash(x, 1, 95) > 0.35) peg.put(x, 14, P.shadow);
  peg.fill(7, 4, 2, 10, P.brass);
  peg.fill(7, 4, 1, 10, mix(P.brass, P.vellumLit, 0.5));
  peg.fill(6, 13, 4, 1, mix(P.brass, P.shellEdge, 0.5));
  peg.fill(9, 4, 5, 1, hex(0xe2603a));
  peg.fill(9, 5, 4, 1, hex(0xe2603a));
  peg.fill(9, 6, 2, 1, hex(0xe2603a));
  peg.put(7, 3, P.leyBright);

  return sheet([bubble, droplet, spark, smoke, cog, orb, glow, window, staff, peg], 10, 16, 16);
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

/**
 * The landing's console: a heavy frame of dressed stone with brass rivets
 * around a dark face, 64×64, sliced at 20.
 */
function bakeFrame(): Pix {
  const p = new Pix(64, 64);
  const stone = rgb(96, 102, 112);
  const stoneLight = rgb(134, 140, 150);
  const stoneDark = rgb(62, 66, 76);
  const mortar = rgb(30, 32, 40);
  p.fill(0, 0, 64, 64, stone);
  // Blocks around the border, 8 wide, with mortar between them.
  for (let i = 0; i < 64; i += 8) {
    for (const [x, y] of [[i, 2], [i, 12], [2, i], [12, i], [i, 50], [i, 60], [50, i], [60, i]] as const) {
      p.fill(x, y, 8, 1, mortar);
      p.fill(y, x, 1, 8, mortar);
    }
  }
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (x < 20 || y < 20 || x >= 44 || y >= 44) { const g = hash(x, y, 80); if (g > 0.9) p.put(x, y, stoneLight); else if (g < 0.08) p.put(x, y, stoneDark); }
  p.rectOutline(0, 0, 64, 64, P.shellEdge);
  p.rectOutline(1, 1, 62, 62, stoneLight);
  // The face and the brass line that seats it.
  p.fill(18, 18, 28, 28, P.shellEdge);
  p.fill(19, 19, 26, 26, P.brass);
  p.fill(20, 20, 24, 24, P.shell);
  for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) if (hash(x, y, 81) > 0.93) p.put(x, y, P.shellLit);
  // Rivets in the corners of the stone.
  for (const [cx, cy] of [[6, 6], [54, 6], [6, 54], [54, 54]] as const) {
    p.fill(cx, cy, 4, 4, P.brass);
    p.put(cx, cy, mix(P.brass, P.vellumLit, 0.6));
    p.put(cx + 3, cy + 3, mix(P.brass, P.shellEdge, 0.5));
  }
  return p;
}

/** The landing's big brass button, three states stacked: rest, hover, pressed. 120×36 each. */
function bakeBigButton(): Pix {
  const frames: Pix[] = [];
  const draw = (body: RGBA, top: RGBA, bottom: RGBA, pressed: boolean): Pix => {
    const p = new Pix(120, 36);
    const y0 = pressed ? 3 : 0;
    const h = 36 - y0;
    p.fill(0, y0, 120, h, body);
    p.fill(0, y0, 120, 3, top);
    p.fill(0, 36 - (pressed ? 2 : 5), 120, pressed ? 2 : 5, bottom);
    p.fill(1, y0 + 1, 2, h - 2, top);
    p.fill(117, y0 + 1, 2, h - 2, bottom);
    p.rectOutline(0, y0, 120, h, rgb(24, 24, 24));
    for (const x of [1, 118]) { p.put(x, y0, CLEAR); p.put(x, 35, CLEAR); }
    if (pressed) p.fill(0, 0, 120, 3, rgb(24, 24, 24, 120));
    for (let y = y0 + 4; y < 32; y++) for (let x = 4; x < 116; x++) if (hash(x, y, 90) > 0.94) p.put(x, y, mix(body, top, 0.5));
    return p;
  };
  frames.push(draw(P.brass, mix(P.brass, P.vellumLit, 0.45), mix(P.brass, P.shellEdge, 0.45), false));
  frames.push(draw(mix(P.brass, P.vellumLit, 0.2), mix(P.brass, P.vellumLit, 0.6), mix(P.brass, P.shellEdge, 0.35), false));
  frames.push(draw(mix(P.brass, P.shellEdge, 0.2), mix(P.brass, P.vellumLit, 0.25), mix(P.brass, P.shellEdge, 0.55), true));
  return sheet(frames, 1, 120, 36);
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
save("scouts.png", bakeScouts());
save("clutter.png", bakeClutter());
save("peaks.png", bakePeaks());
save("fx.png", bakeFx());
save("ui-panel.png", bakePanel());
save("ui-console.png", bakeConsole());
save("ui-button.png", bakeButton());
save("ui-topbar.png", bakeTopbar());
save("ui-frame.png", bakeFrame());
save("ui-bigbutton.png", bakeBigButton());
void scale;
