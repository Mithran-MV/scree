import Phaser from "phaser";
import { T, FONT_MONO } from "./theme";

/**
 * The machined furniture of the console.
 *
 * Every panel, bezel and button is drawn with Graphics rather than loaded as an
 * image, so the whole interface is resolution-independent, themeable from one
 * palette, and ships without a single asset file.
 */

export interface PanelOptions {
  /** Draw the heavier outer housing as well as the inner face. */
  housing?: boolean;
  fill?: number;
  fillAlpha?: number;
  edge?: number;
}

/** A recessed panel: outer bevel, inner face, corner screws. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  options: PanelOptions = {},
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const fill = options.fill ?? T.shell;
  const edge = options.edge ?? T.bevel;

  if (options.housing) {
    g.fillStyle(T.shellDark, 1);
    g.fillRoundedRect(x - 5, y - 5, w + 10, h + 10, 6);
    g.lineStyle(1, T.shellEdge, 1);
    g.strokeRoundedRect(x - 5, y - 5, w + 10, h + 10, 6);
  }

  g.fillStyle(fill, options.fillAlpha ?? 0.96);
  g.fillRoundedRect(x, y, w, h, 4);

  // Top-left catches the light, bottom-right falls into shadow.
  g.lineStyle(1, edge, 0.85);
  g.beginPath();
  g.moveTo(x + 2, y + h - 2);
  g.lineTo(x + 2, y + 2);
  g.lineTo(x + w - 2, y + 2);
  g.strokePath();
  g.lineStyle(1, T.shellEdge, 0.9);
  g.beginPath();
  g.moveTo(x + w - 2, y + 2);
  g.lineTo(x + w - 2, y + h - 2);
  g.lineTo(x + 2, y + h - 2);
  g.strokePath();

  for (const [sx, sy] of [
    [x + 7, y + 7],
    [x + w - 7, y + 7],
    [x + 7, y + h - 7],
    [x + w - 7, y + h - 7],
  ] as const) {
    g.fillStyle(T.shellLit, 1);
    g.fillCircle(sx, sy, 2);
    g.lineStyle(1, T.shellEdge, 1);
    g.beginPath();
    g.moveTo(sx - 1.4, sy - 1.4);
    g.lineTo(sx + 1.4, sy + 1.4);
    g.strokePath();
  }

  return g;
}

/** A screen bezel: the deep inset the chart sits in. */
export function bezel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(T.shellDark, 1);
  g.fillRoundedRect(x - 16, y - 16, w + 32, h + 32, 8);
  g.lineStyle(2, T.shellLit, 0.7);
  g.strokeRoundedRect(x - 16, y - 16, w + 32, h + 32, 8);
  g.lineStyle(1, T.shellEdge, 1);
  g.strokeRoundedRect(x - 4, y - 4, w + 8, h + 8, 3);
  g.fillStyle(T.screenVoid, 1);
  g.fillRect(x, y, w, h);
  return g;
}

export interface LabelOptions {
  size?: number;
  color?: number;
  alpha?: number;
  align?: "left" | "center" | "right";
  tracking?: number;
  font?: string;
}

export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  options: LabelOptions = {},
): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, {
    fontFamily: options.font ?? FONT_MONO,
    fontSize: `${options.size ?? 11}px`,
    color: hex(options.color ?? T.ink),
    align: options.align ?? "left",
  });
  t.setAlpha(options.alpha ?? 1);
  if (options.tracking) t.setLetterSpacing(options.tracking);
  if (options.align === "center") t.setOrigin(0.5, 0);
  if (options.align === "right") t.setOrigin(1, 0);
  return t;
}

/** A plaque pinned over the screen, naming something on the chart. */
export function plaque(
  scene: Phaser.Scene,
  x: number,
  y: number,
  title: string,
  sub: string,
  tone: number = T.ley,
): Phaser.GameObjects.Container {
  const titleText = label(scene, 0, 0, title, { size: 11, color: T.ink });
  const subText = label(scene, 0, 13, sub, { size: 9.5, color: T.inkDim });
  const w = Math.max(titleText.width, subText.width) + 18;
  const h = sub ? 30 : 19;

  const g = scene.add.graphics();
  g.fillStyle(T.screenVoid, 0.92);
  g.fillRoundedRect(0, -4, w, h, 3);
  g.lineStyle(1, tone, 0.7);
  g.strokeRoundedRect(0, -4, w, h, 3);
  g.fillStyle(tone, 0.9);
  g.fillRect(0, -4, 2, h);

  titleText.setPosition(9, -1);
  subText.setPosition(9, 12);
  if (!sub) subText.setVisible(false);

  return scene.add.container(x - w / 2, y, [g, titleText, subText]);
}

export interface ButtonOptions {
  tone?: number | undefined;
  width?: number | undefined;
  onClick?: (() => void) | undefined;
  enabled?: boolean | undefined;
}

export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  options: ButtonOptions = {},
): Phaser.GameObjects.Container {
  const tone = options.tone ?? T.ley;
  const enabled = options.enabled ?? true;
  const t = label(scene, 0, 0, text, { size: 11, color: T.ink, tracking: 1.2 });
  const w = options.width ?? t.width + 26;
  const h = 26;

  const g = scene.add.graphics();
  const paint = (hover: boolean) => {
    g.clear();
    g.fillStyle(T.shell, enabled ? 1 : 0.5);
    g.fillRoundedRect(0, 0, w, h, 3);
    g.lineStyle(1, tone, enabled ? (hover ? 1 : 0.65) : 0.25);
    g.strokeRoundedRect(0, 0, w, h, 3);
    if (enabled && hover) {
      g.fillStyle(tone, 0.14);
      g.fillRoundedRect(0, 0, w, h, 3);
    }
  };
  paint(false);

  t.setPosition((w - t.width) / 2, (h - t.height) / 2);
  t.setAlpha(enabled ? 1 : 0.45);

  const container = scene.add.container(x, y, [g, t]);
  container.setSize(w, h);
  if (enabled) {
    container.setInteractive(
      new Phaser.Geom.Rectangle(w / 2, h / 2, w, h),
      Phaser.Geom.Rectangle.Contains,
    );
    container.on("pointerover", () => {
      paint(true);
      scene.input.setDefaultCursor("pointer");
    });
    container.on("pointerout", () => {
      paint(false);
      scene.input.setDefaultCursor("default");
    });
    container.on("pointerdown", () => options.onClick?.());
  }
  return container;
}

/** A row of glyphs along the foot of the screen. */
export function runeStrip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
): Phaser.GameObjects.Text {
  const glyphs = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
  const many = Math.max(8, Math.floor(w / 15));
  const line = Array.from({ length: many }, (_, i) => glyphs[i % glyphs.length]).join(" ");
  const t = label(scene, x + w / 2, y, line, {
    size: 10,
    color: T.leyDim,
    alpha: 0.55,
    align: "center",
  });
  return t;
}

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
