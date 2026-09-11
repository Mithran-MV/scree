"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Basket } from "@/core/types";
import { bracket } from "@/core/bracket";
import { colOfPrice, dwellAt, priceAt, rasterize, sample } from "@/field/raster";
import { Band, CORNER, buildTerrainGrid, isWater, surveyWindow, type TerrainGrid } from "@/game/terrain";
import { ZONE_COLOURS } from "@/game/figures";
import { BAND_WORDS, FOAM, HAT, INK, LEY, LEY_DIM, MATERIALS, PERIL, VELLUM, VELLUM_EDGE, VELLUM_INK, css, dwellTicks, grainOf, hash, priceTicks, type Material, type RGB } from "@/render/pixel";

/**
 * The survey plate, drawn the way the world draws the ground: the same
 * terrain grid the map is built from, painted tile by tile in the tileset's
 * palette with its dither, the coast in foam, the territory borders as
 * ley-lines, the pass, each holdfast as a keep with its banner, today's
 * price where the surveyor stands, and the price and dwell scales. Under
 * the pointer, a reading of the tile.
 */

export interface PlateReading {
  price: number;
  dwellDays: number;
  hf: number;
  band: Band;
  owner: string | null;
  exposure: string | null;
  binder: string | null;
}

interface Props {
  baskets: Basket[];
  spot: number;
  onHover?: (r: PlateReading | null) => void;
}

/** Texels per tile: the world paints sixteen; four read as the same ground at the plate's size. */
const TEXELS = 4;
/** The scale strip along the foot, in tiles. */
const STRIP = 2;

const mix = (a: RGB, b: RGB, t: number): RGB => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const hexCss = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

export function PixelPlate({ baskets, spot, onHover }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ reading: PlateReading; tx: number; ty: number; px: number; py: number } | null>(null);
  const [scale, setScale] = useState(2);
  const [sprite, setSprite] = useState<HTMLImageElement | null>(null);

  const br = useMemo(() => bracket(baskets, 0), [baskets]);
  const win = useMemo(() => surveyWindow(spot, br.lower, br.upper), [spot, br]);
  const raster = useMemo(() => rasterize(baskets, win), [baskets, win]);
  const grid = useMemo(() => buildTerrainGrid(raster, baskets, spot), [raster, baskets, spot]);

  // The surveyor's first frame off the baked sheet, for today's price.
  useEffect(() => {
    const img = new Image();
    img.onload = () => setSprite(img);
    img.src = "/assets/scree/surveyor.png";
  }, []);

  // Texel size follows the plate's width so every texel is a whole number of device pixels.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      // Whole device pixels per texel, and no taller than most of the window, so the sheet is seen entire.
      const byWidth = (host.clientWidth * dpr) / (grid.cols * TEXELS);
      const byHeight = (window.innerHeight * 0.64 * dpr) / ((grid.rows + STRIP) * TEXELS);
      setScale(Math.max(1, Math.floor(Math.min(byWidth, byHeight))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [grid.cols]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const t = scale;
    const u = TEXELS * t;
    canvas.width = grid.cols * u;
    canvas.height = (grid.rows + STRIP) * u;
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;
    const pixelFace = getComputedStyle(host).getPropertyValue("--font-pixel").trim() || "monospace";
    paint(ctx, grid, win, t, dpr, sprite, pixelFace);
  }, [grid, win, scale, sprite]);

  const move = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const host = hostRef.current;
      if (!canvas || !host) return;
      const rect = canvas.getBoundingClientRect();
      const fx = (event.clientX - rect.left) / rect.width;
      const fyDown = ((event.clientY - rect.top) / rect.height) * ((grid.rows + STRIP) / grid.rows);
      if (fx < 0 || fx >= 1 || fyDown < 0 || fyDown >= 1) {
        setHover(null);
        onHover?.(null);
        return;
      }
      const tx = Math.floor(fx * grid.cols);
      const ty = Math.floor(fyDown * grid.rows);
      const tile = grid.tiles[ty * grid.cols + tx]!;
      const price = priceAt(win, fx * (win.width - 1));
      const dwellDays = dwellAt(win, (1 - fyDown) * (win.height - 1));
      const s = sample(baskets, price, dwellDays);
      const zone = tile.owner >= 0 ? grid.zones[tile.owner] : undefined;
      const reading: PlateReading = { price, dwellDays, hf: s.z + 1, band: tile.lo, owner: zone?.deploymentId ?? null, exposure: zone?.exposure ?? null, binder: s.binder };
      const hostRect = host.getBoundingClientRect();
      setHover({ reading, tx, ty, px: event.clientX - hostRect.left, py: event.clientY - hostRect.top });
      onHover?.(reading);
    },
    [baskets, grid, win, onHover],
  );

  const leave = useCallback(() => {
    setHover(null);
    onHover?.(null);
  }, [onHover]);

  const tileCss = hover && canvasRef.current ? canvasRef.current.getBoundingClientRect().width / grid.cols : 0;
  const hostW = hostRef.current?.clientWidth ?? 0;
  const readingLeft = hover ? Math.min(Math.max(8, hover.px + 16), Math.max(8, hostW - 250)) : 0;
  const readingTop = hover ? Math.max(8, hover.py - 74) : 0;

  return (
    <div className="pixel-plate" ref={hostRef}>
      <canvas ref={canvasRef} onMouseMove={move} onMouseLeave={leave} />
      {hover && tileCss > 0 && (
        <div className="pixel-cursor" style={{ left: 4 + hover.tx * tileCss, top: 4 + hover.ty * tileCss, width: tileCss, height: tileCss }} />
      )}
      {hover && (
        <div className="pixel-reading" style={{ left: readingLeft, top: readingTop }}>
          <b>{hover.reading.owner ? `${hover.reading.owner.toUpperCase()} · ${hover.reading.exposure}` : isWater(hover.reading.band) ? "THE SEA" : "OPEN GROUND"}</b>
          {fmtUsd(hover.reading.price)} · held {fmtDays(hover.reading.dwellDays)} · health {hover.reading.hf.toFixed(3)}
          <br />
          <span className="dim">{BAND_WORDS[hover.reading.band]}</span>
        </div>
      )}
      <div className="pixel-axis">
        <span>{fmtUsd(priceAt(win, 0))}</span>
        <span>{hover ? `${hover.reading.binder ?? "nothing"} binds here` : "price left to right · dwell bottom to top"}</span>
        <span>{fmtUsd(priceAt(win, win.width - 1))}</span>
      </div>
      <div className="pixel-legend">
        {([Band.DEEP, Band.SHALLOW, Band.COAST, Band.GRASS, Band.FOREST, Band.MOUNTAIN, Band.SNOW] as Band[]).map((b) => (
          <span key={b}>
            <i style={{ background: css(MATERIALS[b].base) }} />
            {BAND_WORDS[b].split(":")[0]}
          </span>
        ))}
        <span>
          <i style={{ background: css(LEY) }} />
          ley-line: the book changes hands
        </span>
        <span>
          <i style={{ background: css(PERIL) }} />
          the pass
        </span>
        <span>
          <i style={{ background: css(HAT) }} />
          today
        </span>
      </div>
    </div>
  );
}

/* ── painting ────────────────────────────────────────────────────────── */

type Win = ReturnType<typeof surveyWindow>;

function paint(ctx: CanvasRenderingContext2D, grid: TerrainGrid, win: Win, t: number, dpr: number, sprite: HTMLImageElement | null, pixelFace: string): void {
  const u = TEXELS * t;
  // Type is set in device pixels so it reads at eight CSS pixels however fine the texels are.
  const type = Math.max(8 * dpr, 2 * t);
  const lineH = type * 1.6;
  const { cols, rows } = grid;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = css(MATERIALS[Band.ABYSS].base);
  ctx.fillRect(0, 0, cols * u, (rows + STRIP) * u);

  const texel = (x: number, y: number, c: RGB) => {
    ctx.fillStyle = css(c);
    ctx.fillRect(x * t, y * t, t, t);
  };
  /** A quarter or a whole tile in a material, with the tileset's grain. */
  const block = (tx: number, ty: number, qx: number, qy: number, qw: number, qh: number, m: Material, water: boolean) => {
    for (let j = qy; j < qy + qh; j++)
      for (let i = qx; i < qx + qw; i++) {
        const gx = tx * TEXELS + i;
        const gy = ty * TEXELS + j;
        let c = m.base;
        if (grainOf(gx, gy) < 0.1) c = mix(m.base, m.shade, 0.5);
        if (hash(gx, gy, 7) > 0.965) c = m.light;
        if (water && hash(tx, ty, 3) > 0.72 && j === Math.floor(hash(tx, ty, 5) * TEXELS) && i >= 1 && i <= 2) c = m.light;
        texel(gx, gy, c);
      }
  };

  // The ground: every tile in its lowest band, the higher corners of a transition tile laid over it.
  for (let ty = 0; ty < rows; ty++)
    for (let tx = 0; tx < cols; tx++) {
      const tile = grid.tiles[ty * cols + tx]!;
      block(tx, ty, 0, 0, TEXELS, TEXELS, MATERIALS[tile.lo], isWater(tile.lo));
      if (tile.mask) {
        const hi = MATERIALS[tile.hi];
        const half = TEXELS / 2;
        if (tile.mask & CORNER.TL) block(tx, ty, 0, 0, half, half, hi, false);
        if (tile.mask & CORNER.TR) block(tx, ty, half, 0, half, half, hi, false);
        if (tile.mask & CORNER.BL) block(tx, ty, 0, half, half, half, hi, false);
        if (tile.mask & CORNER.BR) block(tx, ty, half, half, half, half, hi, false);
      }
    }

  const strokeSegments = (segments: { x1: number; y1: number; x2: number; y2: number }[], width: number, colour: string) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (const s of segments) {
      ctx.moveTo(s.x1 * u, s.y1 * u);
      ctx.lineTo(s.x2 * u, s.y2 * u);
    }
    ctx.stroke();
  };

  // The coast in foam; the borders as ley-lines, dim under bright the way the world draws its veins.
  strokeSegments(grid.shoreline, t, css(FOAM, 0.9));
  strokeSegments(grid.boundaries, 2 * t, css(LEY_DIM));
  strokeSegments(grid.boundaries, t, css(LEY));

  // The pass, where long meets short.
  for (const b of grid.borders) {
    if (b.kind !== "pass") continue;
    const cx = (b.tx + 0.5) * u;
    const cy = (b.ty + 0.5) * u;
    ctx.fillStyle = css(PERIL);
    ctx.beginPath();
    ctx.moveTo(cx, cy - u * 0.6);
    ctx.lineTo(cx + u * 0.6, cy);
    ctx.lineTo(cx, cy + u * 0.6);
    ctx.lineTo(cx - u * 0.6, cy);
    ctx.closePath();
    ctx.fill();
  }

  // Each holdfast: a keep on its footprint, a flag in its zone's colour, a banner with its name.
  const stone = MATERIALS[Band.MOUNTAIN];
  ctx.font = `${type}px ${pixelFace}`;
  ctx.textBaseline = "middle";
  for (const c of grid.citadels) {
    const w = Math.max(2, c.footprint.w);
    const h = Math.max(2, c.footprint.h);
    const x0 = (c.tx - Math.floor(w / 2)) * u;
    const y0 = (c.ty - h + 1) * u;
    const W = w * u;
    const H = h * u;
    ctx.fillStyle = css(INK);
    ctx.fillRect(x0 - t, y0 - t, W + 2 * t, H + 2 * t);
    ctx.fillStyle = css(stone.light);
    ctx.fillRect(x0, y0, W, H);
    ctx.fillStyle = css(stone.shade);
    for (let y = y0 + t; y < y0 + H; y += 2 * t) for (let x = x0 + ((y / t) & 1 ? t : 0); x < x0 + W; x += 2 * t) ctx.fillRect(x, y, t, t);
    // crenellations, a door, a window
    ctx.fillStyle = css(INK);
    for (let x = x0; x < x0 + W; x += 2 * t) ctx.fillRect(x, y0, t, t);
    ctx.fillRect(x0 + W / 2 - t, y0 + H - 3 * t, 2 * t, 3 * t);
    ctx.fillStyle = css(LEY);
    ctx.fillRect(x0 + W / 2 - t, y0 + 2 * t, 2 * t, t);
    // the flag
    const colour = ZONE_COLOURS[c.zone % ZONE_COLOURS.length]!;
    ctx.fillStyle = css(INK);
    ctx.fillRect(x0 + W / 2, y0 - 4 * t, t, 4 * t);
    ctx.fillStyle = hexCss(colour);
    ctx.fillRect(x0 + W / 2 + t, y0 - 4 * t, 3 * t, 2 * t);
    // the banner
    const name = c.deploymentId;
    const tw = ctx.measureText(name).width;
    const bw = tw + 6 * t;
    const bh = lineH;
    const bx = Math.min(Math.max(t, x0 + W / 2 - bw / 2), cols * u - bw - t);
    const by = Math.max(t, y0 - 5 * t - bh);
    ctx.fillStyle = css(VELLUM_EDGE);
    ctx.fillRect(bx - t, by - t, bw + 2 * t, bh + 2 * t);
    ctx.fillStyle = css(VELLUM);
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = css(VELLUM_INK);
    ctx.textAlign = "left";
    ctx.fillText(name, bx + 3 * t, by + bh / 2 + type * 0.1);
  }

  // Today's price: a dashed line the height of the map, and the surveyor at its foot.
  const todayX = Math.round(grid.today.fx * cols * u);
  ctx.fillStyle = css(HAT, 0.85);
  for (let y = 0; y < rows * u; y += 3 * t) ctx.fillRect(todayX - t / 2, y, t, 2 * t);
  if (sprite) {
    const sw = 8 * t;
    const sh = 10 * t;
    ctx.drawImage(sprite, 0, 0, 32, 40, todayX - sw / 2, rows * u - sh, sw, sh);
  }

  // The scale strip: sand along the foot, price ticks with their labels.
  const strip = MATERIALS[Band.COAST];
  for (let ty = rows; ty < rows + STRIP; ty++) for (let tx = 0; tx < cols; tx++) block(tx, ty, 0, 0, TEXELS, TEXELS, strip, false);
  ctx.fillStyle = css(INK);
  ctx.fillRect(0, rows * u, cols * u, t);
  ctx.font = `${type}px ${pixelFace}`;
  ctx.textAlign = "center";
  const low = priceAt(win, 0);
  const high = priceAt(win, win.width - 1);
  for (const p of priceTicks(low, high, 8)) {
    const x = Math.round((colOfPrice(win, p) / (win.width - 1)) * cols * u);
    ctx.fillStyle = css(INK);
    ctx.fillRect(x - t / 2, rows * u, t, 2 * t);
    ctx.fillStyle = css(VELLUM_INK);
    ctx.fillText(fmtUsd(p), x, rows * u + 2 * t + type * 0.9);
  }
  // Dwell up the left edge, each label on a knockout so it is read off the ground, not through it.
  ctx.textAlign = "left";
  for (const d of dwellTicks(win.dwellHigh)) {
    if (d === 0) continue;
    // The window spaces dwell by its square root, so a day's row is found the way dwellAt is inverted.
    const lo = Math.sqrt(win.dwellLow);
    const hi = Math.sqrt(win.dwellHigh);
    const fy = (Math.sqrt(d) - lo) / (hi - lo);
    const y = Math.round((1 - fy) * rows * u);
    if (y < 3 * t) continue;
    const text = `${d}d`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = css(INK);
    ctx.fillRect(0, y - t / 2, 3 * t, t);
    ctx.fillStyle = css(VELLUM, 0.92);
    ctx.fillRect(3 * t, y - lineH / 2, tw + 2 * t, lineH);
    ctx.fillStyle = css(VELLUM_INK);
    ctx.fillText(text, 4 * t, y + type * 0.1);
  }
}

function fmtUsd(x: number): string {
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtDays(d: number): string {
  if (d < 1) return `${Math.round(d * 24)}h`;
  return `${d.toFixed(1)}d`;
}
