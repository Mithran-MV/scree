import type Phaser from "phaser";
import { Band, BAND_COUNT, CORNER } from "./terrain";

/**
 * A generated, rule-based terrain tileset.
 *
 * Tiny Town supplies textured interiors for grass, highland and mountain, but
 * ships no water, no sand and no edge tiles between materials. So the edges
 * are generated here: for every adjacent pair of bands and every one of the
 * fourteen corner masks a dual-grid tile can take, a 16px tile is painted with
 * the higher material covering a rounded region around its high corners. Four
 * tiles meeting at a corner each paint a quarter of the same disc, so the
 * coastline is continuous and rounded across tile borders — no jagged steps.
 *
 * Colours come from the pack itself, sampled from its own tiles at runtime, so
 * the generated edges and the pack's interiors are the same paint.
 */

export const TILE = 16;
const COLUMNS = 16;
const INTERIOR_VARIANTS = 3;
const WATER_FRAMES = 2;

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
export type Materials = Record<Band, Material>;

/* ── indices ─────────────────────────────────────────────────────────── */

const WATER_BASE = 0; // frame f, variant v → f * 3 + v
const INTERIOR_BASE = WATER_FRAMES * INTERIOR_VARIANTS; // bands 1..4, 3 variants each
const TRANSITION_BASE = INTERIOR_BASE + (BAND_COUNT - 1) * INTERIOR_VARIANTS; // pair × 14 masks
export const GENERATED_TOTAL = TRANSITION_BASE + (BAND_COUNT - 1) * 14;

export function waterIndex(frame: number, variant: number): number {
  return WATER_BASE + (frame % WATER_FRAMES) * INTERIOR_VARIANTS + (variant % INTERIOR_VARIANTS);
}

export function interiorIndex(band: Band, variant: number): number {
  if (band === Band.WATER) return waterIndex(0, variant);
  return INTERIOR_BASE + (band - 1) * INTERIOR_VARIANTS + (variant % INTERIOR_VARIANTS);
}

/** Transition from `lo` to `lo + 1` for a corner mask in 1..14. */
export function transitionIndex(lo: Band, mask: number): number {
  return TRANSITION_BASE + lo * 14 + (mask - 1);
}

/* ── colour helpers ──────────────────────────────────────────────────── */

const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});
const scale = (c: RGB, k: number): RGB => ({ r: c.r * k, g: c.g * k, b: c.b * k });
const css = (c: RGB): string => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;

function material(base: RGB): Material {
  return { base, shade: scale(base, 0.78), light: mix(base, { r: 255, g: 255, b: 255 }, 0.22) };
}

/** Average colour of one 16px frame in a spritesheet texture. */
export function sampleFrame(scene: Phaser.Scene, key: string, frame: number): RGB | null {
  const tex = scene.textures.get(key);
  const source = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  if (!source || !("width" in source)) return null;
  const cols = Math.floor(source.width / TILE);
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, (frame % cols) * TILE, Math.floor(frame / cols) * TILE, TILE, TILE, 0, 0, TILE, TILE);
  const d = ctx.getImageData(0, 0, TILE, TILE).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 128) continue;
    r += d[i]!;
    g += d[i + 1]!;
    b += d[i + 2]!;
    n++;
  }
  return n === 0 ? null : { r: r / n, g: g / n, b: b / n };
}

/**
 * Materials for each band, taken from the pack where the pack has them.
 * Grass, dirt and stone are sampled from Tiny Town; sand is the pack's dirt
 * lightened toward cream; water is the one colour the pack never had.
 */
export function materialsFromPack(scene: Phaser.Scene, townKey: string): Materials {
  const grass = sampleFrame(scene, townKey, 0) ?? { r: 143, g: 208, b: 90 };
  const dirt = sampleFrame(scene, townKey, 39) ?? { r: 205, g: 164, b: 108 };
  const stone = sampleFrame(scene, townKey, 108) ?? { r: 178, g: 180, b: 184 };
  const sand = mix(dirt, { r: 246, g: 232, b: 196 }, 0.55);
  const water: RGB = { r: 31, g: 93, b: 115 };
  return {
    [Band.WATER]: { base: water, shade: { r: 23, g: 74, b: 92 }, light: { r: 63, g: 142, b: 163 } },
    [Band.COAST]: material(sand),
    [Band.GRASS]: material(grass),
    [Band.HIGHLAND]: material(dirt),
    [Band.MOUNTAIN]: material(stone),
  };
}

/* ── painting ────────────────────────────────────────────────────────── */

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

/** Fill a tile with a material: base colour, faint ordered-dither shade, a few light specks. */
function paintInterior(ctx: CanvasRenderingContext2D, x0: number, y0: number, m: Material, variant: number): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const grain = (BAYER[y & 3]![x & 3]! + 0.5) / 16;
      let c = m.base;
      if (grain < 0.1) c = mix(m.base, m.shade, 0.5);
      if (hash(x + variant * 31, y, 7) > 0.965) c = m.light;
      ctx.fillStyle = css(c);
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
}

/** Water: base, a dither of shade, and wave marks that move between the two frames. */
function paintWater(ctx: CanvasRenderingContext2D, x0: number, y0: number, m: Material, frame: number, variant: number): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const grain = (BAYER[y & 3]![x & 3]! + 0.5) / 16;
      ctx.fillStyle = css(grain < 0.18 ? mix(m.base, m.shade, 0.6) : m.base);
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
  ctx.fillStyle = css(m.light);
  for (let i = 0; i < 3; i++) {
    const wx = Math.floor(hash(i, variant, 11) * 12) + (frame === 0 ? 0 : 2);
    const wy = Math.floor(hash(i, variant, 13) * 14);
    ctx.fillRect(x0 + (wx % TILE), y0 + wy, 3, 1);
    ctx.fillRect(x0 + ((wx + 1) % TILE), y0 + ((wy + 1) % TILE), 1, 1);
  }
}

/**
 * A transition tile: `hi` material inside a disc of radius R around each high
 * corner, `lo` elsewhere, with a dark lip on the high side and a light lip on
 * the low side (foam, when the low side is water).
 */
function paintTransition(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  lo: Material,
  hi: Material,
  mask: number,
  loIsWater: boolean,
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

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let d = Infinity;
      for (const [cx, cy] of highCorners) d = Math.min(d, Math.hypot(px - cx, py - cy));
      const isHi = d < R;
      const grain = (BAYER[y & 3]![x & 3]! + 0.5) / 16;
      let c: RGB;
      if (isHi) {
        c = d > R - 1.4 ? hi.shade : grain < 0.1 ? mix(hi.base, hi.shade, 0.5) : hi.base;
      } else if (d < R + 1.3) {
        c = loIsWater ? { r: 207, g: 238, b: 242 } : lo.light;
      } else {
        c = grain < 0.1 ? mix(lo.base, lo.shade, 0.5) : lo.base;
      }
      ctx.fillStyle = css(c);
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
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

  for (let f = 0; f < WATER_FRAMES; f++) {
    for (let v = 0; v < INTERIOR_VARIANTS; v++) {
      const p = at(waterIndex(f, v));
      paintWater(ctx, p.x, p.y, materials[Band.WATER], f, v);
    }
  }
  for (let band = 1; band < BAND_COUNT; band++) {
    for (let v = 0; v < INTERIOR_VARIANTS; v++) {
      const p = at(interiorIndex(band as Band, v));
      paintInterior(ctx, p.x, p.y, materials[band as Band], v);
    }
  }
  for (let lo = 0; lo < BAND_COUNT - 1; lo++) {
    for (let mask = 1; mask <= 14; mask++) {
      const p = at(transitionIndex(lo as Band, mask));
      paintTransition(ctx, p.x, p.y, materials[lo as Band], materials[(lo + 1) as Band], mask, lo === Band.WATER);
    }
  }

  scene.textures.addCanvas(key, canvas);
  return key;
}
