import type { Raster } from "../field/raster";


export interface Landmark {
  deploymentId: string;
  /** Cell the marker sits on. */
  col: number;
  row: number;
  /** Elevation at that cell, before any vertical scaling. */
  elevation: number;
  /** How much of the map this deployment binds, 0..1. */
  share: number;
}

/**
 * One landmark per deployment that binds somewhere, placed on the highest
 * ground inside its own territory.
 *
 * The territories are the argmin partition: the region where a given lending
 * deployment is the one closest to killing you. Naming them on the map turns a
 * statistic nobody reads into a place you can point at, and putting the marker
 * on the high ground of each territory means it is never buried underwater or
 * pushed onto a boundary it does not own.
 */
export function findLandmarks(r: Raster): Landmark[] {
  const { width, height } = r.window;

  interface Tally {
    sumCol: number;
    sumRow: number;
    dry: number;
    count: number;
    best: { col: number; row: number; z: number } | null;
  }
  const tally = new Map<number, Tally>();

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const at = row * width + col;
      const which = r.argmin[at]!;
      if (which < 0) continue;
      const z = r.z[at]!;
      if (!Number.isFinite(z)) continue;

      let held = tally.get(which);
      if (!held) {
        held = { sumCol: 0, sumRow: 0, dry: 0, count: 0, best: null };
        tally.set(which, held);
      }
      held.count++;
      if (z < 0) continue;
      held.sumCol += col;
      held.sumRow += row;
      held.dry++;
      if (!held.best || z > held.best.z) held.best = { col, row, z };
    }
  }

  const total = width * height;
  const marks: Landmark[] = [];

  for (const [index, held] of tally) {
    if (!held.best) continue;

    // The centre of the dry ground a deployment rules, not its summit. Pinning
    // each settlement to its highest point stacked all of them along the bottom
    // edge, because with no interest accrued yet the ground is always highest
    // at dwell zero. The centroid spreads them across the country they hold.
    let col = Math.round(held.sumCol / Math.max(1, held.dry));
    let row = Math.round(held.sumRow / Math.max(1, held.dry));

    // The centroid of an L-shaped or split territory can fall outside it, or
    // underwater. Walk out to the nearest cell that is genuinely both.
    if (!ownsDryCell(r, index, col, row)) {
      const found = nearestOwned(r, index, col, row);
      if (found) {
        col = found.col;
        row = found.row;
      } else {
        col = held.best.col;
        row = held.best.row;
      }
    }

    marks.push({
      deploymentId: r.deploymentIds[index] ?? `#${index}`,
      col,
      row,
      elevation: r.z[row * width + col]!,
      share: held.count / total,
    });
  }

  return marks.sort((a, b) => b.share - a.share);
}

function ownsDryCell(r: Raster, index: number, col: number, row: number): boolean {
  const { width, height } = r.window;
  if (col < 0 || col >= width || row < 0 || row >= height) return false;
  const at = row * width + col;
  return r.argmin[at] === index && Number.isFinite(r.z[at]!) && r.z[at]! >= 0;
}

/** Spiral outward until a cell this deployment owns above water turns up. */
function nearestOwned(
  r: Raster,
  index: number,
  col: number,
  row: number,
): { col: number; row: number } | null {
  const { width, height } = r.window;
  const limit = Math.max(width, height);
  for (let radius = 1; radius < limit; radius++) {
    for (let d = -radius; d <= radius; d++) {
      const candidates = [
        { col: col + d, row: row - radius },
        { col: col + d, row: row + radius },
        { col: col - radius, row: row + d },
        { col: col + radius, row: row + d },
      ];
      for (const c of candidates) {
        if (ownsDryCell(r, index, c.col, c.row)) return c;
      }
    }
  }
  return null;
}
