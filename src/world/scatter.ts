import type { WorldPaint } from "./pixels";
import { BOULDER, BROADLEAF, BUSH, CAIRN, FLOWERS, PINE, REEDS, STUMP } from "./sprites";

export type ScatterKind =
  | "pine"
  | "broadleaf"
  | "boulder"
  | "flowers"
  | "reeds"
  | "bush"
  | "cairn"
  | "stump";

export interface ScatterItem {
  kind: ScatterKind;
  x: number;
  y: number;
}

export const SCATTER_ART: Record<ScatterKind, string[]> = {
  pine: PINE,
  broadleaf: BROADLEAF,
  boulder: BOULDER,
  flowers: FLOWERS,
  reeds: REEDS,
  bush: BUSH,
  cairn: CAIRN,
  stump: STUMP,
};

/** Deterministic hash. Never Math.random: the world must not reshuffle on a repaint. */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Populate the landscape.
 *
 * What grows where is decided by the terrain itself: reeds in the damp ground
 * along the waterline, flowers and broadleaf on the meadows, pine on the upper
 * pasture, boulders on the bare scree. So the scatter is a second, softer
 * reading of the same elevation the biomes came from, and a wallet whose ground
 * is mostly drowned genuinely has less growing on it.
 */
export function scatterWorld(
  paint: WorldPaint,
  keepOut: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
): ScatterItem[] {
  const { width: W, height: H } = paint;
  const items: ScatterItem[] = [];
  const step = 5;

  for (let gy = 2; gy < H - 6; gy += step) {
    for (let gx = 2; gx < W - 6; gx += step) {
      const jitter = hash(gx, gy, 1);
      if (jitter > 0.74) continue; // thin it out, or the world reads as a lawn

      const x = gx + Math.floor(hash(gx, gy, 2) * (step - 1));
      const y = gy + Math.floor(hash(gx, gy, 3) * (step - 1));
      const i = y * W + x;
      if (paint.wet[i]) continue;

      if (keepOut.some((r) => x >= r.x - 2 && x < r.x + r.w + 2 && y >= r.y - 2 && y < r.y + r.h + 2)) {
        continue;
      }

      const height = Math.min(1, Math.max(0, paint.elevation[i]! / paint.ceiling));
      const nearWater = isNearWater(paint, x, y, 3);

      // What grows where. Each band mixes two or three species on a hash so the
      // cover reads as country rather than as a planted grid.
      const pick = hash(x, y, 4);
      let kind: ScatterKind;
      if (nearWater) kind = pick > 0.7 ? "bush" : "reeds";
      else if (height > 0.9) kind = pick > 0.62 ? "cairn" : "boulder";
      else if (height > 0.74) kind = pick > 0.5 ? "boulder" : "pine";
      else if (height > 0.48) kind = pick > 0.82 ? "stump" : "pine";
      else if (height > 0.24) kind = pick > 0.55 ? "broadleaf" : pick > 0.3 ? "pine" : "bush";
      else kind = pick > 0.62 ? "flowers" : pick > 0.34 ? "bush" : "broadleaf";

      items.push({ kind, x, y });
    }
  }

  // Painter's order: things lower on screen are nearer, so they draw last.
  return items.sort((a, b) => a.y - b.y);
}

function isNearWater(paint: WorldPaint, x: number, y: number, radius: number): boolean {
  const { width: W, height: H } = paint;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (paint.wet[ny * W + nx]) return true;
    }
  }
  return false;
}
