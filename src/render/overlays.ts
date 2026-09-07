import type { Raster } from "../field/raster";

/**
 * The crest column in each dwell row, i.e. the line of highest ground.
 *
 * Traced row by row rather than assumed vertical, because on a book with an
 * affine leg the ridge genuinely leans as interest accrues, and drawing it
 * straight would hide that.
 */
export function ridgePath(r: Raster): { col: number; row: number }[] {
  const { width, height } = r.window;
  const path: { col: number; row: number }[] = [];
  for (let row = 0; row < height; row++) {
    let best = Number.NEGATIVE_INFINITY;
    let bestCol = -1;
    for (let col = 0; col < width; col++) {
      const z = r.z[row * width + col]!;
      if (Number.isFinite(z) && z > best) {
        best = z;
        bestCol = col;
      }
    }
    if (bestCol >= 0) path.push({ col: bestCol, row });
  }
  return path;
}

/**
 * Where the binding deployment hands over, traced per row.
 *
 * One path per handover, keyed by the pair of deployments involved, so the map
 * can label a crease with the two names rather than drawing an anonymous line.
 */
export interface FoldPath {
  from: string;
  to: string;
  points: { col: number; row: number }[];
}

export function foldPaths(r: Raster): FoldPath[] {
  const { width, height } = r.window;
  const byPair = new Map<string, FoldPath>();

  for (let row = 0; row < height; row++) {
    for (let col = 0; col + 1 < width; col++) {
      const here = r.argmin[row * width + col]!;
      const next = r.argmin[row * width + col + 1]!;
      if (here === next || here < 0 || next < 0) continue;
      const from = r.deploymentIds[here] ?? `#${here}`;
      const to = r.deploymentIds[next] ?? `#${next}`;
      const key = `${from}>${to}`;
      let path = byPair.get(key);
      if (!path) {
        path = { from, to, points: [] };
        byPair.set(key, path);
      }
      path.points.push({ col: col + 0.5, row });
    }
  }

  return [...byPair.values()];
}
