import { describe, expect, it } from "vitest";
import { bracket } from "@/core/bracket";
import { CARRY_BOOK, SPOT_ETH_USD } from "@/core/fixtures/carry-book";
import { fittedWindow, priceAt, rasterize } from "@/field/raster";
import { Band, CORNER, TILE_PX, bandOf, buildTerrainGrid, dwellFyToTileY, priceFxToTileX } from "./terrain";

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
  it("puts everything below sea level under water", () => {
    expect(bandOf(-0.001, 1)).toBe(Band.WATER);
    expect(bandOf(-5, 1)).toBe(Band.WATER);
  });

  it("climbs through the bands with elevation", () => {
    expect(bandOf(0, 1)).toBe(Band.COAST);
    expect(bandOf(0.3, 1)).toBe(Band.GRASS);
    expect(bandOf(0.8, 1)).toBe(Band.HIGHLAND);
    expect(bandOf(1, 1)).toBe(Band.MOUNTAIN);
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
    const wet = tileAt(Math.floor(priceFxToTileX(fxOf(br.lower! * 0.9), grid.cols)), bottom);
    const dry = tileAt(Math.floor(priceFxToTileX(fxOf(br.lower! * 1.12), grid.cols)), bottom);
    expect(wet.lo).toBe(Band.WATER);
    expect(dry.lo).toBeGreaterThan(Band.WATER);
    expect(grid.shoreline.length).toBeGreaterThan(0);
  });

  it("stands the surveyor on dry ground at today's price", () => {
    expect(grid.today.fx).toBeGreaterThan(0);
    expect(grid.today.fx).toBeLessThan(1);
    const tile = tileAt(Math.min(grid.cols - 1, Math.floor(grid.today.fx * grid.cols)), grid.rows - 1);
    expect(tile.lo).toBeGreaterThan(Band.WATER);
  });

  it("seats each territory's citadel on interior dry ground it owns", () => {
    expect(grid.zones.length).toBeGreaterThan(0);
    expect(grid.citadels).toHaveLength(grid.zones.length);
    for (const c of grid.citadels) {
      const tile = tileAt(c.tx, c.ty);
      expect(tile.mask).toBe(0);
      expect(tile.lo).toBeGreaterThan(Band.WATER);
      expect(tile.owner).toBe(c.zone);
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
