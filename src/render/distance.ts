import type { Raster } from "../field/raster";

/** Chamfer weights. 3-4 keeps the error under about 8% of true Euclidean. */
const ORTHO = 3;
const DIAG = 4;
const SCALE = 1 / 3;

/**
 * Distance from every cell to the nearest set cell in `mask`, in cell units.
 *
 * A two-pass chamfer rather than an exact Euclidean transform: this runs on
 * every field rebuild and feeds decisions that are all thresholds — keep this
 * hachure or drop it, place this label here or there — where a few percent of
 * error changes nothing a viewer could see.
 */
export function chamfer(mask: Uint8Array, width: number, height: number): Float32Array {
  const BIG = 1e9;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : BIG;

  // Forward: top-left to bottom-right, reading the neighbours already settled.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let best = d[i]!;
      if (y > 0) {
        best = Math.min(best, d[i - width]! + ORTHO);
        if (x > 0) best = Math.min(best, d[i - width - 1]! + DIAG);
        if (x + 1 < width) best = Math.min(best, d[i - width + 1]! + DIAG);
      }
      if (x > 0) best = Math.min(best, d[i - 1]! + ORTHO);
      d[i] = best;
    }
  }

  // Backward: bottom-right to top-left, closing the other half of the cone.
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let best = d[i]!;
      if (y + 1 < height) {
        best = Math.min(best, d[i + width]! + ORTHO);
        if (x > 0) best = Math.min(best, d[i + width - 1]! + DIAG);
        if (x + 1 < width) best = Math.min(best, d[i + width + 1]! + DIAG);
      }
      if (x + 1 < width) best = Math.min(best, d[i + 1]! + ORTHO);
      d[i] = best;
    }
  }

  for (let i = 0; i < d.length; i++) d[i] = d[i]! >= BIG ? Infinity : d[i]! * SCALE;
  return d;
}

/**
 * Cells that touch the shoreline, meaning the sign of elevation changes between
 * them and a neighbour. Marking both sides of the crossing keeps the set closed
 * so the transform cannot leak through a diagonal.
 */
export function shorelineMask(r: Raster): Uint8Array {
  const { width, height } = r.window;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const z = r.z[i]!;
      if (!Number.isFinite(z)) continue;
      const wet = z < 0;
      if (x + 1 < width && Number.isFinite(r.z[i + 1]!) && r.z[i + 1]! < 0 !== wet) {
        mask[i] = 1;
        mask[i + 1] = 1;
      }
      if (y + 1 < height && Number.isFinite(r.z[i + width]!) && r.z[i + width]! < 0 !== wet) {
        mask[i] = 1;
        mask[i + width] = 1;
      }
    }
  }
  return mask;
}

/** Distance in cells from every cell to the shoreline. */
export function distanceToShore(r: Raster): Float32Array {
  return chamfer(shorelineMask(r), r.window.width, r.window.height);
}

/** Distance in cells from every cell to the nearest fold line. */
export function distanceToFold(r: Raster, changeMask: Uint8Array): Float32Array {
  return chamfer(changeMask, r.window.width, r.window.height);
}
