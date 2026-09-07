export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * A survey palette rather than a heat map.
 *
 * Heat maps say "bad here, good there" and stop. A survey palette says how far
 * above or below sea level a point is, keeps the shoreline as a hard edge
 * because that edge is a real event, and leaves enough room in the greens for
 * hillshading to show slope.
 */
const LAND: { at: number; color: RGB }[] = [
  { at: 0.0, color: { r: 214, g: 216, b: 178 } }, // shore sand
  { at: 0.08, color: { r: 168, g: 190, b: 140 } },
  { at: 0.2, color: { r: 122, g: 165, b: 116 } },
  { at: 0.45, color: { r: 158, g: 152, b: 106 } },
  { at: 0.8, color: { r: 186, g: 168, b: 146 } },
  { at: 1.0, color: { r: 236, g: 236, b: 232 } }, // high ground
];

const WATER: { at: number; color: RGB }[] = [
  { at: 0.0, color: { r: 150, g: 190, b: 208 } }, // shallows
  { at: 0.35, color: { r: 86, g: 138, b: 176 } },
  { at: 1.0, color: { r: 28, g: 58, b: 98 } }, // deep
];

function ramp(stops: { at: number; color: RGB }[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i]!;
    if (x <= hi.at) {
      const lo = stops[i - 1]!;
      const span = hi.at - lo.at;
      const f = span <= 0 ? 0 : (x - lo.at) / span;
      return {
        r: Math.round(lo.color.r + f * (hi.color.r - lo.color.r)),
        g: Math.round(lo.color.g + f * (hi.color.g - lo.color.g)),
        b: Math.round(lo.color.b + f * (hi.color.b - lo.color.b)),
      };
    }
  }
  return stops[stops.length - 1]!.color;
}

/**
 * Colour for an elevation, where zero is liquidation.
 *
 * `ceiling` is the health factor headroom the top of the palette represents;
 * anything higher flattens out, because the difference between very safe and
 * extremely safe is not worth a colour.
 */
export function colorForElevation(z: number, ceiling = 1.0): RGB {
  if (!Number.isFinite(z)) return { r: 236, g: 236, b: 232 };
  if (z >= 0) return ramp(LAND, z / ceiling);
  return ramp(WATER, Math.min(1, -z / 0.5));
}
