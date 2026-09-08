import Phaser from "phaser";
import type { Sprite } from "../arcane/figures";
import type { BakedChart } from "./bakeChart";
import { SCOUT, SCOUT_LOST } from "./figures";
import { T } from "./theme";
import { hex } from "./chrome";

export interface ScoutPath {
  /** Chart coordinates per step. */
  points: { x: number; y: number }[];
  diedAt: number | null;
}

export interface WorldData {
  chart: BakedChart;
  crashBinder: string | null;
  pumpBinder: string | null;
  /** Where the mage starts, in chart pixels. */
  start: { x: number; y: number };
  onArrive?: (x: number, y: number, drowned: boolean) => void;
  onNearSeat?: (id: string | null) => void;
  onGuardian?: (which: "serpent" | "drake", binder: string | null) => void;
  onScouts?: (survived: number, total: number) => void;
}

const SCALE = 4;
const KEYS = {
  terrain: "w-terrain",
  mote: "w-mote",
  scout: "w-scout",
  lost: "w-lost",
} as const;

/**
 * Kenney's CC0 "Tiny" packs, 16px tiles in 12-column sheets. Frame numbers are
 * indices into the packed tilemap, row-major. Public domain, so committed
 * alongside their licence files under public/assets/kenney.
 */
const SHEET = { dungeon: "kenney-tiny-dungeon", town: "kenney-tiny-town" } as const;
const FRAME = {
  mage: 84, // the purple-hatted wizard
  serpent: 123, // the coiled worm: guardian of the drowned ground
  beast: 110, // the red crawler: guardian of the high shore
} as const;

/** Kenney's CC0 Map Pack, 64px overworld tiles, one image each. */
const MAP = {
  castle: "kenney-map-castle",
  tower: "kenney-map-tower",
  pyramid: "kenney-map-pyramid",
  boulder: "kenney-map-boulder",
  pineTall: "kenney-map-pine-tall",
  pineDark: "kenney-map-pine-dark",
  pineSnow: "kenney-map-pine-snow",
  broadleaf: "kenney-map-broadleaf",
} as const;
const MAP_FILES: Record<keyof typeof MAP, string> = {
  castle: "mapTile_100.png",
  tower: "mapTile_099.png",
  pyramid: "mapTile_050.png",
  boulder: "mapTile_056.png",
  pineTall: "mapTile_041.png",
  pineDark: "mapTile_060.png",
  pineSnow: "mapTile_110.png",
  broadleaf: "mapTile_055.png",
};

/** How much larger than the ground the figures stand. */
const MAGE_SCALE = SCALE * 1.15;
const GUARDIAN_SCALE = SCALE * 1.35;

/**
 * The world, with someone in it.
 *
 * Everything static was baked into one texture. What lives here is what moves:
 * the mage who walks the map, the guardians who stir when he comes near the
 * water, and the scouts he sends out — two hundred of them at once, walking the
 * price paths the simulation drew, so a survival rate is something you watch
 * happen rather than a number you are handed.
 */
export class WorldScene extends Phaser.Scene {
  private opts!: WorldData;
  private mage!: Phaser.GameObjects.Sprite;
  private target: { x: number; y: number } | null = null;
  private walkBob: Phaser.Tweens.Tween | undefined;
  private lastSeat: string | null = null;
  private guardians: { kind: "serpent" | "drake"; sprite: Phaser.GameObjects.Image; at: { x: number; y: number }; stirred: boolean }[] = [];
  private scoutsRunning = false;

  constructor() {
    super({ key: "world" });
  }

  init(data: WorldData) {
    this.opts = data;
  }

  preload() {
    this.load.spritesheet(SHEET.dungeon, "/assets/kenney/tiny-dungeon/tilemap_packed.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet(SHEET.town, "/assets/kenney/tiny-town/tilemap_packed.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
    for (const [name, file] of Object.entries(MAP_FILES) as [keyof typeof MAP, string][]) {
      this.load.image(MAP[name], `/assets/kenney/map-pack/${file}`);
    }
  }

  create() {
    const { chart } = this.opts;
    this.bakeTextures();

    const worldW = chart.width * SCALE;
    const worldH = chart.height * SCALE;

    this.add.image(0, 0, KEYS.terrain).setOrigin(0, 0).setScale(SCALE).setDepth(0);

    /* ── the ley network and its light ────────────────────────────── */
    const ley = this.add.graphics().setDepth(2);
    ley.lineStyle(SCALE * 0.7, T.leyBright, 0.95);
    for (const line of chart.leyLines) {
      if (line.length < 2) continue;
      ley.beginPath();
      ley.moveTo(line[0]!.x * SCALE, line[0]!.y * SCALE);
      for (const p of line) ley.lineTo(p.x * SCALE, p.y * SCALE);
      ley.strokePath();
    }
    ley.enableFilters();
    ley.filters?.internal.addGlow(T.ley, 6, 0, 1);

    for (const line of chart.leyLines) {
      if (line.length < 10) continue;
      const path = new Phaser.Curves.Path(line[0]!.x * SCALE, line[0]!.y * SCALE);
      for (let i = 1; i < line.length; i += 3) path.lineTo(line[i]!.x * SCALE, line[i]!.y * SCALE);
      this.add
        .particles(0, 0, KEYS.mote, {
          lifespan: 4400,
          quantity: 1,
          frequency: 1100,
          scale: { start: 1.3, end: 0 },
          alpha: { start: 0.9, end: 0 },
          blendMode: "ADD",
          emitZone: { type: "edge", source: path, quantity: 48, total: 1 },
        })
        .setDepth(3);
    }

    // The forest, one sprite per tree, depth-sorted so nearer trees overlap
    // farther ones. Species follow the altitude bands the bake chose.
    for (const t of chart.forest) {
      const key = t.kind === "tall" ? MAP.pineTall : t.kind === "mid" ? MAP.pineDark : t.kind === "clump" ? MAP.pineSnow : MAP.broadleaf;
      const scale = t.kind === "tall" ? 0.5 : t.kind === "clump" ? 0.55 : 0.42;
      this.add
        .image(t.x * SCALE, t.y * SCALE, key)
        .setOrigin(0.5, 0.94)
        .setScale(scale)
        .setDepth(1 + t.y / chart.height);
    }
    // Boulders on the hills.
    for (const r of chart.relief) {
      this.add
        .image(r.x * SCALE, r.y * SCALE, MAP.boulder)
        .setOrigin(0.5, 0.92)
        .setScale(0.45)
        .setDepth(1 + r.y / chart.height);
    }

    // The seats, standing over the map: castle, pyramid or tower by share.
    for (const seat of chart.seats) {
      const key = seat.share > 0.34 ? MAP.castle : seat.share > 0.15 ? MAP.pyramid : MAP.tower;
      const img = this.add
        .image(seat.at.x * SCALE, seat.at.y * SCALE + SCALE * 2, key)
        .setOrigin(0.5, 0.95)
        .setScale(seat.share > 0.34 ? 2.6 : 2.1)
        .setDepth(6);
      img.enableFilters();
      img.filters?.internal.addGlow(T.ley, 3, 0, 1);
      // A footing shadow, so it stands on the ground rather than floating.
      this.add
        .ellipse(img.x, img.y + SCALE, img.displayWidth * 0.9, SCALE * 3, 0x000000, 0.4)
        .setDepth(5);
    }

    for (const b of chart.beacons) {
      const arc = this.add.circle(b.x * SCALE, b.y * SCALE, SCALE, T.leyBright, 0.9).setDepth(4);
      this.tweens.add({
        targets: arc,
        scale: { from: 0.6, to: 2.1 },
        alpha: { from: 0.85, to: 0.1 },
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
    }

    /* ── the guardians ─────────────────────────────────────────────── */
    this.placeGuardians();

    /* ── the mage ──────────────────────────────────────────────────── */
    this.mage = this.add
      .sprite(this.opts.start.x * SCALE, this.opts.start.y * SCALE, SHEET.dungeon, FRAME.mage)
      .setOrigin(0.5, 1)
      .setScale(MAGE_SCALE)
      .setDepth(10);
    this.mage.enableFilters();
    this.mage.filters?.internal.addGlow(T.ley, 2, 0, 1);

    const halo = this.add.circle(0, 0, SCALE * 4, T.ley, 0).setStrokeStyle(2, T.ley, 0.7).setDepth(9);
    this.tweens.add({
      targets: halo,
      scale: { from: 0.7, to: 2.2 },
      alpha: { from: 0.8, to: 0 },
      duration: 2000,
      repeat: -1,
      ease: "Quad.Out",
    });
    this.events.on("update", () => halo.setPosition(this.mage.x, this.mage.y - SCALE));

    /* ── input ─────────────────────────────────────────────────────── */
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.walkTo(world.x / SCALE, world.y / SCALE);
    });

    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.12), 0.55, 3));
    });

    const cam = this.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.startFollow(this.mage, true, 0.08, 0.08);
  }

  /* ── walking ─────────────────────────────────────────────────────── */

  /**
   * Ask the mage to walk to a chart coordinate.
   *
   * A tween with a duration set from the distance, rather than a per-frame
   * step: the walk is then a single owned object that can be replaced by the
   * next click, and its speed does not depend on what the frame delta is.
   */
  walkTo(cx: number, cy: number) {
    const { chart } = this.opts;
    const target = {
      x: Phaser.Math.Clamp(cx, 2, chart.width - 3),
      y: Phaser.Math.Clamp(cy, 4, chart.height - 2),
    };
    this.target = target;
    const tx = target.x * SCALE;
    const ty = target.y * SCALE;
    const dist = Math.hypot(tx - this.mage.x, ty - this.mage.y);
    const pixelsPerSecond = 110 * SCALE;

    this.tweens.killTweensOf(this.mage);
    this.mage.setFlipX(tx < this.mage.x);
    // The pack has no walk cycle, so walking is a bob: enough for a figure
    // this size to read as moving, and it stops dead on arrival.
    this.walkBob?.destroy();
    this.walkBob = this.tweens.add({
      targets: this.mage,
      scaleY: MAGE_SCALE * 0.92,
      duration: 140,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    this.tweens.add({
      targets: this.mage,
      x: tx,
      y: ty,
      duration: Math.max(120, (dist / pixelsPerSecond) * 1000),
      ease: "Linear",
      onComplete: () => {
        if (this.target !== target) return;
        this.target = null;
        this.walkBob?.destroy();
        this.walkBob = undefined;
        this.mage.setScale(MAGE_SCALE);
        this.arrive(target.x, target.y);
      },
    });
  }

  override update() {
    this.watchSeats();
    this.watchGuardians();
  }

  private arrive(cx: number, cy: number) {
    const { chart } = this.opts;
    const i = Math.round(cy) * chart.width + Math.round(cx);
    const drowned = chart.wet[i] === 1;
    if (drowned) {
      this.cameras.main.flash(260, 226, 96, 58);
      this.cameras.main.shake(180, 0.004);
      this.tweens.add({ targets: this.mage, alpha: { from: 1, to: 0.35 }, yoyo: true, duration: 220, repeat: 2 });
    }
    this.opts.onArrive?.(cx, cy, drowned);
  }

  private watchSeats() {
    const { chart } = this.opts;
    const mx = this.mage.x / SCALE;
    const my = this.mage.y / SCALE;
    let near: string | null = null;
    for (const seat of chart.seats) {
      if (Math.hypot(seat.at.x - mx, seat.at.y - my) < 14) {
        near = seat.id;
        break;
      }
    }
    if (near !== this.lastSeat) {
      this.lastSeat = near;
      this.opts.onNearSeat?.(near);
    }
  }

  /* ── guardians ───────────────────────────────────────────────────── */

  /**
   * One guardian per way to die.
   *
   * The serpent lies in the western basin, where a crash drowns you; the drake
   * roosts on the eastern shore, where a pump does. Each is tied to the
   * deployment that actually binds on that side, and neither is drawn when its
   * side cannot kill you — a book with only one way to die gets one guardian.
   */
  private placeGuardians() {
    const { chart } = this.opts;
    const { width: W, height: H, wet } = chart;
    const row = Math.floor(H * 0.55);

    const seek = (from: number, step: number): number | null => {
      for (let x = from; x >= 0 && x < W; x += step) {
        if (wet[row * W + x]) return x;
      }
      return null;
    };

    if (this.opts.crashBinder) {
      const shore = seek(Math.floor(W / 2), -1);
      if (shore !== null) {
        const x = Math.max(12, shore - 14);
        this.spawnGuardian("serpent", FRAME.serpent, x, row);
      }
    }
    if (this.opts.pumpBinder) {
      const shore = seek(Math.floor(W / 2), 1);
      if (shore !== null) {
        const x = Math.min(W - 12, shore + 10);
        this.spawnGuardian("drake", FRAME.beast, x, row - 6);
      }
    }
  }

  private spawnGuardian(kind: "serpent" | "drake", frame: number, cx: number, cy: number) {
    const sprite = this.add
      .image(cx * SCALE, cy * SCALE, SHEET.dungeon, frame)
      .setOrigin(0.5, 1)
      .setScale(GUARDIAN_SCALE)
      .setAlpha(0.6)
      .setDepth(7);
    this.tweens.add({
      targets: sprite,
      y: sprite.y - SCALE * 1.5,
      duration: 2600 + (kind === "drake" ? 700 : 0),
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    this.guardians.push({ kind, sprite, at: { x: cx, y: cy }, stirred: false });
  }

  private watchGuardians() {
    const mx = this.mage.x / SCALE;
    const my = this.mage.y / SCALE;
    for (const g of this.guardians) {
      const d = Math.hypot(g.at.x - mx, g.at.y - my);
      const near = d < 34;
      if (near && !g.stirred) {
        g.stirred = true;
        g.sprite.setAlpha(1);
        this.tweens.add({ targets: g.sprite, scaleX: GUARDIAN_SCALE * 1.15, scaleY: GUARDIAN_SCALE * 1.15, duration: 380, yoyo: true });
        this.cameras.main.shake(140, 0.0025);
        this.opts.onGuardian?.(g.kind, g.kind === "serpent" ? this.opts.crashBinder : this.opts.pumpBinder);
      } else if (!near && g.stirred) {
        g.stirred = false;
        g.sprite.setAlpha(0.55);
      }
    }
  }

  /* ── scouts ──────────────────────────────────────────────────────── */

  /**
   * Send the scouts.
   *
   * Every path is one of the simulation's price walks, already computed and
   * already judged. Here they are only walked: each scout follows its own
   * track, and where the simulation says the book drowned, that scout stops
   * and a mark is left on the ground. When the last one is home, the count of
   * the returned is reported — which is the survival rate, watched.
   */
  sendScouts(paths: ScoutPath[]) {
    if (this.scoutsRunning || paths.length === 0) return;
    this.scoutsRunning = true;

    const duration = 4200;
    let finished = 0;
    let survived = 0;
    const originX = this.mage.x;
    const originY = this.mage.y - SCALE * 2;

    for (const path of paths) {
      const scout = this.add
        .image(originX, originY, KEYS.scout)
        .setScale(SCALE * 0.8)
        .setDepth(8)
        .setAlpha(0.9);

      const steps = path.diedAt === null ? path.points.length - 1 : path.diedAt;
      const walked = path.points.slice(0, Math.max(1, steps) + 1);
      const perStep = duration / Math.max(1, path.points.length - 1);

      const chain = walked.slice(1).map((p) => ({
        x: p.x * SCALE,
        y: p.y * SCALE,
        duration: perStep,
        ease: "Linear",
      }));

      const done = () => {
        finished++;
        if (path.diedAt === null) {
          survived++;
          this.tweens.add({
            targets: scout,
            alpha: 0,
            duration: 400,
            onComplete: () => scout.destroy(),
          });
        } else {
          scout.setTexture(KEYS.lost).setAlpha(1);
          this.tweens.add({ targets: scout, alpha: 0.35, duration: 6000, delay: 1200 });
        }
        if (finished === paths.length) {
          this.scoutsRunning = false;
          this.opts.onScouts?.(survived, paths.length);
        }
      };

      if (chain.length === 0) {
        done();
        continue;
      }
      this.tweens.chain({ targets: scout, tweens: chain, onComplete: done });
    }
  }

  /* ── textures ────────────────────────────────────────────────────── */

  private bakeTextures() {
    if (!this.textures.exists(KEYS.terrain)) {
      this.textures.addCanvas(KEYS.terrain, this.opts.chart.canvas);
    } else {
      this.textures.remove(KEYS.terrain);
      this.textures.addCanvas(KEYS.terrain, this.opts.chart.canvas);
    }
    this.bakeSprite(KEYS.scout, SCOUT);
    this.bakeSprite(KEYS.lost, SCOUT_LOST);


    if (!this.textures.exists(KEYS.mote)) {
      const size = 8;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, hex(T.leyBright));
      grad.addColorStop(0.4, "rgba(53,224,232,0.7)");
      grad.addColorStop(1, "rgba(53,224,232,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      this.textures.addCanvas(KEYS.mote, canvas);
    }
  }

  private bakeSprite(key: string, sprite: Sprite) {
    if (this.textures.exists(key)) return;
    const w = sprite.art[0]?.length ?? 0;
    const h = sprite.art.length;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    for (let row = 0; row < h; row++) {
      const line = sprite.art[row]!;
      for (let col = 0; col < line.length; col++) {
        const ch = line[col]!;
        if (ch === ".") continue;
        const colour = sprite.palette[ch];
        if (!colour) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(col, row, 1, 1);
      }
    }
    this.textures.addCanvas(key, canvas);
  }
}

export { SCALE as WORLD_SCALE };
