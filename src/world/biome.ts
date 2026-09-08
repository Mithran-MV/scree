import type { RGB } from "../render/theme";

/**
 * The world's biomes.
 *
 * This is the one place in the codebase where colour is chosen to be beautiful
 * rather than to be legible as a measurement, and that is deliberate and
 * bounded: the world view exists to be walked around, and the survey plate
 * beside it remains the artifact that proves the ground under it was measured.
 * Both are drawn from exactly the same field, so nothing here can move a
 * contour, a shoreline or a number.
 *
 * Height alone would give banded stripes, so slope is read too. Steep ground
 * sheds its soil and shows rock whatever altitude it sits at, which is what
 * makes a hillside look like a hillside instead of a contour map with colours.
 */

export interface Band {
  at: number;
  color: RGB;
}

const c = (r: number, g: number, b: number): RGB => ({ r, g, b });

/** Sea level upward, normalised against the ceiling. */
export const LAND_BANDS: Band[] = [
  { at: 0.0, color: c(214, 199, 154) }, // wet sand at the waterline
  { at: 0.05, color: c(197, 190, 132) }, // dune grass
  { at: 0.14, color: c(140, 168, 96) }, // meadow
  { at: 0.46, color: c(96, 140, 78) }, // pasture
  { at: 0.72, color: c(62, 104, 64) }, // forest
  { at: 0.88, color: c(88, 104, 74) }, // upland heath
  { at: 0.96, color: c(126, 122, 106) }, // scree
  { at: 1.0, color: c(176, 172, 160) }, // bare rock at the very top
];

/** Sea level downward, normalised against the sea datum. */
export const SEA_BANDS: Band[] = [
  { at: 0.0, color: c(126, 188, 186) }, // shallows
  { at: 0.18, color: c(74, 148, 158) },
  { at: 0.5, color: c(38, 96, 122) },
  { at: 1.0, color: c(18, 48, 76) }, // deep
];

/** Exposed rock on steep faces, blended in by slope. */
const ROCK: RGB = c(126, 118, 104);
const CLIFF: RGB = c(92, 84, 76);

export function rampAt(bands: Band[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < bands.length; i++) {
    const hi = bands[i]!;
    if (x <= hi.at) {
      const lo = bands[i - 1]!;
      const span = hi.at - lo.at;
      const f = span <= 0 ? 0 : (x - lo.at) / span;
      return {
        r: lo.color.r + f * (hi.color.r - lo.color.r),
        g: lo.color.g + f * (hi.color.g - lo.color.g),
        b: lo.color.b + f * (hi.color.b - lo.color.b),
      };
    }
  }
  return bands[bands.length - 1]!.color;
}

export interface BiomeInput {
  z: number;
  ceiling: number;
  seaDatum: number;
  /** Slope as a 0..1 fraction of the steepest ground on this map. */
  steepness: number;
}

/**
 * Colour for a point in the world. Returned in 0..1 float components, which is
 * what a vertex-colour buffer wants.
 */
export function biomeColor(input: BiomeInput): [number, number, number] {
  const { z, ceiling, seaDatum, steepness } = input;

  let base: RGB;
  if (z < 0) {
    base = rampAt(SEA_BANDS, Math.min(1, -z / Math.max(seaDatum, 1e-6)));
  } else {
    base = rampAt(LAND_BANDS, Math.min(1, z / Math.max(ceiling, 1e-6)));
    // Soil holds on gentle ground and sheds on steep ground. The exponent keeps
    // rolling country green and only turns the genuinely steep faces to stone.
    const bare = Math.min(1, Math.max(0, (steepness - 0.66) / 0.3)) ** 1.4;
    if (bare > 0) {
      const stone = steepness > 0.82 ? CLIFF : ROCK;
      base = {
        r: base.r + (stone.r - base.r) * bare,
        g: base.g + (stone.g - base.g) * bare,
        b: base.b + (stone.b - base.b) * bare,
      };
    }
  }

  return [base.r / 255, base.g / 255, base.b / 255];
}
