/**
 * A small seeded generator, so a run of paths is reproducible.
 *
 * Reproducibility matters here for two reasons: a survival figure quoted on
 * screen has to be the same figure a reader gets when they load the same URL,
 * and a test asserting that figure has to be able to pin it.
 */
export interface Rng {
  /** Uniform on [0, 1). */
  next(): number;
  /** Standard normal, via Box-Muller. */
  normal(): number;
}

export function seededRng(seed: number): Rng {
  // mulberry32: small, fast, and good enough for a visual walk.
  let a = seed >>> 0;
  let spare: number | null = null;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (): number => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    // Reject the origin so the log is finite.
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const scale = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * scale;
    return u * scale;
  };

  return { next, normal };
}
