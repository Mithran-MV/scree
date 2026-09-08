/**
 * The chart's palette.
 *
 * A survey drawn at night. The ground is ink and the readings are light: every
 * mark that carries a measurement glows, and everything that carries none does
 * not. That rule is the whole discipline of this skin — if a viewer can see it
 * shining, it came out of the field.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const rgb = (hex: string): RGB => {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

export const css = (c: RGB, alpha = 1): string =>
  `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${alpha})`;

export const ARCANE = {
  /** Ground, low to high. */
  abyss: rgb("#050a18"),
  deep: rgb("#0a1330"),
  shelf: rgb("#132348"),
  upland: rgb("#1d3260"),
  summit: rgb("#2b4a7d"),

  /** Ley light. */
  ley: rgb("#e0b25a"),
  leyBright: rgb("#ffe6a8"),
  leyPale: rgb("#8a7440"),

  /** The waterline, which is the only edge that marks an event. */
  hazard: rgb("#e2603a"),
  hazardGlow: rgb("#ff9a6a"),

  /** Cold light, reserved for the reading you are standing on. */
  aether: rgb("#57d6e8"),
  aetherDim: rgb("#2b7f8e"),

  vellum: rgb("#e8dcc0"),
  brass: rgb("#b08d4a"),
} as const;

/** Elevation to ground colour. Zero is the waterline. */
export function groundColor(z: number, ceiling: number, seaDatum: number): RGB {
  if (!Number.isFinite(z)) return ARCANE.summit;
  if (z < 0) {
    const t = Math.min(1, -z / Math.max(seaDatum, 1e-6));
    return mix(ARCANE.deep, ARCANE.abyss, t);
  }
  const t = Math.min(1, z / Math.max(ceiling, 1e-6));
  if (t < 0.5) return mix(ARCANE.shelf, ARCANE.upland, t / 0.5);
  return mix(ARCANE.upland, ARCANE.summit, (t - 0.5) / 0.5);
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const f = Math.min(1, Math.max(0, t));
  return {
    r: a.r + (b.r - a.r) * f,
    g: a.g + (b.g - a.g) * f,
    b: a.b + (b.b - a.b) * f,
  };
}
