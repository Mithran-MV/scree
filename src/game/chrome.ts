import Phaser from "phaser";
import { dprIn } from "./screen";
import { T, FONT_MONO } from "./theme";
import { audio } from "./audio";

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
    fontSize: `${options.size ?? 12}px`,
    color: hex(options.color ?? T.ink),
    align: options.align ?? "left",
  });
  t.setAlpha(options.alpha ?? 1);
  // The screen camera zooms by the device density, so type is rasterised at
  // that density and lands one glyph pixel on one screen pixel. Pixel faces
  // are sampled nearest so their grid stays square; everything else linear.
  t.setResolution(dprIn(scene));
  t.texture.setFilter(options.crisp ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
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
  height?: number | undefined;
  onClick?: (() => void) | undefined;
  enabled?: boolean | undefined;
  font?: string | undefined;
}

function darken(colour: number, t: number): number {
  const r = (colour >> 16) & 255;
  const g = (colour >> 8) & 255;
  const b = colour & 255;
  return (Math.round(r * (1 - t)) << 16) | (Math.round(g * (1 - t)) << 8) | Math.round(b * (1 - t));
}

/** Multiply-tint for the grey button stock: the stock's 150-grey becomes ~60% of the tone. */
function lighten(colour: number, t: number): number {
  const r = (colour >> 16) & 255;
  const g = (colour >> 8) & 255;
  const b = colour & 255;
  return (Math.round(r + (255 - r) * t) << 16) | (Math.round(g + (255 - g) * t) << 8) | Math.round(b + (255 - b) * t);
}

/**
 * Every button is the same stock in the same brass, whatever it does; a
 * control does not shout by colour. The only states are rest, hover, off.
 */
export function button(scene: Phaser.Scene, x: number, y: number, text: string, options: ButtonOptions = {}): Phaser.GameObjects.Container {
  const tone = options.tone ?? T.brass;
  const enabled = options.enabled ?? true;
  const t = label(scene, 0, 0, text, { size: 12, color: T.ink, tracking: 0.6, font: options.font });
  const w = options.width ?? t.width + 26;
  const h = options.height ?? 28;

  const face = nine(scene, UI.button, 0, 0, w, h, 8);
  face.setTint(enabled ? lighten(tone, 0.1) : 0x556066);
  t.setPosition(Math.round((w - t.width) / 2), Math.round((h - t.height) / 2));
  t.setAlpha(enabled ? 1 : 0.5);

  const container = scene.add.container(x, y, [face, t]);
  container.setSize(w, h);
  if (enabled) {
    const labelY = t.y;
    const rest = () => {
      face.setTint(lighten(tone, 0.1));
      t.setY(labelY);
    };
    // The hit area is in the container's local space, whose origin is the
    // button's top-left corner: Rectangle takes a corner, not a centre.
    container.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    container.on("pointerover", () => {
      face.setTint(lighten(tone, 0.45));
      scene.input.setDefaultCursor("pointer");
      audio.sfx("hover");
    });
    container.on("pointerout", () => {
      rest();
      scene.input.setDefaultCursor("default");
    });
    // A press is visible on its own, for a finger as much as a mouse: the face
    // darkens and the label drops a pixel until the pointer lifts.
    container.on("pointerdown", () => {
      face.setTint(darken(tone, 0.25));
      t.setY(labelY + 1);
      audio.sfx("press");
      options.onClick?.();
    });
    container.on("pointerup", rest);
  }
  return container;
}

/**
 * The speaker: a square brass button with a pixel loudspeaker, sound waves
 * when sound is on and a red stroke through it when it is off. It switches
 * the engine itself and redraws; the caller only places it.
 */
export function soundButton(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Container {
  const w = 36;
  const h = 30;
  const tone = T.brass;
  const face = nine(scene, UI.button, 0, 0, w, h, 8);
  const icon = scene.add.graphics();
  const container = scene.add.container(x, y, [face, icon]);
  container.setSize(w, h);
  const draw = () => {
    const on = audio.enabled;
    icon.clear();
    const ink = on ? T.ink : T.inkDim;
    icon.fillStyle(ink, 1);
    icon.fillRect(8, 12, 4, 6);
    icon.fillTriangle(12, 12, 17, 7, 17, 23);
    icon.fillRect(12, 12, 5, 6);
    if (on) {
      icon.lineStyle(2, T.ley, 1);
      icon.beginPath();
      icon.arc(18, 15, 4, -0.95, 0.95);
      icon.strokePath();
      icon.beginPath();
      icon.arc(18, 15, 8, -0.8, 0.8);
      icon.strokePath();
    } else {
      icon.lineStyle(2, T.perilBright, 1);
      icon.beginPath();
      icon.moveTo(20, 9);
      icon.lineTo(29, 21);
      icon.strokePath();
    }
  };
  const rest = () => face.setTint(lighten(tone, 0.1));
  rest();
  draw();
  container.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
  container.on("pointerover", () => {
    face.setTint(lighten(tone, 0.45));
    scene.input.setDefaultCursor("pointer");
    audio.sfx("hover");
  });
  container.on("pointerout", () => {
    rest();
    scene.input.setDefaultCursor("default");
  });
  container.on("pointerdown", () => {
    face.setTint(darken(tone, 0.25));
    audio.setEnabled(!audio.enabled);
    audio.sfx("press");
    draw();
  });
  container.on("pointerup", rest);
  return container;
}

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
