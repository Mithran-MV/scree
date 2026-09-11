/**
 * The plate's palette and scale, shared with nothing that needs a canvas so
 * they can be checked without one. The colours are the tileset's fallbacks
 * (src/game/tileset.ts), so the plate and the world agree on what a band
 * looks like even where the pack could not be sampled.
 */
import { Band } from "@/game/terrain";

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

const mix = (a: RGB, b: RGB, t: number): RGB => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const scale = (c: RGB, k: number): RGB => ({ r: c.r * k, g: c.g * k, b: c.b * k });
const WHITE: RGB = { r: 255, g: 255, b: 255 };

function material(base: RGB): Material {
  return { base, shade: scale(base, 0.78), light: mix(base, WHITE, 0.25) };
}

const GRASS: RGB = { r: 118, g: 176, b: 96 };
const DIRT: RGB = { r: 196, g: 146, b: 96 };
const STONE: RGB = { r: 168, g: 170, b: 178 };

export const MATERIALS: Record<Band, Material> = {
  [Band.ABYSS]: material({ r: 9, g: 24, b: 46 }),
  [Band.DEEP]: material({ r: 18, g: 44, b: 72 }),
  [Band.SHALLOW]: material({ r: 36, g: 116, b: 138 }),
  [Band.COAST]: material(mix(DIRT, { r: 238, g: 222, b: 182 }, 0.55)),
  [Band.GRASS]: material(GRASS),
  [Band.FOREST]: material(mix(scale(GRASS, 0.62), { r: 46, g: 70, b: 42 }, 0.5)),
  [Band.MOUNTAIN]: material(scale(STONE, 0.82)),
  [Band.SNOW]: material({ r: 232, g: 238, b: 244 }),
};

export const FOAM: RGB = { r: 212, g: 240, b: 244 };
export const LEY: RGB = { r: 53, g: 224, b: 232 };
export const LEY_DIM: RGB = { r: 29, g: 125, b: 140 };
export const PERIL: RGB = { r: 226, g: 96, b: 58 };
export const INK: RGB = { r: 38, g: 40, b: 46 };
export const VELLUM: RGB = { r: 228, g: 213, b: 173 };
export const VELLUM_EDGE: RGB = { r: 156, g: 135, b: 87 };
export const VELLUM_INK: RGB = { r: 43, g: 36, b: 24 };
export const HAT: RGB = { r: 122, g: 60, b: 158 };

export const css = (c: RGB, a = 1): string => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${a})`;

/** What each band means, for the legend and the reading. */
export const BAND_WORDS: Record<Band, string> = {
  [Band.ABYSS]: "the abyss: health far below one",
  [Band.DEEP]: "deep water: liquidated",
  [Band.SHALLOW]: "the shelf: liquidated, only just",
  [Band.COAST]: "the coast: the first dry ground",
  [Band.GRASS]: "lowland: a little headroom",
  [Band.FOREST]: "forest: comfortable",
  [Band.MOUNTAIN]: "bare stone: well clear",
  [Band.SNOW]: "the crest: the safest ground here",
};

/** The ordered dither the tileset uses, as a fraction in (0, 1). */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
export function grainOf(x: number, y: number): number {
  return (BAYER[y & 3]![x & 3]! + 0.5) / 16;
}

export function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Round prices to label the scale with, no more than `most`, on a step of 1, 2, 2.5 or 5 × a power of ten. */
export function priceTicks(low: number, high: number, most = 8): number[] {
  if (!(high > low) || !(low > 0)) return [];
  const span = high - low;
  const raw = span / most;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= most) ?? 10 * mag;
  const out: number[] = [];
  for (let p = Math.ceil(low / step) * step; p <= high + 1e-9; p += step) out.push(Math.round(p * 100) / 100);
  return out;
}

/** Dwell labels: whole days that divide the window evenly. */
export function dwellTicks(highDays: number): number[] {
  const step = highDays >= 20 ? 10 : highDays >= 8 ? 5 : 1;
  const out: number[] = [];
  for (let d = 0; d <= highDays + 1e-9; d += step) out.push(d);
  return out;
}
