import type { Raster } from "../field/raster";
import { extractFeatures } from "../field/features";
import { findLandmarks } from "../world/landmarks";
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
  drawFurniture(ctx, placeForest(field));
  drawFurniture(ctx, placeFurniture(field, keepOut));
  drawFurniture(ctx, seatSprites);
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
  };
}
