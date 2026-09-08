"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Basket } from "@/core/types";
import { rasterize, renderWindow, priceAt, dwellAt, colOfPrice, sample } from "@/field/raster";
import { extractFeatures } from "@/field/features";
import { contourSet, niceInterval } from "@/render/contours";
import { foldPaths, ridgePath } from "@/render/overlays";
import { wash } from "@/render/wash";
import { drawHachures, hachureSeeds } from "@/render/hachure";
import { dotSegments } from "@/render/dots";
import { drawSurveyor } from "@/render/surveyor";
import { exaggerationFor, gradientAt } from "@/render/hillshade";
import { ALPHA_BUDGET, REGISTERS, SHEET, TYPE } from "@/render/theme";

export interface Readout {
  price: number;
  dwellDays: number;
  z: number;
  binder: string | null;
}

export interface PlateFacts {
  exaggeration: number;
  interval: number;
  ceiling: number;
  combGain: number;
  cullDeg: number;
  strokes: number;
}

interface Props {
  baskets: Basket[];
  spot: number;
  onFeatures?: (f: ReturnType<typeof extractFeatures>) => void;
  onHover?: (r: Readout | null) => void;
  onPlate?: (f: PlateFacts) => void;
}

const SIZE = 512;

function css(c: { r: number; g: number; b: number }, alpha = 1): string {
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

export function TerrainMap({ baskets, spot, onFeatures, onHover, onPlate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Readout | null>(null);

  const win = useMemo(() => renderWindow(spot), [spot]);
  const raster = useMemo(() => rasterize(baskets, win), [baskets, win]);
  const features = useMemo(() => extractFeatures(raster), [raster]);
  // One ceiling, computed once and handed to everything that needs it. The
  // shading and the contours each used to default it independently, so they
  // agreed only by coincidence and would have drifted apart silently.
  const ceiling = useMemo(() => Math.max(0.05, raster.range.max), [raster]);
  const interval = useMemo(() => niceInterval(ceiling, 14), [ceiling]);

  useEffect(() => {
    onFeatures?.(features);
  }, [features, onFeatures]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sx = SIZE / (win.width - 1);
    const sy = SIZE / (win.height - 1);
    const toScreen = (x: number, y: number): [number, number] => [x * sx, SIZE - y * sy];

    /* ── the wash and the sea ruling ─────────────────────────────── */
    const painted = wash(raster, { size: SIZE, dpr, ceiling });
    const staging = document.createElement("canvas");
    staging.width = painted.width;
    staging.height = painted.height;
    staging.getContext("2d")!.putImageData(
      new ImageData(painted.data, painted.width, painted.height),
      0,
      0,
    );
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staging, 0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = true;

    /* ── the comb ────────────────────────────────────────────────── */
    const comb = hachureSeeds(raster, { size: SIZE, interval });
    drawHachures(ctx, comb.seeds, css(SHEET.ink));

    /* ── contours, in four registers ─────────────────────────────── */
    for (const line of contourSet(raster, interval, ceiling)) {
      const isShore = line.level === 0;
      const isIndex = !isShore && Math.abs(Math.round(line.level / interval)) % 5 === 0;
      // Underwater is one fact, already dead, and it carries its own level
      // ruling. Cutting every bathymetric interval there buries the ruling in
      // lines that no reader would ever act on, so only the index survives.
      if (line.level < 0 && !isIndex) continue;
      const reg = isShore
        ? REGISTERS.shore
        : line.level < 0
          ? REGISTERS.bathymetric
          : isIndex
            ? REGISTERS.index
            : REGISTERS.intermediate;

      const stroke = (width: number, alpha: number) => {
        ctx.strokeStyle = css(reg.color, alpha);
        ctx.lineWidth = width;
        ctx.beginPath();
        for (const s of line.segments) {
          const [x1, y1] = toScreen(s.x1, s.y1);
          const [x2, y2] = toScreen(s.x2, s.y2);
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      };

      // A heavy line bleeds into paper. Cosmetic only; it carries no weight.
      if (reg.bleed) stroke(reg.bleed.width, reg.bleed.alpha);
      stroke(reg.width, reg.alpha);
    }

    /* ── fold lines ──────────────────────────────────────────────── */
    // Where the deployment closest to killing you hands over. Drawn from the
    // argmin partition, so a map with no handover has no lines to draw and
    // cannot pretend otherwise.
    ctx.fillStyle = css(SHEET.ink, ALPHA_BUDGET.fold);
    for (const fold of foldPaths(raster)) {
      const segments = [];
      for (let i = 1; i < fold.points.length; i++) {
        const a = fold.points[i - 1]!;
        const b = fold.points[i]!;
        segments.push({ x1: a.col, y1: a.row, x2: b.col, y2: b.row });
      }
      dotSegments(ctx, segments, toScreen, { step: 3.6, size: 1.3 });
    }

    /* ── the ridge, demoted to a dotted rule ─────────────────────── */
    if (features.boundaryPass) {
      const ridge = ridgePath(raster);
      const segments = [];
      for (let i = 1; i < ridge.length; i++) {
        const a = ridge[i - 1]!;
        const b = ridge[i]!;
        segments.push({ x1: a.col, y1: a.row, x2: b.col, y2: b.row });
      }
      ctx.fillStyle = css(SHEET.ink, 0.5);
      dotSegments(ctx, segments, toScreen, { step: 5, size: 1.1 });
    }

    /* ── the pass, and it never appears without its numbers ──────── */
    if (features.pass && features.boundaryPass) {
      const p = features.pass;
      const [px, py] = toScreen(p.column, p.row);
      ctx.strokeStyle = css(SHEET.accent, 0.95);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px - 6, py);
      ctx.lineTo(px, py - 6);
      ctx.lineTo(px + 6, py);
      ctx.lineTo(px, py + 6);
      ctx.closePath();
      ctx.stroke();

      // The glyph never appears without its numbers. A bare mark asserts a
      // feature; a mark carrying its own reading can be checked.
      const spec = TYPE.passReadout!;
      const label = `THE PASS  z ${p.elevation >= 0 ? "+" : ""}${p.elevation.toFixed(4)}`;
      const sub = `$${Math.round(p.price).toLocaleString("en-US")} · held ${fmtDays(p.dwellDays)}`;
      ctx.font = `${spec.size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      const cx = clampX(px, SIZE);
      const wide = Math.max(ctx.measureText(label).width, ctx.measureText(sub).width);
      const top = py < SIZE / 2 ? py + 14 : py - 14 - spec.size * 2 - 8;
      // A knockout under the type, so a measurement is never read through ink.
      ctx.fillStyle = css(SHEET.knockout, 0.88);
      ctx.fillRect(cx - wide / 2 - 5, top - 2, wide + 10, spec.size * 2 + 10);
      ctx.fillStyle = css(spec.color, 1);
      ctx.fillText(label, cx, top + spec.size);
      ctx.fillText(sub, cx, top + spec.size * 2 + 3);
      ctx.textAlign = "start";
    }

    /* ── where you are ───────────────────────────────────────────── */
    const liveCol = colOfPrice(win, spot);
    const [bx, by] = toScreen(liveCol, 0);
    const exaggeration = exaggerationFor(raster);
    const g = gradientAt(raster, Math.round(liveCol), 0, exaggeration);
    const perPixel = Math.hypot(g.dzdx / sx, g.dzdy / sy);
    const staffPx = Math.min(34, Math.max(10, interval / Math.max(perPixel, 1e-6)));
    drawSurveyor(ctx, { x: bx, y: Math.min(by, SIZE - 2), staffPx, intervals: 1 });

    onPlate?.({
      exaggeration,
      interval,
      ceiling,
      combGain: comb.gain,
      cullDeg: comb.cullDeg,
      strokes: comb.seeds.length,
    });
  }, [raster, features, win, spot, ceiling, interval, onPlate]);

  function move(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = 1 - (event.clientY - rect.top) / rect.height;
    const price = priceAt(win, fx * (win.width - 1));
    const dwellDays = dwellAt(win, fy * (win.height - 1));
    const s = sample(baskets, price, dwellDays);
    const next: Readout = { price, dwellDays, z: s.z, binder: s.binder };
    setHover(next);
    onHover?.(next);
  }

  function leave() {
    setHover(null);
    onHover?.(null);
  }

  return (
    <div className="plate">
      <canvas ref={canvasRef} onMouseMove={move} onMouseLeave={leave} />
      <div className="axis">
        <span>{fmtUsd(priceAt(win, 0))}</span>
        <span>
          {hover
            ? `${fmtUsd(hover.price)} · held ${fmtDays(hover.dwellDays)} · HF ${(hover.z + 1).toFixed(3)}${hover.binder ? ` · ${hover.binder}` : ""}`
            : "price left to right · dwell bottom to top"}
        </span>
        <span>{fmtUsd(priceAt(win, win.width - 1))}</span>
      </div>
    </div>
  );
}

function clampX(x: number, size: number): number {
  return Math.min(size - 62, Math.max(62, x));
}

function fmtUsd(x: number): string {
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtDays(d: number): string {
  if (d < 1) return `${Math.round(d * 24)}h`;
  return `${d.toFixed(1)}d`;
}
