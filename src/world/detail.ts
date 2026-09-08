import type { WorldPaint } from "./pixels";
import {
  BOAT,
  BOAT_PALETTE,
  FIELD,
  FIELD_PALETTE,
  JETTY,
  MENHIR,
  RUIN,
  RUIN_PALETTE,
  blit,
} from "./sprites";

type Ctx = CanvasRenderingContext2D;

const TRACK = "#8a7550";
const TRACK_EDGE = "#6d5b3d";
const TIMBER = "#5a4429";

/**
 * A track worn between the settlements.
 *
 * Nothing about the risk arithmetic requires a road. It is here because an
 * inhabited landscape has paths in it and an uninhabited one does not, and the
 * cheapest way to make a map read as a place people use is to show the route
 * between the places they use. It follows the ground: at every step it takes
 * the driest cell available, so it climbs over the ridge rather than through
 * the water, the way a real track would.
 */
export function drawTrack(
  ctx: Ctx,
  paint: WorldPaint,
  stops: ReadonlyArray<{ x: number; y: number }>,
): void {
  if (stops.length < 2) return;
  const ordered = [...stops].sort((a, b) => a.x - b.x);

  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1]!;
    const to = ordered[i]!;
    const steps = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y)));

    let y = from.y;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const x = Math.round(from.x + (to.x - from.x) * f);
      const want = from.y + (to.y - from.y) * f;

      // Drift one row at a time toward the line, but never onto water.
      const candidates = [Math.round(want), Math.round(y), y - 1, y + 1];
      let chosen = y;
      for (const c of candidates) {
        if (c < 1 || c >= paint.height - 1) continue;
        if (!paint.wet[c * paint.width + x]) {
          chosen = c;
          break;
        }
      }
      y = chosen;

      if (paint.wet[y * paint.width + x]) continue;
      ctx.fillStyle = TRACK_EDGE;
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillStyle = TRACK;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** A jetty pushed out from the nearest shore below a settlement. */
export function drawJetty(ctx: Ctx, paint: WorldPaint, x: number, fromY: number): void {
  const { width: W, height: H } = paint;
  if (x < 1 || x >= W - 1) return;

  // Walk downhill on screen until the water starts.
  let y = fromY;
  while (y < H - 1 && !paint.wet[y * W + x]) y++;
  if (y >= H - 2) return;

  blit(ctx, JETTY, { b: TIMBER }, x - 1, y);
  ctx.fillStyle = "rgba(20,18,14,0.22)";
  ctx.fillRect(x - 1, y + 5, 2, 1);
}

/**
 * Standing stones, planted only where the map has a genuine saddle.
 *
 * The pass is the one place on a mixed book where the ground rises between two
 * drownings, so it is the one place worth marking on the ground itself. A book
 * with no pass gets no stones, and the absence is the correct reading.
 */
export function drawMenhirs(ctx: Ctx, x: number, y: number): void {
  const palette = { s: "#9a927f", r: "#6d6759" };
  blit(ctx, MENHIR, palette, x - 5, y - 3);
  blit(ctx, MENHIR, palette, x + 3, y - 1);
  ctx.fillStyle = "rgba(20,18,14,0.24)";
  ctx.fillRect(x - 5, y + 2, 3, 1);
  ctx.fillRect(x + 3, y + 4, 3, 1);
}

/** A banner on a holdfast roof, tinted per settlement. */
export function drawBanner(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.fillStyle = "#4a4238";
  ctx.fillRect(x, y - 5, 1, 6);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y - 5, 4, 3);
  ctx.fillStyle = "rgba(20,18,14,0.28)";
  ctx.fillRect(x + 1, y - 2, 4, 1);
}

export const BANNER_COLOURS = ["#b4472c", "#3f6e94", "#c2a34a", "#6a8f56"];

/**
 * Streams, traced down the true fall line.
 *
 * Water runs downhill, and downhill here is the same gradient the whole map is
 * built on. So a stream is not decoration: each one is a path a falling price
 * would actually take across this surface, drawn from the high ground until it
 * reaches the sea. On a wallet with a ridge they fork away on both sides, which
 * is the same fact the terrain is trying to tell you, said in water.
 */
export function drawStreams(ctx: Ctx, paint: WorldPaint, seedCount = 22): void {
  const { width: W, height: H, elevation, wet } = paint;
  const at = (x: number, y: number) => y * W + x;

  const seeds: { x: number; y: number; z: number }[] = [];
  for (let y = 4; y < H - 4; y += 7) {
    for (let x = 4; x < W - 4; x += 7) {
      if (wet[at(x, y)]) continue;
      seeds.push({ x, y, z: elevation[at(x, y)]! });
    }
  }
  seeds.sort((a, b) => b.z - a.z);

  const drawn = new Set<number>();
  let cut = 0;

  for (const seed of seeds) {
    if (cut >= seedCount) break;
    if (drawn.has(at(seed.x, seed.y))) continue;

    const path: { x: number; y: number }[] = [];
    let x = seed.x;
    let y = seed.y;

    for (let step = 0; step < W; step++) {
      path.push({ x, y });
      if (wet[at(x, y)]) break;

      // Steepest descent over the eight neighbours.
      let bestX = x;
      let bestY = y;
      let bestZ = elevation[at(x, y)]!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 1 || nx >= W - 1 || ny < 1 || ny >= H - 1) continue;
          const nz = elevation[at(nx, ny)]!;
          if (nz < bestZ) {
            bestZ = nz;
            bestX = nx;
            bestY = ny;
          }
        }
      }
      // A pit with no lower neighbour ends the stream rather than looping.
      if (bestX === x && bestY === y) break;
      x = bestX;
      y = bestY;
    }

    // A trickle that dies after three cells is noise, not a watercourse.
    if (path.length < 8) continue;
    cut++;
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      drawn.add(at(p.x, p.y));
      // A watercourse widens as it runs, so the lower reaches read as a river
      // and the headwaters as a trickle.
      const grown = i > path.length * 0.55;
      ctx.fillStyle = "rgba(38,62,68,0.55)";
      ctx.fillRect(p.x, p.y + 1, 1, 1);
      ctx.fillStyle = "#77b3ba";
      ctx.fillRect(p.x, p.y, 1, 1);
      if (grown && p.y > 0) {
        ctx.fillStyle = "#5e959d";
        ctx.fillRect(p.x, p.y - 1, 1, 1);
      }
    }
  }
}

/**
 * Ruins in the shallows and hulls on the strand.
 *
 * The drowned ground is where a wallet is liquidated, so the shallows are the
 * places somebody already lost. Standing a few broken walls there says what the
 * map is for without a word of copy.
 */
export function drawWreckage(ctx: Ctx, paint: WorldPaint): void {
  const { width: W, height: H, elevation, wet } = paint;
  const hash = (x: number, y: number, salt: number) => {
    let h = Math.imul(x, 668265263) ^ Math.imul(y, 374761393) ^ Math.imul(salt, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  for (let y = 5; y < H - 6; y += 9) {
    for (let x = 5; x < W - 7; x += 9) {
      const i = y * W + x;
      const roll = hash(x, y, 11);

      if (wet[i]) {
        // Only the shallows: deep water hides everything anyway.
        const depth = -elevation[i]!;
        if (depth > 0.16 || roll > 0.22) continue;
        blit(ctx, RUIN, RUIN_PALETTE, x, y);
      } else if (roll > 0.94 && nearShore(paint, x, y)) {
        blit(ctx, BOAT, BOAT_PALETTE, x, y);
      }
    }
  }
}

function nearShore(paint: WorldPaint, x: number, y: number): boolean {
  const { width: W, height: H, wet } = paint;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (wet[ny * W + nx]) return true;
    }
  }
  return false;
}

/** Tilled ground laid beside a settlement, on gentle dry cells only. */
export function drawFields(ctx: Ctx, paint: WorldPaint, x: number, y: number): void {
  const { width: W, height: H, wet } = paint;
  for (const [dx, dy] of [
    [-9, 2],
    [8, 3],
  ] as const) {
    const fx = x + dx;
    const fy = y + dy;
    if (fx < 1 || fx + 6 >= W || fy < 1 || fy + 4 >= H) continue;
    if (wet[fy * W + fx] || wet[(fy + 3) * W + fx + 5]) continue;
    blit(ctx, FIELD, FIELD_PALETTE, fx, fy);
  }
}
