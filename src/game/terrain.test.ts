import { describe, expect, it } from "vitest";
import { bracket } from "@/core/bracket";
import { CARRY_BOOK, SPOT_ETH_USD } from "@/core/fixtures/carry-book";
import { dwellAt, fittedWindow, priceAt, rasterize } from "@/field/raster";
import { dwellYears, elevation } from "@/core/kernel";
import { Band, CORNER, RELIEF, TILE_PX, bandOf, buildTerrainGrid, dwellFyToTileY, footprintCells, heightAt, isWater, mapFxOf, priceFxToTileX, surveyWindow, warpFx } from "./terrain";

const br = bracket(CARRY_BOOK, 0);
const win = fittedWindow(SPOT_ETH_USD, br.lower, br.upper);
const raster = rasterize(CARRY_BOOK, win);
const grid = buildTerrainGrid(raster, CARRY_BOOK, SPOT_ETH_USD);

const fxOf = (price: number) => {
  const lo = priceAt(win, 0);
  const hi = priceAt(win, win.width - 1);
  return Math.log(price / lo) / Math.log(hi / lo);
};
const tileAt = (tx: number, ty: number) => grid.tiles[ty * grid.cols + tx]!;

describe("bandOf", () => {
  it("puts everything below sea level under water: shelf, deep and abyss as fractions of the floor", () => {
    expect(bandOf(-0.001, 1, -0.3)).toBe(Band.SHALLOW);
    expect(bandOf(-0.05, 1, -0.3)).toBe(Band.SHALLOW);
    expect(bandOf(-0.07, 1, -0.3)).toBe(Band.DEEP);
    expect(bandOf(-0.25, 1, -0.3)).toBe(Band.ABYSS);
    expect(bandOf(-5, 1, -0.3)).toBe(Band.ABYSS);
    expect(isWater(Band.ABYSS)).toBe(true);
    expect(isWater(Band.DEEP)).toBe(true);
    expect(isWater(Band.COAST)).toBe(false);
  });

  it("climbs through the biomes with elevation", () => {
    expect(bandOf(0, 1)).toBe(Band.COAST);
    expect(bandOf(0.3, 1)).toBe(Band.GRASS);
    expect(bandOf(0.5, 1)).toBe(Band.FOREST);
    expect(bandOf(0.7, 1)).toBe(Band.MOUNTAIN);
    expect(bandOf(0.95, 1)).toBe(Band.SNOW);
  });
});

describe("buildTerrainGrid", () => {
  it("covers the field at one tile per TILE_PX cells", () => {
    expect(grid.cols).toBe(raster.window.width / TILE_PX);
    expect(grid.rows).toBe(raster.window.height / TILE_PX);
    expect(grid.tiles).toHaveLength(grid.cols * grid.rows);
    expect(grid.corners).toHaveLength((grid.cols + 1) * (grid.rows + 1));
  });

  it("gives every tile a mask that agrees with the corners it shares with its neighbours", () => {
    const cw = grid.cols + 1;
    for (let ty = 0; ty < grid.rows; ty++) {
      for (let tx = 0; tx < grid.cols; tx++) {
        const tile = tileAt(tx, ty);
        const c = [grid.corners[ty * cw + tx]!, grid.corners[ty * cw + tx + 1]!, grid.corners[(ty + 1) * cw + tx]!, grid.corners[(ty + 1) * cw + tx + 1]!];
        expect(tile.lo).toBe(Math.min(...c));
        const mask =
          (c[0]! > tile.lo ? CORNER.TL : 0) |
          (c[1]! > tile.lo ? CORNER.TR : 0) |
          (c[2]! > tile.lo ? CORNER.BL : 0) |
          (c[3]! > tile.lo ? CORNER.BR : 0);
        expect(tile.mask).toBe(mask);
        expect(tile.hi).toBe(mask === 0 ? tile.lo : tile.lo + 1);
      }
    }
  });

  it("never needs a tile with all four corners high", () => {
    for (const t of grid.tiles) expect(t.mask).toBeLessThan(15);
  });

  it("puts the crash edge on the shoreline of the bottom row", () => {
    const bottom = grid.rows - 1;
    const wet = tileAt(Math.floor(priceFxToTileX(mapFxOf(fxOf(br.lower! * 0.9), 0), grid.cols)), bottom);
    const dry = tileAt(Math.floor(priceFxToTileX(mapFxOf(fxOf(br.lower! * 1.12), 0), grid.cols)), bottom);
    expect(isWater(wet.lo)).toBe(true);
    expect(isWater(dry.lo)).toBe(false);
    expect(grid.shoreline.length).toBeGreaterThan(0);
  });

  it("stands the surveyor on dry ground at today's price", () => {
    expect(grid.today.fx).toBeGreaterThan(0);
    expect(grid.today.fx).toBeLessThan(1);
    const tile = tileAt(Math.min(grid.cols - 1, Math.floor(grid.today.fx * grid.cols)), grid.rows - 1);
    expect(isWater(tile.lo)).toBe(false);
  });

  it("seats each holdfast on the highest dry ground its territory owns, with its whole footprint on that ground", () => {
    expect(grid.zones.length).toBeGreaterThan(0);
    expect(grid.citadels).toHaveLength(grid.zones.length);
    for (const c of grid.citadels) {
      const anchor = tileAt(c.tx, c.ty);
      expect(anchor.mask).toBe(0);
      expect(anchor.owner).toBe(c.zone);
      for (const cell of footprintCells(c.tx, c.ty, c.footprint)) {
        const t = tileAt(cell.tx, cell.ty);
        expect(isWater(t.lo)).toBe(false);
        expect(t.owner).toBe(c.zone);
      }
      expect(c.ty - c.footprint.rise + 1).toBeGreaterThanOrEqual(0);
      // No interior tile the zone owns, with room for the footprint, stands higher.
      for (let ty = c.footprint.rise - 1; ty < grid.rows; ty++) {
        for (let tx = 0; tx < grid.cols; tx++) {
          const t = tileAt(tx, ty);
          if (t.owner !== c.zone || t.mask !== 0 || isWater(t.lo)) continue;
          const fits = footprintCells(tx, ty, c.footprint).every((cell) => {
            if (cell.tx < 0 || cell.ty < 0 || cell.tx >= grid.cols || cell.ty >= grid.rows) return false;
            const u = tileAt(cell.tx, cell.ty);
            return u.owner === c.zone && !isWater(u.lo);
          });
          if (fits) expect(t.z).toBeLessThanOrEqual(c.z + 1e-9);
        }
      }
    }
  });

  it("marks every border tile on dry ground beside a tile another deployment binds", () => {
    expect(grid.borders.length).toBeGreaterThan(0);
    for (const b of grid.borders) {
      const t = tileAt(b.tx, b.ty);
      expect(isWater(t.lo)).toBe(false);
      const east = b.tx + 1 < grid.cols ? tileAt(b.tx + 1, b.ty) : null;
      const south = b.ty + 1 < grid.rows ? tileAt(b.tx, b.ty + 1) : null;
      const differs = (n: typeof t | null) => !!n && n.owner >= 0 && !isWater(n.lo) && n.owner !== t.owner;
      expect(differs(east) || differs(south)).toBe(true);
    }
  });

  it("marks the pass where a long book meets a short one, and a fault on the rest", () => {
    const kinds = new Set(grid.borders.map((b) => b.kind));
    // The reference book is mixed, so it has both a pass and a same-side handover.
    expect(kinds.has("pass")).toBe(true);
    expect(kinds.has("fault")).toBe(true);
  });

  it("keeps every holdfast clear of the map edge", () => {
    for (const c of grid.citadels) {
      expect(c.ty).toBeLessThan(grid.rows - RELIEF.seatMargin);
      expect(c.ty - c.footprint.rise + 1).toBeGreaterThanOrEqual(RELIEF.seatMargin);
      expect(c.tx - Math.floor(c.footprint.w / 2)).toBeGreaterThanOrEqual(RELIEF.seatMargin);
    }
  });
});

describe("relief", () => {
  it("bends the price axis and bends it back", () => {
    for (const [fx, fy] of [[0.2, 0.1], [0.5, 0.5], [0.8, 0.9], [0.05, 0.3]] as const) {
      expect(Math.abs(warpFx(mapFxOf(fx, fy), fy) - fx)).toBeLessThan(1e-4);
    }
  });

  it("bends the coast: the shoreline is not a straight vertical line", () => {
    const xs = grid.shoreline.filter((s) => s.y1 < grid.rows / 2).map((s) => s.x1);
    const west = xs.filter((x) => x < grid.cols / 2);
    expect(Math.max(...west) - Math.min(...west)).toBeGreaterThan(2);
  });

  it("never moves sea level: relief keeps every point on the side of the shore the book puts it", () => {
    const { width: fw, height: fh } = raster.window;
    const ceiling = grid.ceiling;
    for (let i = 0; i < 400; i++) {
      const col = (i * 37) % fw;
      const row = (i * 53) % fh;
      const { z } = heightAt(raster, CARRY_BOOK, col, row, ceiling);
      const colField = warpFx(col / (fw - 1), row / (fh - 1)) * (fw - 1);
      const raw = elevation(CARRY_BOOK, priceAt(win, colField), dwellYears(dwellAt(win, row)));
      if (!Number.isFinite(raw) || raw === 0) continue;
      expect(Math.sign(z)).toBe(Math.sign(raw));
    }
  });

  it("ranks territories by share of the dry ground, largest first", () => {
    const shares = grid.zones.map((z) => z.share);
    for (let i = 1; i < shares.length; i++) expect(shares[i]!).toBeLessThanOrEqual(shares[i - 1]!);
    const sum = shares.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
  });
});

describe("the sea", () => {
  it("has all three water bands in the survey window", () => {
    const w = surveyWindow(SPOT_ETH_USD, br.lower, br.upper);
    const g = buildTerrainGrid(rasterize(CARRY_BOOK, w), CARRY_BOOK, SPOT_ETH_USD);
    const count = (b: Band) => g.tiles.filter((t) => t.lo === b).length;
    expect(count(Band.SHALLOW)).toBeGreaterThan(0);
    expect(count(Band.DEEP)).toBeGreaterThan(0);
    expect(count(Band.ABYSS)).toBeGreaterThan(0);
    // Rock outnumbers snow: the ridge is a range with a capped crest, not a snowfield.
    expect(count(Band.MOUNTAIN)).toBeGreaterThan(count(Band.SNOW));
  });
});

describe("surveyWindow", () => {
  it("is landscape-shaped and holds the bracket in about two thirds of its width, sea on both sides", () => {
    const w = surveyWindow(SPOT_ETH_USD, br.lower, br.upper);
    expect(w.width).toBeGreaterThan(w.height);
    const lo = priceAt(w, 0);
    const hi = priceAt(w, w.width - 1);
    const f = (p: number) => Math.log(p / lo) / Math.log(hi / lo);
    expect(f(br.lower!)).toBeGreaterThan(0.1);
    expect(f(br.lower!)).toBeLessThan(0.25);
    expect(f(br.upper!)).toBeGreaterThan(0.75);
    expect(f(br.upper!)).toBeLessThan(0.9);
  });
});

describe("axis helpers", () => {
  it("maps dwell zero to the bottom row and the full window to the top, square-rooted like the field", () => {
    expect(dwellFyToTileY(0, 64)).toBe(64);
    expect(dwellFyToTileY(1, 64)).toBe(0);
    expect(dwellFyToTileY(0.25, 64)).toBe(32);
  });

  it("maps price fractions linearly across the columns", () => {
    expect(priceFxToTileX(0.5, 64)).toBe(32);
  });
});
