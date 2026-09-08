import Phaser from "phaser";
import type { BakedChart } from "./bakeChart";

export interface ChartSceneData {
  chart: BakedChart;
  /** Whole-number upscale from chart pixels to screen pixels at zoom 1. */
  scale: number;
  onPointer?: (chartX: number, chartY: number) => void;
  onLeave?: () => void;
}

const TERRAIN_KEY = "scree-terrain";
const MOTE_KEY = "scree-mote";

/**
 * The chart, as a scene.
 *
 * Phaser earns its place here on three things the hand-rolled canvas could not
 * do well: a camera you can drag and zoom without redrawing anything, particle
 * motes that actually travel the ley routes instead of a glow that pulses in
 * place, and the v4 filter stack, which puts a real bloom on the light rather
 * than a stack of alpha passes pretending to be one.
 *
 * The art is unchanged. It is baked once into a texture and never touched
 * again; only the light over it is alive.
 */
export class ChartScene extends Phaser.Scene {
  /** Named `opts`, not `data`: Phaser's Scene already owns `data` as its DataManager. */
  private opts!: ChartSceneData;
  private terrain?: Phaser.GameObjects.Image;
  private ley?: Phaser.GameObjects.Graphics;
  private beacons: Phaser.GameObjects.Arc[] = [];
  private standing?: Phaser.GameObjects.Container;
  private dragging = false;

  constructor() {
    super({ key: "chart" });
  }

  init(data: ChartSceneData) {
    this.opts = data;
  }

  create() {
    const { chart, scale } = this.opts;

    /* ── the baked country ─────────────────────────────────────────── */
    if (this.textures.exists(TERRAIN_KEY)) this.textures.remove(TERRAIN_KEY);
    this.textures.addCanvas(TERRAIN_KEY, chart.canvas);

    this.terrain = this.add
      .image(0, 0, TERRAIN_KEY)
      .setOrigin(0, 0)
      .setScale(scale)
      .setDepth(0);

    const worldW = chart.width * scale;
    const worldH = chart.height * scale;
    this.cameras.main.setBounds(0, 0, worldW, worldH);

    /* ── the ley network, lit ──────────────────────────────────────── */
    this.ley = this.add.graphics().setDepth(2);
    this.drawLey(1);
    // v4 filters: one real bloom pass, rather than three alpha passes
    // impersonating one.
    this.ley.enableFilters();
    this.ley.filters?.internal.addGlow(0xffe9a8, 5, 0, 1);

    /* ── motes travelling the routes ───────────────────────────────── */
    this.makeMoteTexture();
    for (const line of chart.leyLines) {
      if (line.length < 8) continue;
      const points = line.map((p) => new Phaser.Math.Vector2(p.x * scale, p.y * scale));
      const path = new Phaser.Curves.Path(points[0]!.x, points[0]!.y);
      for (let i = 1; i < points.length; i += 3) path.lineTo(points[i]!.x, points[i]!.y);

      const emitter = this.add.particles(0, 0, MOTE_KEY, {
        lifespan: 4200,
        quantity: 1,
        frequency: 900,
        scale: { start: scale * 0.9, end: 0 },
        alpha: { start: 0.95, end: 0 },
        blendMode: "ADD",
        emitZone: { type: "edge", source: path, quantity: 44, total: 1 },
      });
      emitter.setDepth(3);
    }

    /* ── beacons on the citadels ───────────────────────────────────── */
    this.beacons = chart.beacons.map((b) => {
      const arc = this.add
        .circle(b.x * scale, b.y * scale, scale * 3, 0xffe9a8, 0.9)
        .setDepth(4);
      this.tweens.add({
        targets: arc,
        scale: { from: 0.7, to: 1.9 },
        alpha: { from: 0.85, to: 0.15 },
        duration: 1900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
      return arc;
    });

    /* ── camera: drag to pan, wheel to zoom ────────────────────────── */
    this.input.on("pointerdown", () => {
      this.dragging = true;
    });
    this.input.on("pointerup", () => {
      this.dragging = false;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const cam = this.cameras.main;
      if (this.dragging && pointer.isDown) {
        cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
        cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
        return;
      }
      const world = cam.getWorldPoint(pointer.x, pointer.y);
      this.opts.onPointer?.(world.x / scale, world.y / scale);
    });

    this.input.on(
      "wheel",
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        const cam = this.cameras.main;
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.88 : 1.14), 0.65, 4));
      },
    );

    this.game.canvas.addEventListener("mouseleave", () => this.opts.onLeave?.());

    this.cameras.main.centerOn(worldW / 2, worldH / 2);
    this.cameras.main.fadeIn(420);
  }

  /** Where you stand, placed by the page when price or wallet changes. */
  setStanding(chartX: number, chartY: number) {
    const scale = this.opts.scale;
    this.standing?.destroy();

    const ring = this.add.circle(0, 0, scale * 5, 0x57d6e8, 0).setStrokeStyle(scale * 0.6, 0x57d6e8, 0.8);
    const core = this.add.circle(0, 0, scale * 1.4, 0xd9f7ff, 1);
    this.standing = this.add
      .container(chartX * scale, chartY * scale, [ring, core])
      .setDepth(6);

    this.tweens.add({
      targets: ring,
      scale: { from: 0.6, to: 2.4 },
      alpha: { from: 0.9, to: 0 },
      duration: 2100,
      repeat: -1,
      ease: "Quad.Out",
    });
  }

  private drawLey(alpha: number) {
    const { chart, scale } = this.opts;
    const g = this.ley!;
    g.clear();
    g.lineStyle(Math.max(1, scale * 0.75), 0xffe9a8, alpha);
    for (const line of chart.leyLines) {
      if (line.length < 2) continue;
      g.beginPath();
      g.moveTo(line[0]!.x * scale, line[0]!.y * scale);
      for (const p of line) g.lineTo(p.x * scale, p.y * scale);
      g.strokePath();
    }
  }

  /** A soft dot, generated rather than loaded, so the scene needs no assets. */
  private makeMoteTexture() {
    if (this.textures.exists(MOTE_KEY)) return;
    const size = 8;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,246,221,1)");
    grad.addColorStop(0.45, "rgba(255,233,168,0.72)");
    grad.addColorStop(1, "rgba(255,233,168,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    this.textures.addCanvas(MOTE_KEY, canvas);
  }
}
