import type { Raster } from "./raster";
import { dwellAt, priceAt } from "./raster";

/**
 * Everything the counter strip prints, derived from the raster rather than
 * typed. If the terrain is a featureless ramp these numbers say so, which is
 * the whole point of computing them instead of asserting them.
 */
export interface Features {
  /** Deployment ids that bind somewhere in the window. */
  binders: string[];
  /** Connected components of the set of cells where the binder changes. */
  foldLines8: number;
  foldLines4: number;
  /** Connected components of the underwater set. */
  basins: number;
  /** The hardest the ridge ever gets, across every dwell. */
  pass: PassPoint | null;
  /** True when that crest has underwater ground on both sides of it. */
  boundaryPass: boolean;
  /** Fraction of horizontal steps where elevation increases with price. */
  monoFraction: number;
  /** True when elevation rises everywhere, i.e. the map is an honest ramp. */
  crestMonotone: boolean;
  /** How far each feature moves across the full dwell axis. */
  drift: Drift;
}

export interface PassPoint {
  price: number;
  dwellDays: number;
  elevation: number;
  column: number;
  row: number;
}

export interface Drift {
  crestColumns: number;
  lowerShorelineColumns: number;
  upperShorelineColumns: number;
}

export function extractFeatures(r: Raster): Features {
  const { width, height } = r.window;

  const binderSet = new Set<number>();
  for (let i = 0; i < r.argmin.length; i++) {
    const a = r.argmin[i]!;
    if (a >= 0) binderSet.add(a);
  }

  const changeMask = buildChangeMask(r);
  const underwater = new Uint8Array(width * height);
  for (let i = 0; i < r.z.length; i++) underwater[i] = r.z[i]! < 0 ? 1 : 0;

  const pass = findPass(r);

  return {
    binders: [...binderSet].sort((x, y) => x - y).map((i) => r.deploymentIds[i] ?? `#${i}`),
    foldLines8: countComponents(changeMask, width, height, 8),
    foldLines4: countComponents(changeMask, width, height, 4),
    basins: countComponents(underwater, width, height, 4),
    pass,
    boundaryPass: pass !== null && hasUnderwaterBothSides(r, pass),
    monoFraction: monotoneFraction(r),
    crestMonotone: isRamp(r),
    drift: measureDrift(r),
  };
}

/** Cells where the binding deployment differs from the neighbour right or above. */
function buildChangeMask(r: Raster): Uint8Array {
  const { width, height } = r.window;
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const at = row * width + col;
      const here = r.argmin[at]!;
      const right = col + 1 < width ? r.argmin[at + 1]! : here;
      const up = row + 1 < height ? r.argmin[at + width]! : here;
      if (here !== right || here !== up) mask[at] = 1;
    }
  }
  return mask;
}

/**
 * Connected-component count over a binary mask.
 *
 * Fold lines are counted 8-connected because a near-vertical crease steps
 * diagonally and 4-connectivity shatters it into dozens of fragments. Basins
 * are counted 4-connected because two pools touching only at a corner are two
 * pools. Both numbers are reported so the difference is visible rather than a
 * hidden choice.
 */
function countComponents(mask: Uint8Array, width: number, height: number, conn: 4 | 8): number {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  let components = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    components++;
    stack.push(start);
    seen[start] = 1;

    while (stack.length > 0) {
      const at = stack.pop()!;
      const row = (at / width) | 0;
      const col = at % width;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (conn === 4 && dr !== 0 && dc !== 0) continue;
          const nr = row + dr;
          const nc = col + dc;
          if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
          const n = nr * width + nc;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
  }
  return components;
}

/** Highest ground in each dwell row, then the worst of those rows. */
function findPass(r: Raster): PassPoint | null {
  const { width, height } = r.window;
  let worstCrest = Number.POSITIVE_INFINITY;
  let bestRow = -1;
  let bestCol = -1;

  for (let row = 0; row < height; row++) {
    let crest = Number.NEGATIVE_INFINITY;
    let crestCol = -1;
    for (let col = 0; col < width; col++) {
      const z = r.z[row * width + col]!;
      if (Number.isFinite(z) && z > crest) {
        crest = z;
        crestCol = col;
      }
    }
    if (crestCol >= 0 && crest < worstCrest) {
      worstCrest = crest;
      bestRow = row;
      bestCol = crestCol;
    }
  }

  if (bestRow < 0) return null;
  return {
    price: priceAt(r.window, bestCol),
    dwellDays: dwellAt(r.window, bestRow),
    elevation: worstCrest,
    column: bestCol,
    row: bestRow,
  };
}

/** A crest is only a pass if you can drown on either side of it. */
function hasUnderwaterBothSides(r: Raster, pass: PassPoint): boolean {
  const { width } = r.window;
  const base = pass.row * width;
  let left = false;
  let right = false;
  for (let col = 0; col < pass.column; col++) if (r.z[base + col]! < 0) left = true;
  for (let col = pass.column + 1; col < width; col++) if (r.z[base + col]! < 0) right = true;
  return left && right;
}

/** Share of horizontal steps on which elevation rises with price. */
function monotoneFraction(r: Raster): number {
  const { width, height } = r.window;
  let rising = 0;
  let total = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col + 1 < width; col++) {
      const a = r.z[row * width + col]!;
      const b = r.z[row * width + col + 1]!;
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      total++;
      if (b > a) rising++;
    }
  }
  return total === 0 ? 0 : rising / total;
}

function isRamp(r: Raster): boolean {
  return monotoneFraction(r) >= 1;
}

/** How far the crest and each shoreline move between dwell zero and the top. */
function measureDrift(r: Raster): Drift {
  const { height } = r.window;
  const bottom = 0;
  const top = height - 1;
  return {
    crestColumns: Math.abs(crestColumn(r, top) - crestColumn(r, bottom)),
    lowerShorelineColumns: Math.abs(shoreColumn(r, top, "lower") - shoreColumn(r, bottom, "lower")),
    upperShorelineColumns: Math.abs(shoreColumn(r, top, "upper") - shoreColumn(r, bottom, "upper")),
  };
}

function crestColumn(r: Raster, row: number): number {
  const { width } = r.window;
  let best = Number.NEGATIVE_INFINITY;
  let col = 0;
  for (let c = 0; c < width; c++) {
    const z = r.z[row * width + c]!;
    if (Number.isFinite(z) && z > best) {
      best = z;
      col = c;
    }
  }
  return col;
}

/**
 * Sub-pixel shoreline position, found by linear interpolation across the sign
 * change so that drift smaller than one pixel is still measurable and can be
 * reported honestly rather than rounded away to zero.
 */
function shoreColumn(r: Raster, row: number, which: "lower" | "upper"): number {
  const { width } = r.window;
  const base = row * width;
  const range = which === "lower"
    ? [...Array(width - 1).keys()]
    : [...Array(width - 1).keys()].reverse();

  for (const c of range) {
    const a = r.z[base + c]!;
    const b = r.z[base + c + 1]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
      return c + a / (a - b);
    }
  }
  return which === "lower" ? 0 : width - 1;
}
