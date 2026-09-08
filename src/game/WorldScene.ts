import Phaser from "phaser";
import { Band, dwellFyToTileY, type Segment, type TerrainGrid } from "./terrain";
import {
  GENERATED_TOTAL,
  TILE,
  buildTerrainTileset,
  interiorIndex,
  materialsFromPack,
  transitionIndex,
  waterIndex,
} from "./tileset";
import { FRAME, SEATS, SHEET, TERRACE, TREES, ZONE_COLOURS, seatKindFor } from "./figures";
import { LAYOUT, mapViewport } from "./layout";
import { EV, type CitadelHover, type GuardianEvent, type ScoutsEvent, type ZoneReading } from "./events";
import { T } from "./theme";
import type { UIData } from "./UIScene";

/** A defence terrace: a price band × dwell band the user raises by `liftHF`. */
export interface Terrace {
  priceFxLo: number;
  priceFxHi: number;
  dwellFyLo: number;
  dwellFyHi: number;
  liftHF: number;
  label: string;
}

export interface ScoutPath {
  /** Fractions along price and dwell per step. */
  points: { fx: number; fy: number }[];
  diedAt: number | null;
}

export interface WorldData {
  grid: TerrainGrid;
  /** The book's reading at a point, supplied by the owner of the arithmetic. */
  readAt: (fx: number, fy: number) => ZoneReading;
  terraces: Terrace[];
  crashZone: string | null;
  pumpZone: string | null;
  ui: UIData;
}

const TOWN_GID = 1000;
const GENERATED_KEY = "scree-terrain";
const MOTE_KEY = "scree-mote";
const SCALE = LAYOUT.scale;
const TILE_PX = TILE * SCALE;

/** Depth plan. Everything in the world sits on one of these shelves. */
const DEPTH = {
  water: 0,
  terrain: 1,
  boundaries: 1.5,
  terraces: 2,
  terraceGlow: 2.1,
  figures: 3, // + y-sort fraction
  scouts: 3.6,
  avatarHalo: 3.9,
  avatar: 4,
} as const;

/**
 * A line of light: wide faint passes under a thin bright one. A glow filter
 * over a world-sized Graphics would render the whole world to a texture each
 * frame; three strokes cost nothing.
 */
function glowLines(g: Phaser.GameObjects.Graphics, segs: readonly Segment[], colour: number, bright: number, px: number) {
  const passes: [number, number, number][] = [
    [px * 7, colour, 0.16],
    [px * 3.5, colour, 0.34],
    [px * 1.4, bright, 0.95],
  ];
  for (const [width, c, alpha] of passes) {
    g.lineStyle(width, c, alpha);
    g.beginPath();
    for (const s of segs) {
      g.moveTo(s.x1 * TILE_PX, s.y1 * TILE_PX);
      g.lineTo(s.x2 * TILE_PX, s.y2 * TILE_PX);
    }
    g.strokePath();
  }
}

function glowRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, colour: number, bright: number, px: number) {
  const passes: [number, number, number][] = [
    [px * 7, colour, 0.16],
    [px * 3.5, colour, 0.34],
    [px * 1.5, bright, 0.95],
  ];
  for (const [width, c, alpha] of passes) {
    g.lineStyle(width, c, alpha);
    g.strokeRect(x, y, w, h);
  }
}

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The world.
 *
 * Owns the camera, the tilemap layers and everything standing on them. Draws
 * nothing that is not derived from the terrain grid, and raises events for
 * the interface instead of drawing any interface itself.
 */
export class WorldScene extends Phaser.Scene {
  private opts!: WorldData;
  private worldW = 0;
  private worldH = 0;

  private map!: Phaser.Tilemaps.Tilemap;
  private waterA!: Phaser.Tilemaps.TilemapLayer;
  private waterB!: Phaser.Tilemaps.TilemapLayer;
  private terrain!: Phaser.Tilemaps.TilemapLayer;
  private terraceLayer!: Phaser.Tilemaps.TilemapLayer;
  private terraceGlow!: Phaser.GameObjects.Graphics;
  private boundaryLines!: Phaser.GameObjects.Graphics;
  private terraces: Terrace[] = [];

  private avatar!: Phaser.GameObjects.Sprite;
  private walk: Phaser.Tweens.Tween | undefined;
  private guardians: { kind: "serpent" | "drake"; sprite: Phaser.GameObjects.Image; x: number; y: number; stirred: boolean }[] = [];
  private scoutsRunning = false;
  private hoverCitadel: string | null = null;

  constructor() {
    super({ key: "WorldScene" });
  }

  init(data: WorldData) {
    this.opts = data;
  }

  preload() {
    this.load.spritesheet(SHEET.town, "/assets/kenney/tiny-town/tilemap_packed.png", { frameWidth: TILE, frameHeight: TILE });
    this.load.spritesheet(SHEET.dungeon, "/assets/kenney/tiny-dungeon/tilemap_packed.png", { frameWidth: TILE, frameHeight: TILE });
  }

  create() {
    const { grid } = this.opts;
    this.worldW = grid.cols * TILE_PX;
    this.worldH = grid.rows * TILE_PX;

    this.buildTileset();
    this.buildLayers();
    this.drawBoundaries();
    this.setTerraces(this.opts.terraces);
    this.plantTrees();
    this.raiseCitadels();
    this.placeGuardians();
    this.placeAvatar();
    this.wireCamera();
    this.wireInput();

    // The interface is its own scene, launched over this one. Scenes render
    // in list order, so it is brought to the top explicitly.
    this.scene.launch("UIScene", this.opts.ui);
    this.scene.bringToTop("UIScene");
  }

  /* ── tiles ────────────────────────────────────────────────────────── */

  private buildTileset() {
    const materials = materialsFromPack(this, SHEET.town);
    buildTerrainTileset(this, GENERATED_KEY, materials);
    this.ensureMoteTexture();
  }

  /**
   * Three tilemap layers from one grid. Water on the bottom, animated by
   * swapping two frame layers. Terrain above it, where interior tiles come
   * from the pack and every edge is a generated transition chosen by the
   * tile's corner mask. Terraces above that, empty until the user raises one.
   */
  private buildLayers() {
    const { grid } = this.opts;
    this.map = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: grid.cols, height: grid.rows });
    const generated = this.map.addTilesetImage("generated", GENERATED_KEY, TILE, TILE, 0, 0, 0)!;
    const town = this.map.addTilesetImage("town", SHEET.town, TILE, TILE, 0, 0, TOWN_GID)!;
    const sets = [generated, town];

    const blank = (name: string, depth: number) => {
      const layer = this.map.createBlankLayer(name, sets, 0, 0, grid.cols, grid.rows, TILE, TILE)!;
      layer.setScale(SCALE).setDepth(depth);
      return layer;
    };
    this.waterA = blank("water-a", DEPTH.water);
    this.waterB = blank("water-b", DEPTH.water);
    this.terrain = blank("terrain", DEPTH.terrain);
    this.terraceLayer = blank("terraces", DEPTH.terraces);

    // Interiors the pack draws better than the generator: its grass and plain
    // dirt tile seamlessly. Its stone is castle wall, not ground, so the
    // mountain interior stays generated.
    const packInterior: Partial<Record<Band, readonly number[]>> = {
      [Band.GRASS]: [0, 0, 0, 0, 1, 1, 2],
      [Band.HIGHLAND]: [39, 40, 41, 42],
    };

    for (let ty = 0; ty < grid.rows; ty++) {
      for (let tx = 0; tx < grid.cols; tx++) {
        const tile = grid.tiles[ty * grid.cols + tx]!;
        const variant = Math.floor(hash(tx, ty, 1) * 3);

        if (tile.mask === 0 && tile.lo === Band.WATER) {
          this.waterA.putTileAt(waterIndex(0, variant), tx, ty);
          this.waterB.putTileAt(waterIndex(1, variant), tx, ty);
          continue;
        }
        if (tile.mask === 0) {
          const pack = packInterior[tile.lo];
          const usePack = pack && hash(tx, ty, 2) < 0.7;
          const index = usePack
            ? TOWN_GID + pack![Math.floor(hash(tx, ty, 3) * pack!.length)]!
            : interiorIndex(tile.lo, variant);
          this.terrain.putTileAt(index, tx, ty);
          continue;
        }
        this.terrain.putTileAt(transitionIndex(tile.lo, tile.mask), tx, ty);
      }
    }

    this.waterB.setVisible(false);
    if (GENERATED_TOTAL > TOWN_GID) throw new Error("generated tileset collides with the pack's gid range");
    this.time.addEvent({
      delay: 560,
      loop: true,
      callback: () => {
        const showA = !this.waterA.visible;
        this.waterA.setVisible(showA);
        this.waterB.setVisible(!showA);
      },
    });
  }

  /** One world unit per screen pixel at the current zoom: line widths are drawn in screen terms. */
  private screenPx(): number {
    return 1 / (this.cameras.main?.zoom || 1);
  }

  /** Territory boundaries and the liquidation line, as light over the ground. Redrawn on zoom. */
  private drawBoundaries() {
    const { grid } = this.opts;
    this.boundaryLines?.destroy();
    const g = this.add.graphics().setDepth(DEPTH.boundaries);
    const px = this.screenPx();
    glowLines(g, grid.boundaries, T.ley, T.leyBright, px);
    glowLines(g, grid.shoreline, T.peril, T.perilBright, px);
    this.boundaryLines = g;
  }

  /* ── terraces (layer 2) ───────────────────────────────────────────── */

  /** Replace the defence geometry: stone platforms over the price × dwell bands. */
  setTerraces(terraces: Terrace[]) {
    const { grid } = this.opts;
    this.terraces = terraces;
    this.terraceLayer.fill(-1);
    this.terraceGlow?.destroy();
    this.terraceGlow = this.add.graphics().setDepth(DEPTH.terraceGlow);

    for (const t of terraces) {
      const x0 = Math.max(0, Math.floor(t.priceFxLo * grid.cols));
      const x1 = Math.min(grid.cols - 1, Math.ceil(t.priceFxHi * grid.cols) - 1);
      const y0 = Math.max(0, Math.floor(dwellFyToTileY(t.dwellFyHi, grid.rows)));
      const y1 = Math.min(grid.rows - 1, Math.ceil(dwellFyToTileY(t.dwellFyLo, grid.rows)) - 1);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const row = ty === y0 ? TERRACE.top : ty === y1 ? TERRACE.bottom : TERRACE.body;
          const col = tx === x0 ? 0 : tx === x1 ? 2 : 1;
          this.terraceLayer.putTileAt(TOWN_GID + row[col]!, tx, ty);
        }
      }
      glowRect(this.terraceGlow, x0 * TILE_PX, y0 * TILE_PX, (x1 - x0 + 1) * TILE_PX, (y1 - y0 + 1) * TILE_PX, T.ley, T.leyBright, this.screenPx());
    }
  }

  /* ── figures (layer 3) ────────────────────────────────────────────── */

  private figureDepth(ty: number): number {
    return DEPTH.figures + (ty / this.opts.grid.rows) * 0.5;
  }

  /** Trees on interior grass and highland, chosen per tile by hash — never scattered. */
  private plantTrees() {
    const { grid } = this.opts;
    for (let ty = 0; ty < grid.rows; ty++) {
      for (let tx = 0; tx < grid.cols; tx++) {
        const tile = grid.tiles[ty * grid.cols + tx]!;
        if (tile.mask !== 0 || this.terraceLayer.hasTileAt(tx, ty)) continue;
        const list = tile.lo === Band.GRASS ? TREES.grass : tile.lo === Band.HIGHLAND ? TREES.highland : null;
        if (!list) continue;
        const density = tile.lo === Band.GRASS ? 0.14 : 0.09;
        if (hash(tx, ty, 8) > density) continue;
        const frame = list[Math.floor(hash(tx, ty, 9) * list.length)]!;
        this.add
          .image((tx + 0.5) * TILE_PX, (ty + 1) * TILE_PX, SHEET.town, frame)
          .setOrigin(0.5, 1)
          .setScale(SCALE)
          .setDepth(this.figureDepth(ty));
      }
    }
  }

  /** One seat per territory, composed from the pack, with a flag in its zone colour. */
  private raiseCitadels() {
    const { grid } = this.opts;
    grid.citadels.forEach((c, i) => {
      const zone = grid.zones.find((z) => z.index === c.zone)!;
      const rows = SEATS[seatKindFor(c.share)];
      const w = rows[0]!.length;
      const h = rows.length;
      const left = (c.tx + 0.5) * TILE_PX - (w * TILE_PX) / 2;
      const top = (c.ty + 1) * TILE_PX - h * TILE_PX;
      const depth = this.figureDepth(c.ty);
      const colour = ZONE_COLOURS[i % ZONE_COLOURS.length]!;

      // The aura: the seat's claim on the ground, brighter under the pointer.
      const aura = this.add
        .ellipse(left + (w * TILE_PX) / 2, top + h * TILE_PX, w * TILE_PX * 1.05, SCALE * 5, colour, 0.22)
        .setDepth(depth - 0.01);

      const images: Phaser.GameObjects.Image[] = [];
      rows.forEach((row, ry) =>
        row.forEach((frame, rx) => {
          if (frame < 0) return;
          images.push(this.add.image(left + rx * TILE_PX, top + ry * TILE_PX, SHEET.town, frame).setOrigin(0, 0).setScale(SCALE));
        }),
      );

      const flag = this.add.graphics();
      const poleX = left + w * TILE_PX - SCALE * 3;
      flag.fillStyle(0x4a4238, 1);
      flag.fillRect(poleX, top - SCALE * 6, SCALE, SCALE * 8);
      flag.fillStyle(colour, 1);
      flag.fillTriangle(poleX + SCALE, top - SCALE * 6, poleX + SCALE * 7, top - SCALE * 4, poleX + SCALE, top - SCALE * 2);

      const seat = this.add.container(0, 0, [...images, flag]).setDepth(depth);
      seat.setInteractive(
        new Phaser.Geom.Rectangle(left, top - SCALE * 6, w * TILE_PX, h * TILE_PX + SCALE * 6),
        Phaser.Geom.Rectangle.Contains,
      );
      const hover = (entered: boolean) => {
        this.hoverCitadel = entered ? c.deploymentId : null;
        aura.setFillStyle(colour, entered ? 0.6 : 0.22);
        for (const img of images) entered ? img.setTint(0xeaffff) : img.clearTint();
        const payload: CitadelHover = {
          deploymentId: c.deploymentId,
          share: c.share,
          exposure: zone.exposure,
          liquidationPrice: zone.liquidationPrice,
          entered,
        };
        this.events.emit(EV.citadelHover, payload);
      };
      seat.on("pointerover", () => hover(true));
      seat.on("pointerout", () => hover(false));
    });
  }

  /**
   * One guardian per way to die: the serpent in the western water where a
   * crash liquidates you, the beast on the eastern shore where a pump does.
   */
  private placeGuardians() {
    const { grid } = this.opts;
    const ty = Math.floor(grid.rows * 0.55);
    const wetAt = (tx: number) => grid.tiles[ty * grid.cols + tx]!.lo === Band.WATER;
    const seek = (from: number, step: number) => {
      for (let tx = from; tx >= 0 && tx < grid.cols; tx += step) if (wetAt(tx)) return tx;
      return null;
    };
    const mid = Math.floor(grid.cols / 2);
    if (this.opts.crashZone) {
      const shore = seek(mid, -1);
      if (shore !== null) this.spawnGuardian("serpent", FRAME.serpent, Math.max(2, shore - 3), ty);
    }
    if (this.opts.pumpZone) {
      const shore = seek(mid, 1);
      if (shore !== null) this.spawnGuardian("drake", FRAME.beast, Math.min(grid.cols - 3, shore + 2), ty - 1);
    }
  }

  private spawnGuardian(kind: "serpent" | "drake", frame: number, tx: number, ty: number) {
    const x = (tx + 0.5) * TILE_PX;
    const y = (ty + 1) * TILE_PX;
    const sprite = this.add.image(x, y, SHEET.dungeon, frame).setOrigin(0.5, 1).setScale(SCALE * 1.3).setAlpha(0.65).setDepth(this.figureDepth(ty));
    this.tweens.add({ targets: sprite, y: y - SCALE * 1.5, duration: kind === "drake" ? 3200 : 2600, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.guardians.push({ kind, sprite, x, y, stirred: false });
  }

  private placeAvatar() {
    const { grid } = this.opts;
    const x = grid.today.fx * this.worldW;
    const y = this.worldH - SCALE * 4;
    this.avatar = this.add.sprite(x, y, SHEET.dungeon, FRAME.avatar).setOrigin(0.5, 1).setScale(SCALE * 1.1).setDepth(DEPTH.avatar);
    this.avatar.enableFilters();
    this.avatar.filters?.internal.addGlow(T.ley, 2, 0, 1);

    const halo = this.add.circle(x, y - SCALE, SCALE * 4, T.ley, 0).setStrokeStyle(2, T.ley, 0.7).setDepth(DEPTH.avatarHalo);
    this.tweens.add({ targets: halo, scale: { from: 0.7, to: 2.2 }, alpha: { from: 0.8, to: 0 }, duration: 2000, repeat: -1, ease: "Quad.Out" });
    this.events.on("update", () => halo.setPosition(this.avatar.x, this.avatar.y - SCALE));
  }

  /* ── camera and input ─────────────────────────────────────────────── */

  private wireCamera() {
    const cam = this.cameras.main;
    const fit = () => {
      const v = mapViewport(this.scale.width, this.scale.height);
      cam.setViewport(v.x, v.y, v.w, v.h);
    };
    fit();
    this.scale.on("resize", fit, this);
    cam.setBounds(0, 0, this.worldW, this.worldH);
    // Open on the whole survey where the screen allows it, never below native
    // pixel size for the art; the wheel zooms in from there.
    cam.setZoom(this.fitZoom());
    cam.centerOn(this.avatar.x, this.avatar.y - TILE_PX * 3);
    cam.startFollow(this.avatar, true, 0.08, 0.08);
  }

  private fitZoom(): number {
    const v = mapViewport(this.scale.width, this.scale.height);
    return Phaser.Math.Clamp(Math.min(v.w / this.worldW, v.h / this.worldH), 1 / SCALE, 1);
  }

  private inViewport(pointer: Phaser.Input.Pointer): boolean {
    const v = mapViewport(this.scale.width, this.scale.height);
    return pointer.x >= v.x && pointer.x < v.x + v.w && pointer.y >= v.y && pointer.y < v.y + v.h;
  }

  private wireInput() {
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.inViewport(pointer)) {
        this.events.emit(EV.hoverEnd);
        return;
      }
      if (this.hoverCitadel) return; // the citadel's own event is richer
      const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const { fx, fy } = this.worldToFractions(p.x, p.y);
      this.events.emit(EV.zoneHover, this.opts.readAt(fx, fy));
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() || !this.inViewport(pointer) || this.hoverCitadel) return;
      const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const { fx, fy } = this.worldToFractions(p.x, p.y);
      this.walkTo(fx, fy);
    });

    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.inViewport(pointer)) return;
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.12), this.fitZoom(), 2.5));
      this.drawBoundaries();
      this.setTerraces(this.terraces);
    });

    this.game.canvas.addEventListener("mouseleave", () => this.events.emit(EV.hoverEnd));
  }

  override update() {
    this.watchGuardians();
  }

  /* ── coordinates ──────────────────────────────────────────────────── */

  private worldToFractions(x: number, y: number): { fx: number; fy: number } {
    const fx = Phaser.Math.Clamp(x / this.worldW, 0, 1);
    const tileY = Phaser.Math.Clamp(y / TILE_PX, 0, this.opts.grid.rows);
    const rootFy = 1 - tileY / this.opts.grid.rows;
    return { fx, fy: rootFy * rootFy };
  }

  private fractionsToWorld(fx: number, fy: number): { x: number; y: number } {
    return { x: fx * this.worldW, y: dwellFyToTileY(fy, this.opts.grid.rows) * TILE_PX };
  }

  /* ── walking ──────────────────────────────────────────────────────── */

  /** Walk the surveyor to a point on the map. Where he stands is a scenario. */
  walkTo(fx: number, fy: number) {
    const target = this.fractionsToWorld(Phaser.Math.Clamp(fx, 0.01, 0.99), Phaser.Math.Clamp(fy, 0, 0.99));
    const dist = Math.hypot(target.x - this.avatar.x, target.y - this.avatar.y);
    this.walk?.destroy();
    this.tweens.killTweensOf(this.avatar);
    this.avatar.setFlipX(target.x < this.avatar.x);
    const bob = this.tweens.add({ targets: this.avatar, scaleY: SCALE * 1.1 * 0.92, duration: 140, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.walk = this.tweens.add({
      targets: this.avatar,
      x: target.x,
      y: target.y,
      duration: Math.max(120, (dist / (110 * SCALE)) * 1000),
      ease: "Linear",
      onComplete: () => {
        bob.destroy();
        this.avatar.setScale(SCALE * 1.1);
        this.arrive(fx, fy);
      },
    });
  }

  private arrive(fx: number, fy: number) {
    const reading = this.opts.readAt(fx, fy);
    if (reading.drowned) {
      this.cameras.main.flash(260, 226, 96, 58);
      this.cameras.main.shake(180, 0.004);
    }
    this.events.emit(EV.arrive, reading);
  }

  private watchGuardians() {
    for (const g of this.guardians) {
      const near = Math.hypot(g.x - this.avatar.x, g.y - this.avatar.y) < TILE_PX * 6;
      if (near && !g.stirred) {
        g.stirred = true;
        g.sprite.setAlpha(1);
        this.tweens.add({ targets: g.sprite, scale: SCALE * 1.5, duration: 380, yoyo: true });
        this.cameras.main.shake(140, 0.0025);
        const zoneId = g.kind === "serpent" ? this.opts.crashZone : this.opts.pumpZone;
        const zone = this.opts.grid.zones.find((z) => z.deploymentId === zoneId);
        const payload: GuardianEvent = { kind: g.kind, deploymentId: zoneId, liquidationPrice: zone?.liquidationPrice ?? null };
        this.events.emit(EV.guardian, payload);
      } else if (!near && g.stirred) {
        g.stirred = false;
        g.sprite.setAlpha(0.65);
      }
    }
  }

  /* ── scouts ───────────────────────────────────────────────────────── */

  /** Walk the simulation's price paths as figures; the drowned stay where they fell. */
  sendScouts(paths: ScoutPath[]) {
    if (this.scoutsRunning || paths.length === 0) return;
    this.scoutsRunning = true;
    let finished = 0;
    let survived = 0;
    const duration = 4200;

    for (const path of paths) {
      const scout = this.add.image(this.avatar.x, this.avatar.y - SCALE * 2, MOTE_KEY).setScale(SCALE * 0.7).setDepth(DEPTH.scouts).setAlpha(0.9);
      const steps = path.diedAt === null ? path.points.length - 1 : path.diedAt;
      const walked = path.points.slice(0, Math.max(1, steps) + 1);
      const perStep = duration / Math.max(1, path.points.length - 1);
      const chain: Phaser.Types.Tweens.TweenBuilderConfig[] = walked.slice(1).map((p) => {
        const w = this.fractionsToWorld(p.fx, p.fy);
        return { targets: scout, x: w.x, y: w.y, duration: perStep, ease: "Linear" };
      });
      const done = () => {
        finished++;
        if (path.diedAt === null) {
          survived++;
          this.tweens.add({ targets: scout, alpha: 0, duration: 400, onComplete: () => scout.destroy() });
        } else {
          scout.setTint(T.perilBright).setAlpha(1);
          this.tweens.add({ targets: scout, alpha: 0.35, duration: 6000, delay: 1200 });
        }
        if (finished === paths.length) {
          this.scoutsRunning = false;
          const payload: ScoutsEvent = { survived, total: paths.length };
          this.events.emit(EV.scouts, payload);
        }
      };
      if (chain.length === 0) {
        done();
        continue;
      }
      // The chain reports through its last tween: a chain-level onComplete is
      // not part of the chain builder's config.
      chain[chain.length - 1]!.onComplete = done;
      this.tweens.chain({ targets: scout, tweens: chain });
    }
  }

  private ensureMoteTexture() {
    if (this.textures.exists(MOTE_KEY)) return;
    const size = 8;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(232,254,255,1)");
    grad.addColorStop(0.45, "rgba(53,224,232,0.7)");
    grad.addColorStop(1, "rgba(53,224,232,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    this.textures.addCanvas(MOTE_KEY, canvas);
  }
}
