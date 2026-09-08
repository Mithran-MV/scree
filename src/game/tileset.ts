import type Phaser from "phaser";
import { Band, BAND_COUNT, CORNER, isWater } from "./terrain";

/**
 * The generated terrain tileset.
 *
 * Interiors, transitions and water are painted at load time from colours
 * sampled off the CC0 sheet, so the generated tiles match the pack's art and
 * every band edge is a rule rather than a hand-placed tile:
 *
 *   - water tiles come in 8 frames per band (deep and shallow) so the sea
 *     rolls; the shore transition has 4 frames of moving foam;
 *   - a transition tile shows one step, `lo` → `lo + 1`, cut by discs around
 *     its high corners, so four tiles meeting at a corner agree;
 *   - land steps carry a dark cliff band under the high side, which is what
 *     makes the ground read as terraces rather than paint.
 */

export const TILE = 16;
const COLUMNS = 16;
export const WATER_FRAMES = 8;
export const SHORE_FRAMES = 4;
const VARIANTS = 3;
const LAND_VARIANTS = 4; // three plain, one with a feature
const LAND_BANDS = BAND_COUNT - 2;
const PAIRS = BAND_COUNT - 1;
const MASKS = 14;

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Material {
  base: RGB;
  shade: RGB;
  light: RGB;
}

export interface Materials {
  band: Record<Band, Material>;
  dirt: Material;
}

/* ── indices ─────────────────────────────────────────────────────────── */

const WATER_BASE = 0;
const INTERIOR_BASE = WATER_BASE + 2 * WATER_FRAMES * VARIANTS;
const TRANSITION_BASE = INTERIOR_BASE + LAND_BANDS * LAND_VARIANTS;
const SHORE_BASE = TRANSITION_BASE + PAIRS * MASKS;
export const GENERATED_TOTAL = SHORE_BASE + (SHORE_FRAMES - 1) * MASKS;

export function waterIndex(band: Band, frame: number, variant: number): number {
  const b = band === Band.DEEP ? 0 : 1;
  return WATER_BASE + b * WATER_FRAMES * VARIANTS + (frame % WATER_FRAMES) * VARIANTS + (variant % VARIANTS);
}

export function interiorIndex(band: Band, variant: number): number {
  if (isWater(band)) return waterIndex(band, 0, variant);
  return INTERIOR_BASE + (band - Band.COAST) * LAND_VARIANTS + (variant % LAND_VARIANTS);
}

/** Transition from `lo` to `lo + 1` for a corner mask in 1..14. */
export function transitionIndex(lo: Band, mask: number): number {
  return TRANSITION_BASE + lo * MASKS + (mask - 1);
}

/** The shallow → coast transition, animated: frame 0 is the base tile. */
export function shoreIndex(mask: number, frame: number): number {
  const f = frame % SHORE_FRAMES;
  return f === 0 ? transitionIndex(Band.SHALLOW, mask) : SHORE_BASE + (f - 1) * MASKS + (mask - 1);
}

/* ── colour helpers ──────────────────────────────────────────────────── */

const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});
const scale = (c: RGB, k: number): RGB => ({ r: c.r * k, g: c.g * k, b: c.b * k });
const css = (c: RGB): string => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const FOAM: RGB = { r: 212, g: 240, b: 244 };

function material(base: RGB): Material {
  return { base, shade: scale(base, 0.78), light: mix(base, WHITE, 0.25) };
}

/** Average colour of one frame of a loaded sheet, or null if it cannot be read. */
export function sampleFrame(scene: Phaser.Scene, key: string, frame: number): RGB | null {
  const texture = scene.textures.get(key);
  const f = texture.get(frame);
  if (!f) return null;
  const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement("canvas");
  canvas.width = f.width;
  canvas.height = f.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, f.cutX, f.cutY, f.width, f.height, 0, 0, f.width, f.height);
  const px = ctx.getImageData(0, 0, f.width, f.height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! < 128) continue;
    r += px[i]!;
    g += px[i + 1]!;
    b += px[i + 2]!;
    n++;
  }
  return n ? { r: r / n, g: g / n, b: b / n } : null;
}

/** Materials sampled from Tiny Town: grass from its grass, sand from its dirt, stone from its wall. */
export function materialsFromPack(scene: Phaser.Scene, townKey: string): Materials {
  const grass = sampleFrame(scene, townKey, 0) ?? { r: 118, g: 176, b: 96 };
  const dirt = sampleFrame(scene, townKey, 39) ?? { r: 196, g: 146, b: 96 };
  const stone = sampleFrame(scene, townKey, 109) ?? { r: 168, g: 170, b: 178 };
  return {
    band: {
      [Band.DEEP]: material({ r: 18, g: 42, b: 68 }),
      [Band.SHALLOW]: material({ r: 36, g: 116, b: 138 }),
      [Band.COAST]: material(mix(dirt, { r: 238, g: 222, b: 182 }, 0.55)),
      [Band.GRASS]: material(grass),
      [Band.FOREST]: material(mix(scale(grass, 0.62), { r: 46, g: 70, b: 42 }, 0.5)),
      [Band.MOUNTAIN]: material(scale(stone, 0.82)),
      [Band.SNOW]: material({ r: 232, g: 238, b: 244 }),
    },
    dirt: material(dirt),
  };
}

/* ── painters ────────────────────────────────────────────────────────── */

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: RGB): void {
  ctx.fillStyle = css(c);
  ctx.fillRect(x, y, 1, 1);
}

function grainOf(x: number, y: number): number {
  return (BAYER[y & 3]![x & 3]! + 0.5) / 16;
}

/** A plain interior: base, ordered-dither shade, light specks. */
function paintPlain(ctx: CanvasRenderingContext2D, x0: number, y0: number, m: Material, variant: number): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let c = m.base;
      if (grainOf(x, y) < 0.1) c = mix(m.base, m.shade, 0.5);
      if (hash(x + variant * 31, y, 7) > 0.965) c = m.light;
      px(ctx, x0 + x, y0 + y, c);
    }
  }
}

/** The fourth interior variant of each dry band carries a feature of its biome. */
function paintFeature(ctx: CanvasRenderingContext2D, x0: number, y0: number, band: Band, m: Material, dirt: Material): void {
  paintPlain(ctx, x0, y0, m, 3);
  const blob = (cx: number, cy: number, rx: number, ry: number, fill: RGB, rim: RGB) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        if (d < 1) px(ctx, x0 + x, y0 + y, d > 0.72 && hash(x, y, 17) > 0.4 ? rim : fill);
      }
    }
  };
  switch (band) {
    case Band.COAST:
      blob(8, 9, 5.5, 3.5, mix(m.base, { r: 112, g: 88, b: 62 }, 0.45), mix(m.base, { r: 112, g: 88, b: 62 }, 0.25));
      break;
    case Band.GRASS:
      blob(8, 8, 5, 4, dirt.base, mix(dirt.base, m.base, 0.5));
      px(ctx, x0 + 6, y0 + 8, dirt.shade);
      px(ctx, x0 + 10, y0 + 7, dirt.shade);
      break;
    case Band.FOREST:
      for (let i = 0; i < 14; i++) px(ctx, x0 + Math.floor(hash(i, 1, 19) * 16), y0 + Math.floor(hash(i, 2, 19) * 16), dirt.shade);
      for (let x = 4; x < 11; x++) px(ctx, x0 + x, y0 + 10 + (x > 7 ? 1 : 0), scale(dirt.shade, 0.8));
      break;
    case Band.MOUNTAIN: {
      let x = 3;
      let y = 4;
      const dark = scale(m.shade, 0.75);
      while (x < 14 && y < 15) {
        px(ctx, x0 + x, y0 + y, dark);
        if (hash(x, y, 23) > 0.5) x++;
        else y++;
      }
      px(ctx, x0 + 10, y0 + 5, m.light);
      break;
    }
    case Band.SNOW:
      for (const yy of [4, 11]) for (let x = 2; x < 13; x++) if (hash(x, yy, 29) > 0.25) px(ctx, x0 + x, y0 + yy + (x > 8 ? 1 : 0), mix(m.base, { r: 176, g: 198, b: 224 }, 0.55));
      break;
    default:
      break;
  }
}

/**
 * Water: a dithered base and crests that travel one way across the frames,
 * so eight tiles in sequence roll. Deep water is darker and its crests are
 * shorter and slower; shallow water glitters.
 */
function paintWater(ctx: CanvasRenderingContext2D, x0: number, y0: number, band: Band, m: Material, frame: number, variant: number): void {
  const deep = band === Band.DEEP;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const swell = Math.sin(((x + frame * 2 + variant * 4) / 16) * Math.PI * 2 + y * 0.35);
      let c = m.base;
      if (grainOf(x, y) < 0.16 + swell * 0.08) c = mix(m.base, m.shade, 0.6);
      if (!deep && hash(x, y, frame + variant * 8 + 40) > 0.988) c = m.light;
      px(ctx, x0 + x, y0 + y, c);
    }
  }
  const crest = deep ? mix(m.base, m.light, 0.45) : m.light;
  const rowsOf = deep ? [5, 12] : [3, 9, 14];
  rowsOf.forEach((row, i) => {
    const period = deep ? 8 : 16;
    const speed = deep ? 1 : 2;
    const off = (frame * speed + variant * 5 + i * 7) % period;
    const len = deep ? 3 : 4;
    for (let rep = 0; rep < TILE / period; rep++) {
      for (let k = 0; k < len; k++) px(ctx, x0 + ((off + k + rep * period) % TILE), y0 + row, k === 0 ? mix(crest, WHITE, 0.3) : crest);
      if (!deep) px(ctx, x0 + ((off + len + rep * period) % TILE), y0 + ((row + 1) % TILE), mix(m.base, crest, 0.5));
    }
  });
}

type TransitionKind = "deep" | "shore" | "land";

/**
 * A transition tile: `hi` material inside a disc of radius R around each high
 * corner, `lo` elsewhere. Land steps get a light lip on top of the high side
 * and a two-pixel cliff under it; the shore gets foam that moves with the
 * frame; the deep/shallow edge is soft.
 */
function paintTransition(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  lo: Material,
  hi: Material,
  mask: number,
  kind: TransitionKind,
  frame = 0,
): void {
  const highCorners: [number, number][] = [];
  if (mask & CORNER.TL) highCorners.push([0, 0]);
  if (mask & CORNER.TR) highCorners.push([TILE, 0]);
  if (mask & CORNER.BL) highCorners.push([0, TILE]);
  if (mask & CORNER.BR) highCorners.push([TILE, TILE]);
  // Two high corners on a diagonal must stay separate discs, so their radius
  // stops short of the centre; otherwise they would bridge through it.
  const diagonal = mask === (CORNER.TL | CORNER.BR) || mask === (CORNER.TR | CORNER.BL);
  const R = diagonal ? 10.5 : 11.5;
  const dist = (x: number, y: number) => {
    let d = Infinity;
    for (const [cx, cy] of highCorners) d = Math.min(d, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
    return d;
  };
  const isHi = (x: number, y: number) => dist(x, y) < R;

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const d = dist(x, y);
      const grain = grainOf(x, y);
      let c: RGB;
      if (d < R) {
        c = grain < 0.1 ? mix(hi.base, hi.shade, 0.5) : hi.base;
        if (kind === "land") {
          if (!isHi(x, y - 1)) c = hi.light; // the lit lip along the top of the step
          else if (d > R - 1.2) c = hi.shade;
        } else if (d > R - 1.2) {
          c = kind === "shore" ? mix(hi.base, lo.base, 0.35) : mix(hi.base, lo.base, 0.5);
        }
      } else {
        c = grain < 0.1 ? mix(lo.base, lo.shade, 0.5) : lo.base;
        if (kind === "land") {
          // The cliff: the two rows under a high pixel fall into shadow.
          if (isHi(x, y - 1) || isHi(x, y - 2)) c = scale(hi.shade, isHi(x, y - 1) ? 0.62 : 0.8);
          else if (d < R + 1.2) c = mix(lo.base, lo.shade, 0.5);
        } else if (kind === "shore") {
          const band = 1.2 + frame * 0.45;
          const spray = hash(x, y, 50 + frame) > 0.6;
          if (d < R + band) c = spray || d < R + 1.1 ? FOAM : mix(lo.base, FOAM, 0.55);
          else if (d < R + band + 1.5 && hash(x, y, 60 + frame) > 0.75) c = mix(lo.base, FOAM, 0.5);
          else if (d < R + 3 && grain < 0.3) c = mix(lo.base, lo.light, 0.5);
        } else if (d < R + 4) {
          // The deep/shallow edge fades over four pixels with a dither, so the shelf reads as a slope.
          const t = 1 - (d - R) / 4;
          c = grain < t ? mix(lo.base, hi.base, 0.55 * t + 0.1) : mix(lo.base, hi.base, 0.15 * t);
        }
      }
      px(ctx, x0 + x, y0 + y, c);
    }
  }
}

/* ── the tileset ─────────────────────────────────────────────────────── */

export function buildTerrainTileset(scene: Phaser.Scene, key: string, materials: Materials): string {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const rows = Math.ceil(GENERATED_TOTAL / COLUMNS);
  const canvas = document.createElement("canvas");
  canvas.width = COLUMNS * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext("2d")!;
  const at = (index: number) => ({ x: (index % COLUMNS) * TILE, y: Math.floor(index / COLUMNS) * TILE });
  const m = materials.band;

  for (const band of [Band.DEEP, Band.SHALLOW]) {
    for (let f = 0; f < WATER_FRAMES; f++) {
      for (let v = 0; v < VARIANTS; v++) {
        const p = at(waterIndex(band, f, v));
        paintWater(ctx, p.x, p.y, band, m[band], f, v);
      }
    }
  }
  for (let band = Band.COAST; band < BAND_COUNT; band++) {
    for (let v = 0; v < LAND_VARIANTS; v++) {
      const p = at(interiorIndex(band as Band, v));
      if (v < 3) paintPlain(ctx, p.x, p.y, m[band as Band], v);
      else paintFeature(ctx, p.x, p.y, band as Band, m[band as Band], materials.dirt);
    }
  }
  for (let lo = 0; lo < PAIRS; lo++) {
    const kind: TransitionKind = lo === Band.DEEP ? "deep" : lo === Band.SHALLOW ? "shore" : "land";
    for (let mask = 1; mask <= MASKS; mask++) {
      const p = at(transitionIndex(lo as Band, mask));
      paintTransition(ctx, p.x, p.y, m[lo as Band], m[(lo + 1) as Band], mask, kind, 0);
    }
  }
  for (let f = 1; f < SHORE_FRAMES; f++) {
    for (let mask = 1; mask <= MASKS; mask++) {
      const p = at(shoreIndex(mask, f));
      paintTransition(ctx, p.x, p.y, m[Band.SHALLOW], m[Band.COAST], mask, "shore", f);
    }
  }

  scene.textures.addCanvas(key, canvas);
  return key;
}
