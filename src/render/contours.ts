import type { Raster } from "../field/raster";

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ContourLine {
  level: number;
  segments: Segment[];
}

/**
 * Marching squares, with linear interpolation along each edge.
 *
 * Interpolating rather than snapping to cell centres is what makes a contour
 * read as a curve instead of a staircase, and it is also what lets the shoreline
 * be located to a fraction of a pixel. Coordinates come back in raster space:
 * x in columns, y in rows, origin bottom-left, matching `priceAt` and `dwellAt`.
 */
export function contour(r: Raster, level: number): ContourLine {
  const { width, height } = r.window;
  const segments: Segment[] = [];

  for (let row = 0; row + 1 < height; row++) {
    for (let col = 0; col + 1 < width; col++) {
      // Corners, counter-clockwise from bottom-left.
      const bl = at(r, col, row);
      const br = at(r, col + 1, row);
      const tr = at(r, col + 1, row + 1);
      const tl = at(r, col, row + 1);
      if (!Number.isFinite(bl) || !Number.isFinite(br) || !Number.isFinite(tr) || !Number.isFinite(tl)) {
        continue;
      }

      let code = 0;
      if (bl > level) code |= 1;
      if (br > level) code |= 2;
      if (tr > level) code |= 4;
      if (tl > level) code |= 8;
      if (code === 0 || code === 15) continue;

      const bottom = { x: col + frac(bl, br, level), y: row };
      const right = { x: col + 1, y: row + frac(br, tr, level) };
      const top = { x: col + frac(tl, tr, level), y: row + 1 };
      const left = { x: col, y: row + frac(bl, tl, level) };

      const push = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });

      switch (code) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(top, right); break;
        case 6: case 9: push(bottom, top); break;
        case 7: case 8: push(left, top); break;
        // Saddles. Resolved by the average of the four corners, which decides
        // whether the two arcs pass or connect. Guessing here is what produces
        // contour lines that cross each other.
        case 5: {
          const middle = (bl + br + tr + tl) / 4;
          if (middle > level) { push(left, top); push(bottom, right); }
          else { push(left, bottom); push(top, right); }
          break;
        }
        case 10: {
          const middle = (bl + br + tr + tl) / 4;
          if (middle > level) { push(left, bottom); push(top, right); }
          else { push(left, top); push(bottom, right); }
          break;
        }
      }
    }
  }

  return { level, segments };
}

/**
 * A set of contours across the range the terrain actually occupies, plus the
 * shoreline at zero.
 *
 * Zero is always included and is never merely one line among many: it is the
 * only level on the map that corresponds to an event rather than a reading.
 * The interval is chosen from the range so that a book with a hand's breadth
 * of headroom gets as many lines as one with a mile of it.
 */
export function contourSet(r: Raster, interval?: number, ceiling?: number): ContourLine[] {
  const top = ceiling ?? Math.max(0.05, r.range.max);
  const floor = Math.max(r.range.min, -0.6);
  const step = interval ?? niceInterval(top - floor, 14);

  const lines: ContourLine[] = [contour(r, 0)];
  for (let level = step; level <= top; level += step) {
    lines.push(contour(r, Number(level.toFixed(6))));
  }
  for (let level = -step; level >= floor; level -= step) {
    lines.push(contour(r, Number(level.toFixed(6))));
  }
  return lines;
}

/** The roundest 1, 2 or 5 times a power of ten that gives about `target` lines. */
export function niceInterval(span: number, target: number): number {
  if (!Number.isFinite(span) || span <= 0) return 0.05;
  const rough = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const multiple of [1, 2, 5, 10]) {
    if (multiple * magnitude >= rough) return multiple * magnitude;
  }
  return 10 * magnitude;
}

function at(r: Raster, col: number, row: number): number {
  return r.z[row * r.window.width + col]!;
}

function frac(a: number, b: number, level: number): number {
  const d = b - a;
  if (d === 0) return 0.5;
  return Math.min(1, Math.max(0, (level - a) / d));
}
