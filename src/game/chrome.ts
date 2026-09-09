import Phaser from "phaser";
import { T, FONT_MONO } from "./theme";

/**
 * The furniture of the instrument.
 *
 * Panels and buttons are nine-slices of baked pixel-art frames (see
 * scripts/bake-sprites.ts), so every box on screen is the same stock at any
 * size, and type is rendered at device resolution over it.
 */

export const UI = {
  panel: "scree-ui-panel",
  console: "scree-ui-console",
  button: "scree-ui-button",
  topbar: "scree-ui-topbar",
  frame: "scree-ui-frame",
  bigButton: "scree-ui-bigbutton",
} as const;

/** A nine-slice of one of the baked frames, anchored at its top-left. */
export function nine(scene: Phaser.Scene, key: string, x: number, y: number, w: number, h: number, slice = 12): Phaser.GameObjects.NineSlice {
  const n = scene.add.nineslice(x, y, key, 0, Math.max(w, slice * 2 + 1), Math.max(h, slice * 2 + 1), slice, slice, slice, slice);
  n.setOrigin(0, 0);
  return n;
}

export interface LabelOptions {
  size?: number | undefined;
  color?: number | undefined;
  alpha?: number | undefined;
  align?: "left" | "center" | "right" | undefined;
  tracking?: number | undefined;
  font?: string | undefined;
  /** Outline, for type over the map. */
  stroke?: { color: number; thickness: number } | undefined;
  shadow?: boolean | undefined;
  wrap?: number | undefined;
  /** Pixel-font type: rendered 1:1 and sampled nearest, on whole pixels. */
  crisp?: boolean | undefined;
}

export function label(scene: Phaser.Scene, x: number, y: number, text: string, options: LabelOptions = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(options.crisp ? Math.round(x) : x, options.crisp ? Math.round(y) : y, text, {
    fontFamily: options.font ?? FONT_MONO,
    fontSize: `${options.size ?? 11}px`,
    color: hex(options.color ?? T.ink),
    align: options.align ?? "left",
  });
  t.setAlpha(options.alpha ?? 1);
  // The game runs with pixelArt on, which is right for the sprites and wrong
  // for type: text canvases would be sampled nearest-neighbour at 1x. Render
  // them at device resolution and filter them linearly.
  if (options.crisp) {
    t.setResolution(1);
    t.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  } else {
    t.setResolution(Math.min(2, window.devicePixelRatio || 1));
    t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
  if (options.tracking) t.setLetterSpacing(options.tracking);
  if (options.stroke) t.setStroke(hex(options.stroke.color), options.stroke.thickness);
  if (options.shadow) t.setShadow(2, 2, hex(T.shellEdge), 0, true, true);
  if (options.wrap) t.setWordWrapWidth(options.wrap);
  if (options.align === "center") t.setOrigin(0.5, 0);
  if (options.align === "right") t.setOrigin(1, 0);
  return t;
}

export interface ButtonOptions {
  tone?: number | undefined;
  width?: number | undefined;
  onClick?: (() => void) | undefined;
  enabled?: boolean | undefined;
  font?: string | undefined;
}

/** Multiply-tint for the grey button stock: the stock's 150-grey becomes ~60% of the tone. */
function lighten(colour: number, t: number): number {
  const r = (colour >> 16) & 255;
  const g = (colour >> 8) & 255;
  const b = colour & 255;
  return (Math.round(r + (255 - r) * t) << 16) | (Math.round(g + (255 - g) * t) << 8) | Math.round(b + (255 - b) * t);
}

export function button(scene: Phaser.Scene, x: number, y: number, text: string, options: ButtonOptions = {}): Phaser.GameObjects.Container {
  const tone = options.tone ?? T.ley;
  const enabled = options.enabled ?? true;
  const t = label(scene, 0, 0, text, { size: 11, color: T.ink, tracking: 1.2, font: options.font });
  const w = options.width ?? t.width + 26;
  const h = 26;

  const face = nine(scene, UI.button, 0, 0, w, h, 8);
  face.setTint(enabled ? lighten(tone, 0.1) : 0x556066);
  t.setPosition(Math.round((w - t.width) / 2), Math.round((h - t.height) / 2));
  t.setAlpha(enabled ? 1 : 0.5);

  const container = scene.add.container(x, y, [face, t]);
  container.setSize(w, h);
  if (enabled) {
    // The hit area is in the container's local space, whose origin is the
    // button's top-left corner: Rectangle takes a corner, not a centre.
    container.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    container.on("pointerover", () => {
      face.setTint(lighten(tone, 0.45));
      scene.input.setDefaultCursor("pointer");
    });
    container.on("pointerout", () => {
      face.setTint(lighten(tone, 0.1));
      scene.input.setDefaultCursor("default");
    });
    container.on("pointerdown", () => options.onClick?.());
  }
  return container;
}

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
