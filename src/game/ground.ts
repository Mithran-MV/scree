import Phaser from "phaser";
import { Band, type TerrainGrid } from "./terrain";
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
import { CLUTTER, FX, SHEET } from "./figures";
import { hash, planClutter } from "./clutter";
import { LAYOUT } from "./layout";

const TOWN_GID = 1000;
const GENERATED_KEY = "scree-terrain";
export const SCALE = LAYOUT.scale;
export const TILE_PX = TILE * SCALE;

export interface GroundDepths {
  water: number;
  shallows: number;
  terrain: number;
}

/**
 * The ground as tilemap layers: deep water at the bottom, then the shallows
 * and the foaming shore, dry ground above, where interior tiles come from the
 * pack or the generator and every edge is a generated transition chosen by
 * the tile's corner mask. Shared by the survey and the landing's teaser, so
 * both draw the same world.
 */
export class Ground {
  readonly map: Phaser.Tilemaps.Tilemap;
  readonly water: Phaser.Tilemaps.TilemapLayer;
  readonly shallows: Phaser.Tilemaps.TilemapLayer;
  readonly terrain: Phaser.Tilemaps.TilemapLayer;
  readonly worldW: number;
  readonly worldH: number;

  /** Tiles the water clock repaints, and the shore foam beside them. */
  private waterTiles: { tx: number; ty: number; variant: number; band: Band }[] = [];
  private shoreTiles: { tx: number; ty: number; mask: number }[] = [];
  private frame = 0;

  constructor(
    readonly scene: Phaser.Scene,
    readonly grid: TerrainGrid,
    depths: GroundDepths,
  ) {
    if (GENERATED_TOTAL > TOWN_GID) throw new Error("generated tileset collides with the pack's gid range");
    buildTerrainTileset(scene, GENERATED_KEY, materialsFromPack(scene, SHEET.town));
    this.worldW = grid.cols * TILE_PX;
    this.worldH = grid.rows * TILE_PX;

    this.map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: grid.cols, height: grid.rows });
    const generated = this.map.addTilesetImage("generated", GENERATED_KEY, TILE, TILE, 0, 0, 0)!;
    const town = this.map.addTilesetImage("town", SHEET.town, TILE, TILE, 0, 0, TOWN_GID)!;
    const sets = [generated, town];
    const blank = (name: string, depth: number) => {
      const layer = this.map.createBlankLayer(name, sets, 0, 0, grid.cols, grid.rows, TILE, TILE)!;
      layer.setScale(SCALE).setDepth(depth);
      return layer;
    };
    this.water = blank("water", depths.water);
    this.shallows = blank("shallows", depths.shallows);
    this.terrain = blank("terrain", depths.terrain);

    // Interiors the pack draws better than the generator: its grass tiles
    // seamlessly. Everything else, and every fourth-variant feature tile, is
    // generated.
    const packGrass = [0, 0, 0, 0, 1, 1, 2];
    for (let ty = 0; ty < grid.rows; ty++) {
      for (let tx = 0; tx < grid.cols; tx++) {
        const tile = grid.tiles[ty * grid.cols + tx]!;
        const variant = Math.floor(hash(tx, ty, 1) * 3);
        if (tile.mask === 0) {
          if (tile.lo <= Band.DEEP) {
            this.water.putTileAt(waterIndex(tile.lo, 0, variant), tx, ty);
            this.waterTiles.push({ tx, ty, variant, band: tile.lo });
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
        if (tile.lo === Band.ABYSS) {
          this.water.putTileAt(transitionIndex(Band.ABYSS, tile.mask), tx, ty);
        } else if (tile.lo === Band.DEEP) {
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

  get layers(): Phaser.Tilemaps.TilemapLayer[] {
    return [this.water, this.shallows, this.terrain];
  }

  /** The sea rolls one frame: every water tile steps through its frames, the shore foam at half the rate. */
  tick(): void {
    this.frame = (this.frame + 1) % (WATER_FRAMES * 2);
    const wf = this.frame % WATER_FRAMES;
    const sf = Math.floor(this.frame / 2) % SHORE_FRAMES;
    for (const w of this.waterTiles) {
      (w.band === Band.SHALLOW ? this.shallows : this.water).putTileAt(waterIndex(w.band, wf, w.variant), w.tx, w.ty);
    }
    for (const s of this.shoreTiles) this.shallows.putTileAt(shoreIndex(s.mask, sf), s.tx, s.ty);
  }

  /** Start the sea's clock for the life of the scene. */
  animate(): Phaser.Time.TimerEvent {
    return this.scene.time.addEvent({ delay: 130, loop: true, callback: () => this.tick() });
  }

  /**
   * Fill the biomes from the planner: trees, pines, rocks, ruins, peaks, and
   * crystals that pulse. Returns everything placed, so a camera can ignore it.
   */
  scatter(blocked: (tx: number, ty: number) => boolean, depthAt: (y: number) => number): Phaser.GameObjects.GameObject[] {
    const placed: Phaser.GameObjects.GameObject[] = [];
    for (const p of planClutter(this.grid, blocked)) {
      const cat = CLUTTER[p.kind];
      const frame = cat.frames[p.variant % cat.frames.length]!;
      const x = (p.tx + p.ox) * TILE_PX;
      const y = (p.ty + p.oy) * TILE_PX;
      const depth = depthAt(y);
      placed.push(this.scene.add.image(x, y, cat.sheet, frame).setOrigin(0.5, 1).setScale(SCALE).setDepth(depth));
      if (p.kind === "crystal") {
        const glow = this.scene.add.image(x, y - SCALE * 6, SHEET.fx, FX.glow).setScale(SCALE * 1.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth - 0.001).setAlpha(0.5);
        this.scene.tweens.add({
          targets: glow,
          alpha: { from: 0.25, to: 0.85 },
          scale: { from: SCALE * 0.9, to: SCALE * 1.5 },
          duration: 1500 + hash(p.tx, p.ty, 5) * 1400,
          yoyo: true,
          repeat: -1,
          ease: "Sine.InOut",
        });
        placed.push(glow);
      }
    }
    return placed;
  }
}
