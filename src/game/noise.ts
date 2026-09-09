/**
 * 2D simplex noise with a seeded permutation, and a small fractal sum over
 * it. Values are in [-1, 1]. Used for the map's relief only: the readings
 * never touch it.
 */

const GRAD: readonly (readonly [number, number])[] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const tables = new Map<number, Uint8Array>();

/** A permutation table shuffled by a small seeded generator. */
function permutation(seed: number): Uint8Array {
  const cached = tables.get(seed);
  if (cached) return cached;
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  let s = (seed * 2654435761) >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [base[i], base[j]] = [base[j]!, base[i]!];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]!;
  tables.set(seed, p);
  return p;
}

export function simplex2(x: number, y: number, seed = 0): number {
  const perm = permutation(seed);
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let n = 0;
  const corner = (dx: number, dy: number, gi: number) => {
    let t0 = 0.5 - dx * dx - dy * dy;
    if (t0 < 0) return 0;
    t0 *= t0;
    const g = GRAD[gi % 8]!;
    return t0 * t0 * (g[0] * dx + g[1] * dy);
  };
  n += corner(x0, y0, perm[ii + perm[jj]!]!);
  n += corner(x1, y1, perm[ii + i1 + perm[jj + j1]!]!);
  n += corner(x2, y2, perm[ii + 1 + perm[jj + 1]!]!);
  return 70 * n;
}

/** Fractal sum: `octaves` layers, each twice the frequency and half the weight, normalised to [-1, 1]. */
export function fbm(x: number, y: number, octaves = 3, seed = 0): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex2(x * f, y * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}
