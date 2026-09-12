import Phaser from "phaser";
import { Band, dwellFyToTileY, footprintCells, type Segment, type TerrainGrid } from "./terrain";
import { TILE } from "./tileset";
import { CLUTTER, FX, MONSTERS, SCOUT, SHEET, ZONE_COLOURS } from "./figures";
import { hash } from "./clutter";
import { blueprintFor, greetingFor } from "./holdfasts";
import { LAYOUT, mapViewport } from "./layout";
import { logical } from "./screen";
import { EV, type CitadelHover, type GuardianEvent, type MonsterEvent, type ScoutsEvent, type WelcomeEvent, type ZoneReading } from "./events";
import { Ground } from "./ground";
import { loadWorldSheets } from "./assets";
import { audio } from "./audio";
import { Surveyor } from "./Surveyor";
import { SeaMonster } from "./SeaMonster";
import { T } from "./theme";
import type { UIData } from "./UIScene";

/** A round price on the scale under the map, and the map column that shows it. */
export interface PriceTick {
  price: number;
  fx: number;
}

/**
 * A high-water mark on the scale: the price at which a borrower who opened
 * at a deployment's maximum LTV today is liquidated, one per deployment.
 */
export interface PriceMark {
  deploymentId: string;
  price: number;
  fx: number;
}

/** A mark with the colour of the deployment's ground, for the interface to letter. */
export interface PlacedMark extends PriceMark {
  colour: number;
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
  axis: { ticks: PriceTick[]; marks?: PriceMark[] };
  ui: UIData;
}

const SCOUT_ANIM = { march: "scout-march", drowned: "scout-drowned" } as const;
const SCALE = LAYOUT.scale;
const TILE_PX = TILE * SCALE;
const WALK_SPEED = 120 * SCALE;
/** The scale strip under the map, in world pixels: room for the camera to hold the surveyor above the edge. */
export const AXIS_H = TILE_PX * 6;

/**
 * Depth plan. Everything in the world sits on one of these shelves; what
 * stands on the ground is y-sorted inside the ground shelf so that a peak or
 * a keep overlaps whatever is behind it.
 */
export const DEPTH = {
  water: 0,
  shallows: 1,
  axis: 5,
  terrain: 10,
  lines: 14,
  ground: 20, // + y-sort, up to 24: clutter, seats, leviathans and the surveyor alike
  particles: 25,
  scouts: 28,
} as const;

/** Camera zoom for a closer look at a point of interest. */
const POI_ZOOM = { seat: 1.25, surveyor: 1.5 } as const;

/** A holdfast's place in the world, for the interface to hang a banner on and for the surveyor to be greeted at. */
export interface Anchor {
  x: number;
  y: number;
  /** World y of the structure's top. */
  top: number;
  deploymentId: string;
  greeting: string;
  share: number;
  colour: number;
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

  private ground!: Ground;
  private boundaryLines!: Phaser.GameObjects.Graphics;

  private surveyor!: Surveyor;
  private home = { x: 0, y: 0 };
  private monsters: SeaMonster[] = [];
  private stirred = new Set<SeaMonster>();
  private anchors: Anchor[] = [];

  /** The holdfasts, for the interface. */
  get holdfasts(): readonly Anchor[] {
    return this.anchors;
  }

  get worldWidth(): number {
    return this.worldW;
  }

  get worldHeight(): number {
    return this.worldH;
  }

  /** The scale under the map, for the interface. */
  /** The high-water marks on the scale, coloured by the ground they belong to. */
  get axisMarks(): readonly PlacedMark[] {
    return this.marks;
  }

  get axisTicks(): readonly PriceTick[] {
    return this.opts.axis.ticks;
  }
  private blocked = new Set<string>();
  private hoverCitadel: string | null = null;
  private hoverMonster: SeaMonster | null = null;
  private scoutsRunning = false;

  constructor() {
    super({ key: "WorldScene" });
  }

  /** A restart (a new book) begins from nothing: every list the last run filled is emptied here. */
  init(data: WorldData) {
    this.marks = [];
    this.axisGfx = undefined;
    this.opts = data;
    this.monsters = [];
    this.stirred = new Set();
    this.anchors = [];
    this.blocked = new Set();
    this.hoverCitadel = null;
    this.hoverMonster = null;
    this.scoutsRunning = false;
  }

  /** Every sheet the world stands on; the landing may have loaded them already, in which case nothing is queued. */
  preload() {
    loadWorldSheets(this);
  }

  create() {
    const { grid } = this.opts;
    Surveyor.registerAnimations(this);
    SeaMonster.registerAnimations(this);

    this.ground = new Ground(this, grid, { water: DEPTH.water, shallows: DEPTH.shallows, terrain: DEPTH.terrain });
    this.worldW = this.ground.worldW;
    this.worldH = this.ground.worldH;
    this.ground.animate();
    this.registerScoutAnimations();
    this.drawLines();
    this.drawAxis();
    this.raiseFaults();
    this.raiseHoldfasts();
    if (this.opts.axis.marks) this.setAxisMarks(this.opts.axis.marks);
    this.placeSurveyor();
    this.scatterClutter();
    this.spawnLeviathans();
    this.wireCamera();
    this.wireInput();

    // The interface is its own scene, launched over this one. Scenes render
    // in list order, so it is brought to the top explicitly.
    this.scene.launch("UIScene", this.opts.ui);
    this.scene.bringToTop("UIScene");
    audio.music("survey");
  }

  /** Y-sorted depth inside the ground shelf: lower on screen draws later. */
  private ySort(y: number): number {
    return DEPTH.ground + Phaser.Math.Clamp(y / this.worldH, 0, 0.999) * 4;
  }

  private marks: PlacedMark[] = [];
  private axisGfx: Phaser.GameObjects.Graphics | undefined;

  private key(tx: number, ty: number): string {
    return `${tx},${ty}`;
  }

  /** World units per CSS pixel at the current zoom: line widths are drawn in screen terms. */
  private screenPx(): number {
    return logical(this).D / (this.cameras.main?.zoom || 1);
  }

  /** The liquidation line as light along the shore, and the faults as ley that breathes under the crags. */
  private drawLines() {
    const { grid } = this.opts;
    this.boundaryLines?.destroy();
    const g = this.add.graphics().setDepth(DEPTH.lines);
    const px = this.screenPx();
    glowLines(g, grid.boundaries, T.ley, T.leyBright, px, 0.7);
    glowLines(g, grid.shoreline, T.peril, T.perilBright, px);
    this.tweens.add({ targets: g, alpha: { from: 0.55, to: 1 }, duration: 1900, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.boundaryLines = g;
  }

  /* ── the scale ────────────────────────────────────────────────────── */

  /** The price scale under the map: the survey's paper margin, ruled and ticked. Labels are the interface's. */
  /** Set (or replace) the high-water marks and redraw the scale; the interface letters them. */
  setAxisMarks(marks: readonly PriceMark[]) {
    this.marks = marks.map((m) => ({
      ...m,
      colour: this.holdfasts.find((a) => a.deploymentId === m.deploymentId)?.colour ?? T.vellumInkDim,
    }));
    this.drawAxis();
  }

  private drawAxis() {
    this.axisGfx?.destroy();
    const g = this.add.graphics().setDepth(DEPTH.axis);
    this.axisGfx = g;
    g.fillStyle(T.vellum, 1);
    g.fillRect(0, this.worldH, this.worldW, AXIS_H);
    g.fillStyle(T.vellumEdge, 1);
    g.fillRect(0, this.worldH, this.worldW, SCALE * 2);
    g.fillStyle(T.vellumInk, 1);
    g.fillRect(0, this.worldH + SCALE * 2, this.worldW, SCALE);
    for (const tick of this.opts.axis.ticks) {
      const x = tick.fx * this.worldW;
      g.fillRect(x - SCALE * 0.5, this.worldH + SCALE * 2, SCALE, SCALE * 6);
    }
    for (let x = 0; x < this.worldW; x += TILE_PX) g.fillRect(x, this.worldH + SCALE * 2, SCALE * 0.5, SCALE * 2.5);
    // The high-water marks: a flag on a pole in the ground's colour, planted on the scale.
    for (const m of this.marks) {
      if (m.fx < 0 || m.fx > 1) continue;
      const x = m.fx * this.worldW;
      const top = this.worldH + SCALE * 3;
      g.fillStyle(T.vellumInk, 1);
      g.fillRect(x - SCALE * 0.5, top, SCALE, SCALE * 14);
      g.fillStyle(m.colour, 1);
      g.fillRect(x + SCALE * 0.5, top, SCALE * 6, SCALE * 4);
      g.fillStyle(T.vellumInk, 1);
      g.fillRect(x + SCALE * 0.5, top + SCALE * 4, SCALE * 6, SCALE * 0.5);
    }
  }

  /* ── borders ──────────────────────────────────────────────────────── */

  /**
   * The creases made physical: a chain of crags along each fault, denser
   * on the pass and studded with the stones of whatever once stood there.
   * The ley under them (drawLines) breathes; the crags sit where the argmin
   * changes, offset inside their tiles so the chain winds.
   */
  private raiseFaults() {
    const { grid } = this.opts;
    for (const b of grid.borders) {
      this.blocked.add(this.key(b.tx, b.ty));
      const pass = b.kind === "pass";
      if (hash(b.tx, b.ty, 10) > (pass ? 0.85 : 0.6)) continue;
      const band = grid.tiles[b.ty * grid.cols + b.tx]!.lo;
      const roll = hash(b.tx, b.ty, 11);
      const set = pass && roll < 0.3 ? CLUTTER.ruin : pass && roll < 0.4 ? CLUTTER.pillar : band === Band.SNOW ? CLUTTER.snowrock : CLUTTER.rock;
      const frame = set.frames[Math.floor(hash(b.tx, b.ty, 12) * set.frames.length)]!;
      const x = (b.tx + 0.25 + hash(b.tx, b.ty, 13) * 0.5) * TILE_PX;
      const y = (b.ty + 0.65 + hash(b.tx, b.ty, 14) * 0.3) * TILE_PX;
      this.add.image(x, y, set.sheet, frame).setOrigin(0.5, 1).setScale(SCALE).setDepth(this.ySort(y));
      if (hash(b.tx, b.ty, 15) > 0.55) {
        const second = CLUTTER.rock.frames[Math.floor(hash(b.tx, b.ty, 16) * 3)]!;
        const x2 = (b.tx + 0.2 + hash(b.tx, b.ty, 17) * 0.6) * TILE_PX;
        const y2 = (b.ty + 0.35 + hash(b.tx, b.ty, 18) * 0.3) * TILE_PX;
        this.add.image(x2, y2, CLUTTER.rock.sheet, second).setOrigin(0.5, 1).setScale(SCALE * 0.8).setDepth(this.ySort(y2));
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
      hit.on("pointerdown", () => {
        const gate = this.worldToFractions(left + (w * TILE_PX) / 2, bottom + TILE_PX * 0.8);
        this.walkTo(gate.fx, gate.fy);
        this.lookCloser(POI_ZOOM.seat);
      });

      this.anchors.push({
        x: left + (w * TILE_PX) / 2,
        y: bottom,
        top: top - SCALE * 9,
        deploymentId: c.deploymentId,
        greeting: greetingFor(c.deploymentId, c.share),
        share: c.share,
        colour,
        zoneIndex: c.zone,
        visited: false,
      });
    });
  }

  /* ── clutter ──────────────────────────────────────────────────────── */

  /** The biomes filled from the planner, y-sorted on the ground shelf. */
  private scatterClutter() {
    this.ground.scatter((tx, ty) => this.blocked.has(this.key(tx, ty)), (y) => this.ySort(y));
  }

  /* ── the surveyor ─────────────────────────────────────────────────── */

  /**
   * The surveyor starts at today's price, on the bottom row, beside a survey
   * peg that marks the spot. Clicking him, or the peg, brings the camera in.
   */
  private placeSurveyor() {
    const { grid } = this.opts;
    const x = grid.today.fx * this.worldW;
    const y = this.worldH - SCALE * 4;
    const tx = Math.floor(x / TILE_PX);
    for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 2; dy++) this.blocked.add(this.key(tx + dx, grid.rows - 1 - dy));
    this.home = { x, y };
    const peg = this.add.image(x + SCALE * 14, y, SHEET.fx, FX.peg).setOrigin(0.5, 1).setScale(SCALE).setDepth(this.ySort(y) - 0.002);
    peg.setInteractive({ useHandCursor: true });
    peg.on("pointerdown", () => {
      const back = this.worldToFractions(this.home.x, this.home.y);
      this.walkTo(back.fx, back.fy);
      this.lookCloser(POI_ZOOM.surveyor);
    });
    this.surveyor = new Surveyor(this, x, y);
    this.surveyor.setGroundDepth(this.ySort(y) + 0.002);
    this.surveyor.on("pointerdown", () => this.lookCloser(POI_ZOOM.surveyor));
  }

  /** Tween the camera in on the surveyor, then redraw what is drawn in screen pixels. */
  private lookCloser(zoom: number) {
    const cam = this.cameras.main;
    audio.sfx("zoom");
    // Points of interest are asked for in CSS pixels per world unit; the camera works in device pixels.
    const target = zoom * logical(this).D;
    cam.zoomTo(Math.max(target, this.fitZoom()), 1000, "Sine.easeInOut", true, (_c: Phaser.Cameras.Scene2D.Camera, progress: number) => {
      cam.setFollowOffset(0, this.followOffset());
      if (progress === 1) this.drawLines();
    });
  }

  /* ── leviathans ───────────────────────────────────────────────────── */

  /**
   * Leviathans in the deep. Deep water is split into its connected basins
   * first, so a monster never crosses land to reach a waypoint, and waypoints
   * keep a tile of deep water around them. Two patrol the eastern sea, one
   * the western; a book with one sea gets all three.
   */
  private spawnLeviathans() {
    const { grid } = this.opts;
    const deepAt = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < grid.cols && ty < grid.rows && grid.tiles[ty * grid.cols + tx]!.lo <= Band.DEEP && grid.tiles[ty * grid.cols + tx]!.mask === 0;
    const open = (tx: number, ty: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!deepAt(tx + dx, ty + dy)) return false;
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
    if (basins.length === 0) return;
    const centre = (b: { tx: number }[]) => b.reduce((s, t) => s + t.tx, 0) / b.length;
    basins.sort((a, b) => centre(b) - centre(a)); // east first
    const east = basins[0]!;
    const west = basins.length > 1 ? basins[basins.length - 1]! : east;

    MONSTERS.kinds.forEach((spec, i) => {
      const basin = i < 2 ? east : west;
      // The abyss is the widest water and sits at the map's edge; most
      // waypoints are drawn from the deep band beside the shelf instead, so
      // the leviathans range across the sea rather than hug the border.
      const deep = basin.filter((t) => grid.tiles[t.ty * grid.cols + t.tx]!.lo === Band.DEEP);
      const pick = () => {
        const from = deep.length > 4 && Math.random() < 0.65 ? deep : basin;
        const t = from[Math.floor(Math.random() * from.length)]!;
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
    const { D } = logical(this);
    return { key: m.spec.key, name: m.spec.name, warning: m.spec.warning, entered, x: pointer.x / D, y: pointer.y / D, reading: this.opts.readAt(fx, fy) };
  }

  /* ── camera and input ─────────────────────────────────────────────── */

  /** The map viewport in device pixels: the camera, unlike the interface, works in those. */
  private deviceViewport(): { x: number; y: number; w: number; h: number; D: number } {
    const { W, H, D } = logical(this);
    const v = mapViewport(W, H);
    return { x: v.x * D, y: v.y * D, w: v.w * D, h: v.h * D, D };
  }

  /** The zoom that shows the whole survey, in device pixels per world unit. */
  private fitZoom(): number {
    const v = this.deviceViewport();
    return Phaser.Math.Clamp(Math.min(v.w / this.worldW, v.h / (this.worldH + AXIS_H)), v.D / SCALE, v.D);
  }

  /** The closest the wheel or a pinch may bring the ground. */
  private maxZoom(): number {
    return 2.5 * logical(this).D;
  }

  /** Hold the surveyor below the viewport's centre, with the paper margin under him, so his ground is never at the edge. */
  private followOffset(): number {
    const v = this.deviceViewport();
    return (v.h / this.cameras.main.zoom) * 0.15;
  }

  private wireCamera() {
    const cam = this.cameras.main;
    const fit = () => {
      const v = this.deviceViewport();
      cam.setViewport(v.x, v.y, v.w, v.h);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.fitZoom(), this.maxZoom()));
      cam.setFollowOffset(0, this.followOffset());
      this.drawLines();
    };
    cam.setBounds(0, 0, this.worldW, this.worldH + AXIS_H);
    cam.setZoom(this.fitZoom());
    fit();
    this.scale.on("resize", fit, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off("resize", fit, this));
    cam.centerOn(this.surveyor.x, this.surveyor.y - this.followOffset());
    cam.startFollow(this.surveyor, true, 0.05, 0.05, 0, this.followOffset());
  }

  private inViewport(pointer: Phaser.Input.Pointer): boolean {
    const v = this.deviceViewport();
    return pointer.x >= v.x && pointer.x < v.x + v.w && pointer.y >= v.y && pointer.y < v.y + v.h;
  }

  /** Zoom within the survey's limits, keeping the surveyor's ground under him and the lines the right weight. */
  private setZoom(zoom: number) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(zoom, this.fitZoom(), this.maxZoom()));
    cam.setFollowOffset(0, this.followOffset());
    this.drawLines();
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

    let lastDown = 0;
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      // A click on a seat, a leviathan, the peg or the surveyor is theirs; the
      // list of what is under the pointer is exact where a remembered hover
      // would be stale after the camera has moved under a still pointer.
      if (pointer.rightButtonDown() || !this.inViewport(pointer) || over.length > 0) return;
      // A double click on the ground pulls the camera back out to the whole survey.
      const now = this.time.now;
      if (now - lastDown < 320) {
        lastDown = 0;
        this.lookCloser(this.fitZoom() / logical(this).D);
        return;
      }
      lastDown = now;
      if (this.input.pointer2?.isDown) return; // a second finger is a pinch, not a walk
      const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const { fx, fy } = this.worldToFractions(p.x, p.y);
      // A touch has no hover: the tap reads the ground it lands on before the walk begins.
      if (pointer.wasTouch) this.events.emit(EV.zoneHover, this.opts.readAt(fx, fy));
      this.walkTo(fx, fy);
    });

    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.inViewport(pointer)) return;
      this.setZoom(this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.12));
    });

    // Two fingers: the distance between them scales the zoom from where it was when they landed.
    this.input.addPointer(1);
    let pinch: { distance: number; zoom: number } | null = null;
    this.input.on("pointermove", () => {
      const a = this.input.pointer1;
      const b = this.input.pointer2;
      if (!a?.isDown || !b?.isDown) {
        pinch = null;
        return;
      }
      const distance = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (!pinch) {
        pinch = { distance, zoom: this.cameras.main.zoom };
        return;
      }
      this.setZoom((pinch.zoom * distance) / Math.max(1, pinch.distance));
    });
    this.input.on("pointerup", () => {
      pinch = null;
    });

    const canvas = this.game.canvas;
    const leave = () => this.events.emit(EV.hoverEnd);
    canvas.addEventListener("mouseleave", leave);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => canvas.removeEventListener("mouseleave", leave));
  }

  /** Strict y-sorting: the surveyor's depth is his feet, every frame, so he passes behind what stands lower on screen. */
  override update() {
    this.surveyor.setGroundDepth(this.ySort(this.surveyor.y) + 0.002);
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

  /** Where the surveyor stands, in world units, so the interface can keep its panel off him. */
  get surveyorPosition(): { x: number; y: number } {
    return { x: this.surveyor.x, y: this.surveyor.y };
  }

  /* ── walking ──────────────────────────────────────────────────────── */

  /** Walk the surveyor to a point on the map. Where he stands is a scenario. */
  walkTo(fx: number, fy: number) {
    const target = this.fractionsToWorld(Phaser.Math.Clamp(fx, 0.01, 0.99), Phaser.Math.Clamp(fy, 0, 0.99));
    audio.walking(true);
    this.surveyor.walkTo(target.x, target.y, WALK_SPEED, () => this.arrive(fx, fy));
  }

  private arrive(fx: number, fy: number) {
    const reading = this.opts.readAt(fx, fy);
    audio.walking(false);
    audio.sfx(reading.drowned ? "drown" : "arrive");
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

    paths.forEach((path, i) => {
      // Each scout is a small soldier off the baked sheet, marching in step
      // with the others but not in phase, and the column files out over half
      // a second rather than leaving in one lump.
      const scout = this.add.sprite(this.surveyor.x, this.surveyor.y, SHEET.scouts, i % 4).setOrigin(0.5, 1).setScale(SCALE * 0.6).setDepth(DEPTH.scouts);
      scout.play({ key: SCOUT_ANIM.march, startFrame: i % 4 });
      const steps = path.diedAt === null ? path.points.length - 1 : path.diedAt;
      const walked = path.points.slice(0, Math.max(1, steps) + 1);
      const perStep = duration / Math.max(1, path.points.length - 1);
      const chain: Phaser.Types.Tweens.TweenBuilderConfig[] = walked.slice(1).map((p, k) => {
        const w = this.fractionsToWorld(p.fx, p.fy);
        return { targets: scout, x: w.x, y: w.y, duration: perStep, ease: "Linear", delay: k === 0 ? (i % 24) * 18 : 0, onStart: () => scout.setFlipX(w.x < scout.x) };
      });
      const done = () => {
        finished++;
        if (path.diedAt === null) {
          survived++;
          this.tweens.add({ targets: scout, alpha: 0, duration: 400, onComplete: () => scout.destroy() });
        } else {
          // Sunk to the chest in the foam, and left there.
          scout.play(SCOUT_ANIM.drowned).setTint(0xffb8a8);
          this.tweens.add({ targets: scout, alpha: 0.45, duration: 6000, delay: 1500 });
        }
        if (finished === paths.length) {
          this.scoutsRunning = false;
          const payload: ScoutsEvent = { survived, total: paths.length };
          this.events.emit(EV.scouts, payload);
        }
      };
      if (chain.length === 0) {
        done();
        return;
      }
      // The chain reports through its last tween: a chain-level onComplete is
      // not part of the chain builder's config.
      chain[chain.length - 1]!.onComplete = done;
      this.tweens.chain({ targets: scout, tweens: chain });
    });
  }

  /** The scouts' march and their drowning, off the baked sheet. */
  private registerScoutAnimations() {
    const make = (key: string, range: readonly [number, number], frameRate: number) => {
      if (this.anims.exists(key)) return;
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(SHEET.scouts, { start: range[0], end: range[1] }), frameRate, repeat: -1 });
    };
    make(SCOUT_ANIM.march, SCOUT.march, 10);
    make(SCOUT_ANIM.drowned, SCOUT.drowned, 3);
  }
}

