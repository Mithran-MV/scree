import type { WorldPaint } from "./pixels";
import { JETTY, MENHIR, blit } from "./sprites";

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
