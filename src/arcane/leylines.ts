import type { Raster } from "../field/raster";
import { contourSet } from "../render/contours";
import { foldPaths, ridgePath } from "../render/overlays";
import { ARCANE, css } from "./palette";

type Ctx = CanvasRenderingContext2D;
type Project = (col: number, row: number) => [number, number];

/**
 * The readings, drawn as light.
 *
 * Every line here is geometry already computed from the field, only lit instead
 * of inked: the contours are the true isolines, the ley-veins are the argmin
 * boundaries where one lending deployment stops being the thing that kills you
 * and another starts, and the waterline is the true zero crossing. A chart with
 * no handover has no veins to draw and cannot pretend otherwise.
 */

/** Stroke a set of segments once, with an optional bloom pass underneath. */
function strokeSegments(
  ctx: Ctx,
  segments: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>,
  project: Project,
  color: string,
  width: number,
  blur: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  if (blur > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }
  ctx.beginPath();
  for (const s of segments) {
    const [x1, y1] = project(s.x1, s.y1);
    const [x2, y2] = project(s.x2, s.y2);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawContours(
  ctx: Ctx,
  r: Raster,
  project: Project,
  interval: number,
  ceiling: number,
): void {
  for (const line of contourSet(r, interval, ceiling)) {
    const shore = line.level === 0;
    const index = !shore && Math.abs(Math.round(line.level / interval)) % 5 === 0;
    // Below the waterline the chart goes quiet: that ground is one fact,
    // already fatal, and cutting every level there buries the veins over it.
    if (line.level < 0 && !index) continue;

    if (shore) {
      // The only edge on the chart that marks an event rather than a level.
      strokeSegments(ctx, line.segments, project, css(ARCANE.hazardGlow, 0.5), 6, 18);
      strokeSegments(ctx, line.segments, project, css(ARCANE.hazard, 0.95), 1.7, 8);
    } else if (index) {
      strokeSegments(ctx, line.segments, project, css(ARCANE.ley, 0.42), 1.5, 6);
    } else {
      strokeSegments(ctx, line.segments, project, css(ARCANE.leyPale, 0.4), 0.7, 0);
    }
  }
}

/**
 * The ley-veins: the boundaries of the argmin partition.
 *
 * `pulse` runs 0..1 and brightens the veins in a slow travelling wave, so the
 * chart reads as live without any value on it changing.
 */
export function drawLeyVeins(ctx: Ctx, r: Raster, project: Project, pulse: number): void {
  for (const fold of foldPaths(r)) {
    const segments = [];
    for (let i = 1; i < fold.points.length; i++) {
      const a = fold.points[i - 1]!;
      const b = fold.points[i]!;
      segments.push({ x1: a.col, y1: a.row, x2: b.col, y2: b.row });
    }
    if (segments.length === 0) continue;
    const swell = 0.62 + 0.38 * pulse;
    strokeSegments(ctx, segments, project, css(ARCANE.leyBright, 0.22 * swell), 9, 26);
    strokeSegments(ctx, segments, project, css(ARCANE.ley, 0.9 * swell), 2.4, 14);
    strokeSegments(ctx, segments, project, css(ARCANE.leyBright, swell), 0.9, 4);
  }
}

export function drawRidge(ctx: Ctx, r: Raster, project: Project): void {
  const ridge = ridgePath(r);
  const segments = [];
  for (let i = 1; i < ridge.length; i++) {
    const a = ridge[i - 1]!;
    const b = ridge[i]!;
    segments.push({ x1: a.col, y1: a.row, x2: b.col, y2: b.row });
  }
  if (segments.length === 0) return;
  ctx.save();
  ctx.setLineDash([6, 7]);
  strokeSegments(ctx, segments, project, css(ARCANE.aether, 0.5), 1.2, 8);
  ctx.restore();
}
