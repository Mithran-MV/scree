import type { Raster } from "../field/raster";
import { extractFeatures } from "../field/features";
import { findLandmarks } from "../world/landmarks";
import {
  CONIFER_CLUMP,
  CONIFER_LOW,
  CONIFER_MID,
  CONIFER_TALL,
  HILL,
} from "../arcane/terrain-sprites";
import {
  blit,
  chartSizeFor,
  citadelFor,
  drawContourRings,
  drawFurniture,
  drawShoreline,
  leyNetwork,
  paintGround,
  placeForest,
  placeFurniture,
  placeWinged,
  sampleField,
  WARD_CIRCLE,
  type Node,
  type Placed,
} from "../arcane/pixelchart";

export interface BakedChart {
  /** The country, drawn once at chart resolution. */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
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
 * Everything that never moves — ground, contours, shoreline, mountains,
 * holdings, citadels — is drawn into a single canvas that Phaser uploads as one
 * texture. Only the light on top of it is animated, so a repaint costs a texture
 * swap rather than several thousand fills a frame.
 */
export function bakeChart(raster: Raster, aspect: number): BakedChart {
  const size = chartSizeFor(aspect);
  const field = sampleField(raster, size);
  const features = extractFeatures(raster);
  const landmarks = findLandmarks(raster);

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  paintGround(ctx, field);
  drawContourRings(ctx, field);
  drawShoreline(ctx, field);

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
  // The massifs are baked: the packs carry no true mountain tile, and the
  // ranked peaks read as a range where a rock tile reads as a block. The
  // forest and the hills are handed to the world to stand real sprites on.
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
  const furniture = placeFurniture(field, keepOut);
  const relief: BakedChart["relief"] = [];
  const baked: Placed[] = [];
  let hills = 0;
  for (const item of furniture) {
    // Every sixth hill gets a boulder sprite; the rest stay baked. Standing a
    // rock on every hill turned the mid-band into a wall of grey.
    if (item.sprite === HILL && hills++ % 6 === 0) relief.push({ kind: "hill", ...foot(item) });
    else baked.push(item);
  }
  drawFurniture(ctx, baked);
  // The seats themselves are not baked: the world draws each as its own sprite
  // at nearly twice the ground scale, so they stand over the map rather than in it.
  if (wardAt) blit(ctx, WARD_CIRCLE, wardAt.x, wardAt.y);
  drawFurniture(ctx, placeWinged(field));

  // The binding: this chart is read as a spread, so it has a spine.
  const spine = Math.round(size.width / 2);
  ctx.fillStyle = "rgba(6,18,24,0.5)";
  ctx.fillRect(spine - 3, 0, 6, size.height);
  ctx.fillStyle = "rgba(120,190,200,0.16)";
  ctx.fillRect(spine, 0, 1, size.height);
  for (let y = 0; y < size.height; y += 9) {
    ctx.fillStyle = "rgba(6,18,24,0.55)";
    ctx.fillRect(spine - 5, y, 2, 5);
    ctx.fillRect(spine + 4, y + 4, 2, 5);
  }

  const beacons = seatSprites.map((seat) => ({
    x: seat.x + ((seat.sprite.art[0]?.length ?? 0) >> 1),
    y: seat.y,
  }));

  const nodes = seatSprites.map((seat) => ({
    x: seat.x + ((seat.sprite.art[0]?.length ?? 0) >> 1),
    y: seat.y + seat.sprite.art.length - 2,
  }));

  return {
    canvas,
    width: size.width,
    height: size.height,
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
