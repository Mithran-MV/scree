import * as THREE from "three";
import type { Raster } from "../field/raster";
import { exaggerationFor, gradientAt } from "../render/hillshade";
import { seaDatumFor } from "../render/palette";
import { biomeColor } from "./biome";

export interface TerrainBuild {
  geometry: THREE.BufferGeometry;
  /** World-space size of the terrain square. */
  size: number;
  /** Vertical scale applied to elevation, so the HUD can print it. */
  relief: number;
  ceiling: number;
  seaDatum: number;
}

export const WORLD_SIZE = 100;

/**
 * Build the landscape mesh from the field.
 *
 * Every vertex height is the real elevation at that cell, scaled by one
 * multiplier that the interface prints. No smoothing, no noise, no invented
 * detail: if the wallet's ground is a featureless ramp, the world is a
 * featureless slope, and it should be.
 */
export function buildTerrain(r: Raster): TerrainBuild {
  const { width, height } = r.window;
  const ceiling = Math.max(0.05, r.range.max);
  const seaDatum = seaDatumFor(r.range.min);
  const exaggeration = exaggerationFor(r);

  // Relief is tied to the range on show, so a shallow book still reads as
  // country rather than a table, and a deep one does not become a needle.
  const span = Math.max(0.05, ceiling + seaDatum);
  const relief = (WORLD_SIZE * 0.11) / span;

  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, width - 1, height - 1);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);

  // Steepness is normalised against the steepest ground actually present, so a
  // gentle map still shows crags where it is relatively steep.
  const slopes = new Float32Array(width * height);
  let steepest = 1e-9;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const g = gradientAt(r, col, row, exaggeration);
      const mag = Math.hypot(g.dzdx, g.dzdy);
      slopes[row * width + col] = mag;
      if (mag > steepest) steepest = mag;
    }
  }

  for (let i = 0; i < position.count; i++) {
    const col = i % width;
    // PlaneGeometry runs its rows from the far edge toward the camera, while
    // raster row 0 is dwell zero. Flipping here puts dwell zero at the near
    // edge, which is where the viewer stands.
    const planeRow = Math.floor(i / width);
    const row = height - 1 - planeRow;

    const raw = r.z[row * width + col]!;
    const z = Number.isFinite(raw) ? raw : ceiling;
    position.setY(i, z * relief);

    const [cr, cg, cb] = biomeColor({
      z,
      ceiling,
      seaDatum,
      steepness: Math.min(1, slopes[row * width + col]! / steepest),
    });
    colors[i * 3] = cr;
    colors[i * 3 + 1] = cg;
    colors[i * 3 + 2] = cb;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  position.needsUpdate = true;

  return { geometry, size: WORLD_SIZE, relief, ceiling, seaDatum };
}

/** World position for a field cell, matching the mesh's own layout. */
export function cellToWorld(
  col: number,
  row: number,
  width: number,
  height: number,
): { x: number; z: number } {
  return {
    x: (col / (width - 1) - 0.5) * WORLD_SIZE,
    z: (0.5 - row / (height - 1)) * WORLD_SIZE,
  };
}
