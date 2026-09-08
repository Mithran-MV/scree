/**
 * Dotting for unordered segment soup.
 *
 * STANDING PROHIBITION, and the reason this module exists: the contour tracer
 * emits segments per cell and never chains them into polylines. So anything
 * that depends on position *along* a line is meaningless when applied to its
 * output — never dash it, never phase-offset it, never taper it along its
 * length, never label along it, never fill from it. `setLineDash` restarts its
 * phase on every two-point segment and produces ragged noise that looks like a
 * rendering fault.
 *
 * The way out is to stop deriving phase from the line and derive it from the
 * plane instead. Every dot lands on a lattice fixed in absolute coordinates, so
 * independent segments that happen to be collinear drop their dots into the
 * same slots and read as one continuous dotted rule, with no chaining pass and
 * no ordering assumption anywhere.
 */

export interface DotSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DotOptions {
  /** Spacing between dot centres, in screen pixels. */
  step?: number;
  /** Side length of each dot, in screen pixels. */
  size?: number;
}

type Project = (x: number, y: number) => [number, number];

/**
 * Accumulate every dot into one path and fill once. Squares rather than arcs:
 * below about 1.5px the two are visually identical and `rect` is several times
 * faster, which matters at a few thousand marks per frame.
 */
export function dotSegments(
  ctx: { beginPath(): void; rect(x: number, y: number, w: number, h: number): void; fill(): void },
  segments: readonly DotSegment[],
  project: Project,
  options: DotOptions = {},
): number {
  const step = options.step ?? 4;
  const size = options.size ?? 1.2;
  const half = size / 2;
  let drawn = 0;

  ctx.beginPath();
  for (const s of segments) {
    const [ax, ay] = project(s.x1, s.y1);
    const [bx, by] = project(s.x2, s.y2);
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    // Phase from absolute position, never from the segment's index or its own
    // start. This is the whole trick.
    const phase = mod(ax * 0.37 + ay * 0.61, step);
    for (let t = phase; t <= length; t += step) {
      const f = t / length;
      ctx.rect(ax + dx * f - half, ay + dy * f - half, size, size);
      drawn++;
    }
  }
  ctx.fill();
  return drawn;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
