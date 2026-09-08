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
  const best = new Map<number, { col: number; row: number; z: number; count: number }>();

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const at = row * width + col;
      const which = r.argmin[at]!;
      if (which < 0) continue;
      const z = r.z[at]!;
      if (!Number.isFinite(z)) continue;

      const held = best.get(which);
      if (!held) {
        best.set(which, { col, row, z, count: 1 });
        continue;
      }
      held.count++;
      if (z > held.z) {
        held.z = z;
        held.col = col;
        held.row = row;
      }
    }
  }

  const total = width * height;
  return [...best.entries()]
    .map(([index, held]) => ({
      deploymentId: r.deploymentIds[index] ?? `#${index}`,
      col: held.col,
      row: held.row,
      elevation: held.z,
      share: held.count / total,
    }))
    .sort((a, b) => b.share - a.share);
}
