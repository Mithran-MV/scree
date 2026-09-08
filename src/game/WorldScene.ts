import Phaser from "phaser";
import { Band, dwellFyToTileY, footprintCells, isWater, type Segment, type TerrainGrid } from "./terrain";
import {
  GENERATED_TOTAL,
  SHORE_FRAMES,
  TILE,
  WATER_FRAMES,
  buildTerrainTileset,
  interiorIndex,
  materialsFromPack,
  shoreIndex,
  transitionIndex,
  waterIndex,
} from "./tileset";
import { CLUTTER, FX, MONSTERS, SHEET, SURVEYOR, TERRACE, WALL_PIECES, ZONE_COLOURS } from "./figures";
import { hash, planClutter } from "./clutter";
import { blueprintFor, greetingFor } from "./holdfasts";
import { LAYOUT, mapViewport } from "./layout";
import { EV, type CitadelHover, type GuardianEvent, type MonsterEvent, type ScoutsEvent, type WelcomeEvent, type ZoneReading } from "./events";
import { Surveyor } from "./Surveyor";
import { SeaMonster } from "./SeaMonster";
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
  ui: UIData;
}

const TOWN_GID = 1000;
const ROADS_GID = 2000;
const GENERATED_KEY = "scree-terrain";
const MOTE_KEY = "scree-mote";
const SCALE = LAYOUT.scale;
const TILE_PX = TILE * SCALE;
const WALK_SPEED = 110 * SCALE;

/**
 * Depth plan. Everything in the world sits on one of these shelves; what
 * stands on the ground is y-sorted inside the ground shelf so that a peak or
 * a keep overlaps whatever is behind it.
 */
export const DEPTH = {
  water: 0,
  shallows: 1,
  terrain: 10,
  roads: 12,
  lines: 14,
  terraces: 16,
  terraceGlow: 17,
  ground: 20, // + y-sort, up to 24
  particles: 25,
  scouts: 28,
  surveyor: 30,
} as const;

interface Anchor {
  x: number;
  y: number;
  deploymentId: string;
  greeting: string;
  share: number;
  zoneIndex: number;
  visited: boolean;
}

/** A line of light: wide faint passes under a thin bright one, in screen-pixel widths. */
function glowLines(g: Phaser.GameObjects.Graphics, segs: readonly Segment[], colour: number, bright: number, px: number, strength = 1) {
  const passes: [number, number, number][] = [
    [px * 7, colour, 0.14 * strength],
    [px * 3.5, colour, 0.3 * strength],
    [px * 1.4, bright, 0.9 * strength],
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
  private water!: Phaser.Tilemaps.TilemapLayer;
  private shallows!: Phaser.Tilemaps.TilemapLayer;
  private terrain!: Phaser.Tilemaps.TilemapLayer;
  private roads!: Phaser.Tilemaps.TilemapLayer;
  private terraceLayer!: Phaser.Tilemaps.TilemapLayer;
  private terraceGlow!: Phaser.GameObjects.Graphics;
  private boundaryLines!: Phaser.GameObjects.Graphics;
  private terraces: Terrace[] = [];

  /** Tiles the water clock repaints, and the shore foam beside them. */
  private waterTiles: { tx: number; ty: number; variant: number; band: Band }[] = [];
  private shoreTiles: { tx: number; ty: number; mask: number }[] = [];
  private waterFrame = 0;

  private surveyor!: Surveyor;
  private monsters: SeaMonster[] = [];
  private stirred = new Set<SeaMonster>();
  private anchors: Anchor[] = [];
  private blocked = new Set<string>();
  private hoverCitadel: string | null = null;
  private hoverMonster: SeaMonster | null = null;
  private scoutsRunning = false;

  constructor() {
    super({ key: "WorldScene" });
  }

  init(data: WorldData) {
    this.opts = data;
  }

  /** Every sheet the world stands on: two CC0 packs and the sheets baked from them. */
  preload() {
    const f16 = { frameWidth: 16, frameHeight: 16 };
    this.load.spritesheet(SHEET.town, "/assets/kenney/tiny-town/tilemap_packed.png", f16);
    this.load.spritesheet(SHEET.dungeon, "/assets/kenney/tiny-dungeon/tilemap_packed.png", f16);
    this.load.spritesheet(SHEET.surveyor, "/assets/scree/surveyor.png", { frameWidth: SURVEYOR.frameWidth, frameHeight: SURVEYOR.frameHeight });
    this.load.spritesheet(SHEET.monsters, "/assets/scree/monsters.png", { frameWidth: MONSTERS.frameWidth, frameHeight: MONSTERS.frameHeight });
    this.load.spritesheet(SHEET.clutter, "/assets/scree/clutter.png", f16);
    this.load.spritesheet(SHEET.peaks, "/assets/scree/peaks.png", { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet(SHEET.fx, "/assets/scree/fx.png", f16);
    this.load.image(SHEET.roads, "/assets/scree/roads.png");
  }

  create() {
    const { grid } = this.opts;
    this.worldW = grid.cols * TILE_PX;
    this.worldH = grid.rows * TILE_PX;
    Surveyor.registerAnimations(this);
    SeaMonster.registerAnimations(this);

    this.buildTileset();
    this.buildLayers();
    this.animateTiles();
    this.drawLines();
    this.setTerraces(this.opts.terraces);
    this.raiseBorders();
    this.raiseHoldfasts();
    this.placeSurveyor();
    this.scatterClutter();
    this.spawnLeviathans();
    this.wireCamera();
    this.wireInput();

    // The interface is its own scene, launched over this one. Scenes render
    // in list order, so it is brought to the top explicitly.
    this.scene.launch("UIScene", this.opts.ui);
    this.scene.bringToTop("UIScene");
  }

  /** Y-sorted depth inside the ground shelf: lower on screen draws later. */
  private ySort(y: number): number {
    return DEPTH.ground + Phaser.Math.Clamp(y / this.worldH, 0, 0.999) * 4;
  }

  private key(tx: number, ty: number): string {
    return `${tx},${ty}`;
  }

  /* ── tiles ────────────────────────────────────────────────────────── */

  private buildTileset() {
    const materials = materialsFromPack(this, SHEET.town);
    buildTerrainTileset(this, GENERATED_KEY, materials);
    this.ensureMoteTexture();
  }

  /**
   * Five tilemap layers from one grid. Deep water at the bottom, then the
   * shallows and the foaming shore; dry ground above, where interior tiles
   * come from the pack or the generator and every edge is a generated
   * transition chosen by the tile's corner mask; roads; terraces.
   */
  private buildLayers() {
    const { grid } = this.opts;
    if (GENERATED_TOTAL > TOWN_GID) throw new Error("generated tileset collides with the pack's gid range");
    this.map = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: grid.cols, height: grid.rows });
    const generated = this.map.addTilesetImage("generated", GENERATED_KEY, TILE, TILE, 0, 0, 0)!;
    const town = this.map.addTilesetImage("town", SHEET.town, TILE, TILE, 0, 0, TOWN_GID)!;
    const roads = this.map.addTilesetImage("roads", SHEET.roads, TILE, TILE, 0, 0, ROADS_GID)!;
    const sets = [generated, town, roads];

    const blank = (name: string, depth: number) => {
      const layer = this.map.createBlankLayer(name, sets, 0, 0, grid.cols, grid.rows, TILE, TILE)!;
      layer.setScale(SCALE).setDepth(depth);
      return layer;
    };
    this.water = blank("water", DEPTH.water);
    this.shallows = blank("shallows", DEPTH.shallows);
    this.terrain = blank("terrain", DEPTH.terrain);
    this.roads = blank("roads", DEPTH.roads);
    this.terraceLayer = blank("terraces", DEPTH.terraces);

    // Interiors the pack draws better than the generator: its grass tiles
    // seamlessly. Everything else, and every fourth-variant feature tile, is
    // generated.
    const packGrass = [0, 0, 0, 0, 1, 1, 2];

    for (let ty = 0; ty < grid.rows; ty++) {
      for (let tx = 0; tx < grid.cols; tx++) {
        const tile = grid.tiles[ty * grid.cols + tx]!;
        const variant = Math.floor(hash(tx, ty, 1) * 3);

        if (tile.mask === 0) {
          if (tile.lo === Band.DEEP) {
            this.water.putTileAt(waterIndex(Band.DEEP, 0, variant), tx, ty);
            this.waterTiles.push({ tx, ty, variant, band: Band.DEEP });
          } else if (tile.lo === Band.SHALLOW) {
            this.shallows.putTileAt(waterIndex(Band.SHALLOW, 0, variant), tx, ty);
            this.waterTiles.push({ tx, ty, variant, band: Band.SHALLOW });
          } else if (hash(tx, ty, 2) < 0.08) {
            this.terrain.putTileAt(interiorIndex(tile.lo, 3), tx, ty);
          } else if (tile.lo === Band.GRASS && hash(tx, ty, 3) < 0.7) {
            this.terrain.putTileAt(TOWN_GID + packGrass[Math.floor(hash(tx, ty, 4) * packGrass.length)]!, tx, ty);
          } else {
            this.terrain.putTileAt(interiorIndex(tile.lo, variant), tx, ty);
          }
          continue;
        }

        if (tile.lo === Band.DEEP) {
          this.shallows.putTileAt(transitionIndex(Band.DEEP, tile.mask), tx, ty);
        } else if (tile.lo === Band.SHALLOW) {
          this.shallows.putTileAt(shoreIndex(tile.mask, 0), tx, ty);
          this.shoreTiles.push({ tx, ty, mask: tile.mask });
        } else {
          this.terrain.putTileAt(transitionIndex(tile.lo, tile.mask), tx, ty);
        }
      }
    }
  }

  /** The sea rolls: every water tile steps through its frames, the shore foam at half the rate. */
  private animateTiles() {
    this.time.addEvent({
      delay: 130,
      loop: true,
      callback: () => {
        this.waterFrame = (this.waterFrame + 1) % (WATER_FRAMES * 2);
        const wf = this.waterFrame % WATER_FRAMES;
        const sf = Math.floor(this.waterFrame / 2) % SHORE_FRAMES;
        for (const w of this.waterTiles) {
          (w.band === Band.DEEP ? this.water : this.shallows).putTileAt(waterIndex(w.band, wf, w.variant), w.tx, w.ty);
        }
        for (const s of this.shoreTiles) this.shallows.putTileAt(shoreIndex(s.mask, sf), s.tx, s.ty);
      },
    });
  }

  /** One world unit per screen pixel at the current zoom: line widths are drawn in screen terms. */
  private screenPx(): number {
    return 1 / (this.cameras.main?.zoom || 1);
  }

  /** The liquidation line as light along the shore, and a faint ley under the borders' roads and walls. */
  private drawLines() {
    const { grid } = this.opts;
    this.boundaryLines?.destroy();
    const g = this.add.graphics().setDepth(DEPTH.lines);
    const px = this.screenPx();
    glowLines(g, grid.boundaries, T.ley, T.leyBright, px, 0.45);
    glowLines(g, grid.shoreline, T.peril, T.perilBright, px);
    this.boundaryLines = g;
  }

  /* ── terraces ─────────────────────────────────────────────────────── */

  /** Replace the defence geometry: castle-wall platforms over the price × dwell bands. */
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

  /* ── borders ──────────────────────────────────────────────────────── */

  /** The creases made physical: cobbled roads where books of one side hand over, ruined walls on the pass. */
  private raiseBorders() {
    for (const b of this.opts.grid.borders) {
      this.blocked.add(this.key(b.tx, b.ty));
      if (b.kind === "road") {
        this.roads.putTileAt(ROADS_GID + Math.floor(hash(b.tx, b.ty, 9) * 3), b.tx, b.ty);
        continue;
      }
      if (hash(b.tx, b.ty, 10) < 0.22) continue; // a gap in the wall: it is a ruin
      const x = (b.tx + 0.5) * TILE_PX;
      const y = (b.ty + 1) * TILE_PX;
      const piece = WALL_PIECES[Math.floor(hash(b.tx, b.ty, 11) * WALL_PIECES.length)]!;
      this.add.image(x, y, SHEET.town, piece).setOrigin(0.5, 1).setScale(SCALE).setDepth(this.ySort(y));
      if (hash(b.tx, b.ty, 12) > 0.6) {
        const upper = WALL_PIECES[Math.floor(hash(b.tx, b.ty, 13) * WALL_PIECES.length)]!;
        this.add.image(x, y - TILE_PX * 0.9, SHEET.town, upper).setOrigin(0.5, 1).setScale(SCALE).setDepth(this.ySort(y) + 0.001);
      }
    }
  }

  /* ── holdfasts ────────────────────────────────────────────────────── */

  /**
   * One holdfast per territory, on its highest ground, built from the
   * blueprint of its protocol's family and given its living parts: windows
   * that glow, a gear that turns, an orb that floats, a chimney that smokes,
   * flags that wave. Hovering it names the seat; walking up to it is greeted.
   */
  private raiseHoldfasts() {
    const { grid } = this.opts;
    grid.citadels.forEach((c, i) => {
      const zone = grid.zones.find((z) => z.index === c.zone)!;
      const bp = blueprintFor(c.deploymentId, c.share);
      const w = bp.rows[0]!.length;
      const h = bp.rows.length;
      const left = (c.tx + 0.5) * TILE_PX - (w * TILE_PX) / 2;
      const bottom = (c.ty + 1) * TILE_PX;
      const top = bottom - h * TILE_PX;
      const depth = this.ySort(bottom);
      const colour = ZONE_COLOURS[i % ZONE_COLOURS.length]!;

      for (const cell of footprintCells(c.tx, c.ty, { w: w + 2, h: h + 1 })) this.blocked.add(this.key(cell.tx, cell.ty));

      // The aura: the seat's claim on the ground, brighter under the pointer.
      const aura = this.add.ellipse(left + (w * TILE_PX) / 2, bottom, w * TILE_PX * 1.1, SCALE * 6, colour, 0.22).setDepth(depth - 0.002);

      const images: Phaser.GameObjects.Image[] = [];
      bp.rows.forEach((row, ry) =>
        row.forEach((frame, rx) => {
          if (frame < 0) return;
          images.push(this.add.image(left + rx * TILE_PX, top + ry * TILE_PX, SHEET.town, frame).setOrigin(0, 0).setScale(SCALE).setDepth(depth));
        }),
      );

      bp.windows.forEach(([cx, cy], k) => {
        const win = this.add
          .image(left + (cx + 0.5) * TILE_PX, top + (cy + 0.5) * TILE_PX, SHEET.fx, FX.window)
          .setScale(SCALE)
          .setDepth(depth + 0.001)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: win, alpha: { from: 0.3, to: 0.95 }, duration: 1500 + k * 350, delay: k * 500, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      });

      if (bp.gear) {
        const gear = this.add.image(left + (bp.gear[0] + 0.5) * TILE_PX, top + (bp.gear[1] + 0.5) * TILE_PX, SHEET.fx, FX.cog).setScale(SCALE * 0.95).setDepth(depth + 0.002);
        this.tweens.add({ targets: gear, angle: 360, duration: 6000, repeat: -1 });
      }

      if (bp.orb) {
        const ox = left + (bp.orb[0] + 1) * TILE_PX;
        const oy = top - TILE_PX * 0.55;
        const glow = this.add.image(ox, oy, SHEET.fx, FX.glow).setScale(SCALE * 1.4).setDepth(depth + 0.002).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.6);
        const orb = this.add.image(ox, oy, SHEET.fx, FX.orb).setScale(SCALE).setDepth(depth + 0.003);
        this.tweens.add({ targets: [orb, glow], y: oy - SCALE * 3, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.InOut" });
        this.tweens.add({ targets: glow, alpha: { from: 0.35, to: 0.85 }, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      }

      if (bp.chimney) {
        const smoke = this.add.particles(left + (bp.chimney[0] + 0.5) * TILE_PX, top + bp.chimney[1] * TILE_PX + SCALE * 2, SHEET.fx, {
          frame: FX.smoke,
          lifespan: { min: 1800, max: 2600 },
          speedY: { min: -14, max: -24 },
          speedX: { min: -5, max: 5 },
          scale: { start: SCALE * 0.45, end: SCALE * 1.3 },
          alpha: { start: 0.45, end: 0 },
          frequency: 420,
        });
        smoke.setDepth(depth + 0.004);
      }

      for (const [fx, fy] of bp.flags) {
        const px = left + (fx + 0.5) * TILE_PX;
        const py = top + fy * TILE_PX;
        const pole = this.add.rectangle(px, py, SCALE, SCALE * 9, 0x4a4238).setOrigin(0.5, 1).setDepth(depth + 0.001);
        const flag = this.add.triangle(px + SCALE * 0.5, py - SCALE * 9, 0, 0, SCALE * 7, SCALE * 2, 0, SCALE * 4, colour).setOrigin(0, 0).setDepth(depth + 0.002);
        this.tweens.add({ targets: flag, scaleX: { from: 1, to: 0.55 }, duration: 700 + hash(fx, fy, i) * 400, yoyo: true, repeat: -1, ease: "Sine.InOut" });
        void pole;
      }

      // An invisible zone over the whole structure takes the pointer.
      const hit = this.add.zone(left, top - SCALE * 9, w * TILE_PX, h * TILE_PX + SCALE * 9).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      const hover = (entered: boolean) => {
        this.hoverCitadel = entered ? c.deploymentId : null;
        aura.setFillStyle(colour, entered ? 0.6 : 0.22);
        for (const img of images) entered ? img.setTint(0xeaffff) : img.clearTint();
        const payload: CitadelHover = { deploymentId: c.deploymentId, share: c.share, exposure: zone.exposure, liquidationPrice: zone.liquidationPrice, entered };
        this.events.emit(EV.citadelHover, payload);
      };
      hit.on("pointerover", () => hover(true));
      hit.on("pointerout", () => hover(false));

      this.anchors.push({
        x: left + (w * TILE_PX) / 2,
        y: bottom,
        deploymentId: c.deploymentId,
        greeting: greetingFor(c.deploymentId, c.share),
        share: c.share,
        zoneIndex: c.zone,
        visited: false,
      });
    });
  }

  /* ── clutter ──────────────────────────────────────────────────────── */

  /** The biomes filled from the planner: trees, pines, rocks, ruins, peaks, crystals that pulse. */
  private scatterClutter() {
    const { grid } = this.opts;
    const blocked = (tx: number, ty: number) => this.blocked.has(this.key(tx, ty)) || this.terraceLayer.hasTileAt(tx, ty) || this.roads.hasTileAt(tx, ty);
    for (const p of planClutter(grid, blocked)) {
      const cat = CLUTTER[p.kind];
      const frame = cat.frames[p.variant % cat.frames.length]!;
      const x = (p.tx + p.ox) * TILE_PX;
      const y = (p.ty + p.oy) * TILE_PX;
      const depth = this.ySort(y);
      this.add.image(x, y, cat.sheet, frame).setOrigin(0.5, 1).setScale(SCALE).setDepth(depth);
      if (p.kind === "crystal") {
        const glow = this.add.image(x, y - SCALE * 6, SHEET.fx, FX.glow).setScale(SCALE * 1.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth - 0.001).setAlpha(0.5);
        this.tweens.add({
          targets: glow,
          alpha: { from: 0.25, to: 0.85 },
          scale: { from: SCALE * 0.9, to: SCALE * 1.5 },
          duration: 1500 + hash(p.tx, p.ty, 5) * 1400,
          yoyo: true,
          repeat: -1,
          ease: "Sine.InOut",
        });
      }
    }
  }

  /* ── the surveyor ─────────────────────────────────────────────────── */

  private placeSurveyor() {
    const { grid } = this.opts;
    const x = grid.today.fx * this.worldW;
    const y = this.worldH - SCALE * 4;
    const tx = Math.floor(x / TILE_PX);
    for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) this.blocked.add(this.key(tx + dx, grid.rows - 1 - dy));
    this.surveyor = new Surveyor(this, x, y, DEPTH.surveyor);
  }

  /* ── leviathans ───────────────────────────────────────────────────── */

  /**
   * One leviathan per deep basin. Deep water is split into its connected
   * basins first, so a monster never crosses land to reach a waypoint, and
   * waypoints sit at least two tiles from anything that is not deep.
   */
  private spawnLeviathans() {
    const { grid } = this.opts;
    const deepAt = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < grid.cols && ty < grid.rows && grid.tiles[ty * grid.cols + tx]!.lo === Band.DEEP && grid.tiles[ty * grid.cols + tx]!.mask === 0;
    const open = (tx: number, ty: number) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!deepAt(tx + dx, ty + dy)) return false;
      return true;
    };
    const seen = new Set<string>();
    const basins: { tx: number; ty: number }[][] = [];
    for (let ty = 0; ty < grid.rows; ty++) {
      for (let tx = 0; tx < grid.cols; tx++) {
        if (!open(tx, ty) || seen.has(this.key(tx, ty))) continue;
        const basin: { tx: number; ty: number }[] = [];
        const queue = [{ tx, ty }];
        seen.add(this.key(tx, ty));
        while (queue.length) {
          const cur = queue.pop()!;
          basin.push(cur);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = cur.tx + dx;
            const ny = cur.ty + dy;
            if (open(nx, ny) && !seen.has(this.key(nx, ny))) {
              seen.add(this.key(nx, ny));
              queue.push({ tx: nx, ty: ny });
            }
          }
        }
        if (basin.length >= 10) basins.push(basin);
      }
    }
    basins.sort((a, b) => b.length - a.length);
    if (basins.length === 0) return;

    MONSTERS.kinds.forEach((spec, i) => {
      const basin = basins[i % basins.length]!;
      const pick = () => {
        const t = basin[Math.floor(Math.random() * basin.length)]!;
        return { x: (t.tx + 0.5) * TILE_PX, y: (t.ty + 0.5) * TILE_PX };
      };
      const start = pick();
      const monster = new SeaMonster(this, start.x, start.y, spec, {
        pickWaypoint: pick,
        depthAt: (y) => this.ySort(y),
        onHover: (m, entered, pointer) => {
          this.hoverMonster = entered ? m : null;
          this.events.emit(EV.monsterHover, this.monsterEvent(m, entered, pointer));
        },
        onClick: (m, pointer) => this.events.emit(EV.monsterClick, this.monsterEvent(m, true, pointer)),
      });
      this.monsters.push(monster);
    });
  }

  private monsterEvent(m: SeaMonster, entered: boolean, pointer: Phaser.Input.Pointer): MonsterEvent {
    const { fx, fy } = this.worldToFractions(m.x, m.y);
    return { key: m.spec.key, name: m.spec.name, warning: m.spec.warning, entered, x: pointer.x, y: pointer.y, reading: this.opts.readAt(fx, fy) };
  }

  /* ── camera and input ─────────────────────────────────────────────── */

  private fitZoom(): number {
    const v = mapViewport(this.scale.width, this.scale.height);
    return Phaser.Math.Clamp(Math.min(v.w / this.worldW, v.h / this.worldH), 1 / SCALE, 1);
  }

  private wireCamera() {
    const cam = this.cameras.main;
    const fit = () => {
      const v = mapViewport(this.scale.width, this.scale.height);
      cam.setViewport(v.x, v.y, v.w, v.h);
    };
    fit();
    this.scale.on("resize", fit, this);
    cam.setBounds(0, 0, this.worldW, this.worldH);
    cam.setZoom(this.fitZoom());
    cam.centerOn(this.surveyor.x, this.surveyor.y - TILE_PX * 3);
    cam.startFollow(this.surveyor, true, 0.08, 0.08);
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
      if (this.hoverCitadel || this.hoverMonster) return; // their own events are richer
      const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const { fx, fy } = this.worldToFractions(p.x, p.y);
      this.events.emit(EV.zoneHover, this.opts.readAt(fx, fy));
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() || !this.inViewport(pointer) || this.hoverCitadel || this.hoverMonster) return;
      const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const { fx, fy } = this.worldToFractions(p.x, p.y);
      this.walkTo(fx, fy);
    });

    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.inViewport(pointer)) return;
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.12), this.fitZoom(), 2.5));
      this.drawLines();
      this.setTerraces(this.terraces);
    });

    this.game.canvas.addEventListener("mouseleave", () => this.events.emit(EV.hoverEnd));
  }

  override update() {
    this.watchLeviathans();
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
    this.surveyor.walkTo(target.x, target.y, WALK_SPEED, () => this.arrive(fx, fy));
  }

  private arrive(fx: number, fy: number) {
    const reading = this.opts.readAt(fx, fy);
    if (reading.drowned) {
      this.cameras.main.flash(260, 226, 96, 58);
      this.cameras.main.shake(180, 0.004);
    }
    this.events.emit(EV.arrive, reading);

    // A holdfast within a few tiles greets him, once per visit.
    for (const a of this.anchors) {
      const near = Math.hypot(a.x - this.surveyor.x, a.y - this.surveyor.y) < TILE_PX * 4;
      if (near && !a.visited) {
        a.visited = true;
        const zone = this.opts.grid.zones.find((z) => z.index === a.zoneIndex);
        const payload: WelcomeEvent = {
          deploymentId: a.deploymentId,
          greeting: a.greeting,
          share: a.share,
          exposure: zone?.exposure ?? "FLAT",
          liquidationPrice: zone?.liquidationPrice ?? null,
        };
        this.events.emit(EV.welcome, payload);
      } else if (!near && a.visited && Math.hypot(a.x - this.surveyor.x, a.y - this.surveyor.y) > TILE_PX * 6) {
        a.visited = false;
      }
    }
  }

  /** A leviathan near the surveyor stirs: once per approach, with its warning. */
  private watchLeviathans() {
    for (const m of this.monsters) {
      const near = !m.submerged && Math.hypot(m.x - this.surveyor.x, m.y - this.surveyor.y) < TILE_PX * 6;
      if (near && !this.stirred.has(m)) {
        this.stirred.add(m);
        this.tweens.add({ targets: m, scale: m.scale * 1.25, duration: 300, yoyo: true });
        this.cameras.main.shake(140, 0.0025);
        const { fx, fy } = this.worldToFractions(m.x, m.y);
        const payload: GuardianEvent = { key: m.spec.key, name: m.spec.name, warning: m.spec.warning, reading: this.opts.readAt(fx, fy) };
        this.events.emit(EV.guardian, payload);
      } else if (!near && this.stirred.has(m) && Math.hypot(m.x - this.surveyor.x, m.y - this.surveyor.y) > TILE_PX * 9) {
        this.stirred.delete(m);
      }
    }
  }

  /* ── scouts ───────────────────────────────────────────────────────── */

  /** Walk the simulation's price paths as motes; the drowned stay where they fell. */
  sendScouts(paths: ScoutPath[]) {
    if (this.scoutsRunning || paths.length === 0) return;
    this.scoutsRunning = true;
    let finished = 0;
    let survived = 0;
    const duration = 4200;

    for (const path of paths) {
      const scout = this.add.image(this.surveyor.x, this.surveyor.y - SCALE * 2, MOTE_KEY).setScale(SCALE * 0.7).setDepth(DEPTH.scouts).setAlpha(0.9);
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
void isWater;
