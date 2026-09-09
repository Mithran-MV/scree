import type Phaser from "phaser";

/**
 * Device density.
 *
 * The canvas is sized in device pixels and shown at CSS size, so every
 * screen camera zooms by the density from its top-left corner: the scenes
 * keep laying out in CSS pixels, sprites scale up in-game instead of being
 * smeared by the browser, and type rendered at the same density lands one
 * glyph pixel on one screen pixel.
 */
export const DPR_KEY = "dpr";

export function dprOf(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}

export function dprIn(scene: Phaser.Scene): number {
  const d = scene.registry.get(DPR_KEY) as number | undefined;
  return d && d > 0 ? d : 1;
}

/** The screen in CSS pixels, and the density behind it. */
export function logical(scene: Phaser.Scene): { W: number; H: number; D: number } {
  const D = dprIn(scene);
  return { W: scene.scale.width / D, H: scene.scale.height / D, D };
}

/** Pin a camera to the screen: CSS pixels map to device pixels at the density, from the top-left. */
export function pinToScreen(cam: Phaser.Cameras.Scene2D.Camera, D: number): void {
  cam.setOrigin(0, 0);
  cam.setZoom(D);
  cam.setScroll(0, 0);
}
