import type { Raster } from "../field/raster";
import { extractFeatures } from "../field/features";
import { findLandmarks } from "../world/landmarks";
import { contour } from "../render/contours";
import {
  CONIFER_CLUMP,
  CONIFER_MID,
  CONIFER_TALL,
  HILL,
} from "../arcane/terrain-sprites";
import {
  chartSizeFor,
  citadelFor,
  leyNetwork,
  placeForest,
  placeFurniture,
  sampleField,
  WARD_CIRCLE,
  type Node,
  type Placed,
} from "../arcane/pixelchart";

export interface BakedChart {
  width: number;
  height: number;
  /** Health-factor headroom the top of the land represents. */
  ceiling: number;
  /** The liquidation line: the zero contour, as segments in chart pixels. */
  shore: { x1: number; y1: number; x2: number; y2: number }[];
  /** Routes between the seats, in chart pixels. */
  leyLines: Node[][];
  /** Where each citadel's beacon burns. */
  beacons: Node[];
  /** Seat plaque anchors, in chart pixels. */
  seats: { id: string; share: number; at: Node }[];
  pass: Node | null;
  /** Hills, in chart pixels, for the world to stand boulder sprites on. */
  relief: { kind: "hill"; x: number; y: number }[];
  /** The forest, in chart pixels, drawn by the world as tree sprites. */
  forest: { kind: "tall" | "mid" | "low" | "clump"; x: number; y: number }[];
  /** True where a chart pixel is underwater, so the world knows where you drown. */
  wet: Uint8Array;
  /** Elevation per chart pixel. */
  z: Float32Array;
}

/**
 * Bake the chart once.
 *
 * Nothing is painted here any more. The bake samples the field onto the chart
 * grid and works out where everything stands — seats, forest, hills, the ley
 * routes, the liquidation line — and the world draws it all from the packs.
 * Every position still comes out of the measured field.
 */
export function bakeChart(raster: Raster, aspect: number): BakedChart {
  const size = chartSizeFor(aspect);
  const field = sampleField(raster, size);
  const features = extractFeatures(raster);
  const landmarks = findLandmarks(raster);

  const win = raster.window;
  const toChart = (col: number, row: number): Node => ({
    x: Math.round((col / (win.width - 1)) * (size.width - 1)),
    y: Math.round((1 - row / (win.height - 1)) * (size.height - 1)),
  });

  const seatSprites: Placed[] = landmarks.map((mark) => {
    const sprite = citadelFor(mark.share);
    const at = toChart(mark.col, mark.row);
    const w = sprite.art[0]?.length ?? 0;
    const h = sprite.art.length;
    return {
      sprite,
      x: Math.min(size.width - w - 1, Math.max(1, at.x - (w >> 1))),
      y: Math.min(size.height - h - 1, Math.max(1, at.y - h)),
    };
  });

  const pass =
    features.pass && features.boundaryPass
      ? toChart(features.pass.column, features.pass.row)
      : null;

  const wardAt = pass
    ? {
        x: Math.min(size.width - 10, Math.max(1, pass.x - 4)),
        y: Math.min(size.height - 8, Math.max(1, pass.y - 3)),
      }
    : null;

  const keepOut = [...seatSprites];
  if (wardAt) keepOut.push({ sprite: WARD_CIRCLE, x: wardAt.x, y: wardAt.y });

  // Canopy first, then the landmarks that stand out of it, then the seats.
  const foot = (item: Placed) => ({
    x: item.x + ((item.sprite.art[0]?.length ?? 0) >> 1),
    y: item.y + item.sprite.art.length,
  });
  const forest: BakedChart["forest"] = placeForest(field).map((item) => ({
    kind:
      item.sprite === CONIFER_TALL ? "tall"
      : item.sprite === CONIFER_MID ? "mid"
      : item.sprite === CONIFER_CLUMP ? "clump"
      : "low",
    ...foot(item),
  }));
  const relief: BakedChart["relief"] = [];
  let hills = 0;
  for (const item of placeFurniture(field, keepOut)) {
    // Every sixth hill is marked; the rest are carried by the ground's bands.
    if (item.sprite === HILL && hills++ % 6 === 0) relief.push({ kind: "hill", ...foot(item) });
  }
  void wardAt;

  // The liquidation line, from the same tracer the survey plate uses.
  const sx = (size.width - 1) / (win.width - 1);
  const sy = (size.height - 1) / (win.height - 1);
  const shore = contour(raster, 0).segments.map((seg) => ({
    x1: seg.x1 * sx,
    y1: (win.height - 1 - seg.y1) * sy,
    x2: seg.x2 * sx,
    y2: (win.height - 1 - seg.y2) * sy,
  }));

  const beacons = seatSprites.map((seat) => ({
    x: seat.x + ((seat.sprite.art[0]?.length ?? 0) >> 1),
    y: seat.y,
  }));

  const nodes = seatSprites.map((seat) => ({
    x: seat.x + ((seat.sprite.art[0]?.length ?? 0) >> 1),
    y: seat.y + seat.sprite.art.length - 2,
  }));

  return {
    width: size.width,
    height: size.height,
    ceiling: field.ceiling,
    shore,
    leyLines: leyNetwork(field, nodes, pass),
    beacons,
    seats: landmarks.map((mark, i) => ({
      id: mark.deploymentId,
      share: mark.share,
      at: nodes[i] ?? toChart(mark.col, mark.row),
    })),
    pass,
    relief,
    forest,
    wet: field.wet,
    z: field.z,
  };
}
