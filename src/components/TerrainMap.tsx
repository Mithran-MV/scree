"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Basket } from "@/core/types";
import { rasterize, windowAt, priceAt, dwellAt, colOfPrice } from "@/field/raster";
import { extractFeatures } from "@/field/features";
import { hillshade } from "@/render/hillshade";
import { contourSet } from "@/render/contours";
import { foldPaths, ridgePath } from "@/render/overlays";
import { sample } from "@/field/raster";

export interface Readout {
  price: number;
  dwellDays: number;
  z: number;
  binder: string | null;
}

interface Props {
  baskets: Basket[];
  spot: number;
  onFeatures?: (f: ReturnType<typeof extractFeatures>) => void;
  onHover?: (r: Readout | null) => void;
}

const SIZE = 512;

export function TerrainMap({ baskets, spot, onFeatures, onHover }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Readout | null>(null);

  const win = useMemo(() => windowAt(spot, { width: 320, height: 320 }), [spot]);
  const raster = useMemo(() => rasterize(baskets, win), [baskets, win]);
  const features = useMemo(() => extractFeatures(raster), [raster]);

  useEffect(() => {
    onFeatures?.(features);
  }, [features, onFeatures]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const shaded = hillshade(raster);
    const image = new ImageData(shaded.data, shaded.width, shaded.height);

    // The raster is computed at a modest resolution and scaled up for display.
    // Recomputing at display resolution buys nothing: the terrain is smooth
    // between samples and the counters are measured on the raster, not on the
    // picture, so scaling cannot change a reported number.
    const staging = document.createElement("canvas");
    staging.width = shaded.width;
    staging.height = shaded.height;
    staging.getContext("2d")!.putImageData(image, 0, 0);

    canvas.width = SIZE;
    canvas.height = SIZE;
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    // Raster row 0 is dwell zero, which belongs at the bottom of the map.
    ctx.translate(0, SIZE);
    ctx.scale(1, -1);
    ctx.drawImage(staging, 0, 0, SIZE, SIZE);
    ctx.restore();

    const sx = SIZE / (win.width - 1);
    const sy = SIZE / (win.height - 1);
    const toScreen = (x: number, y: number): [number, number] => [x * sx, SIZE - y * sy];

    for (const line of contourSet(raster)) {
      const shoreline = line.level === 0;
      ctx.strokeStyle = shoreline ? "rgba(20,32,48,0.85)" : "rgba(40,50,40,0.22)";
      ctx.lineWidth = shoreline ? 1.6 : 0.7;
      ctx.beginPath();
      for (const s of line.segments) {
        const [x1, y1] = toScreen(s.x1, s.y1);
        const [x2, y2] = toScreen(s.x2, s.y2);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }

    // Fold lines: where the deployment closest to killing you hands over. These
    // are drawn from the argmin partition, so a map with no handover has no
    // lines to draw and cannot pretend otherwise.
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(30,40,60,0.55)";
    ctx.lineWidth = 1;
    for (const fold of foldPaths(raster)) {
      ctx.beginPath();
      fold.points.forEach((p, i) => {
        const [x, y] = toScreen(p.col, p.row);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // The ridge, traced row by row rather than assumed vertical.
    if (features.boundaryPass) {
      const ridge = ridgePath(raster);
      ctx.strokeStyle = "rgba(182,82,42,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ridge.forEach((p, i) => {
        const [x, y] = toScreen(p.col, p.row);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Where you are now: today's price, no dwell.
    const [bx, by] = toScreen(colOfPrice(win, spot), 0);
    ctx.beginPath();
    ctx.arc(bx, Math.min(by, SIZE - 7), 5.5, 0, Math.PI * 2);
    ctx.fillStyle = "#1d7a3e";
    ctx.strokeStyle = "#fffdf8";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // The pass, only when it is a genuine one with drowned ground on both sides.
    if (features.pass && features.boundaryPass) {
      const [px, py] = toScreen(features.pass.column, features.pass.row);
      ctx.beginPath();
      ctx.moveTo(px - 7, py);
      ctx.lineTo(px, py - 7);
      ctx.lineTo(px + 7, py);
      ctx.lineTo(px, py + 7);
      ctx.closePath();
      ctx.strokeStyle = "#b6522a";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [raster, features, win, spot]);

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

function fmtUsd(x: number): string {
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtDays(d: number): string {
  if (d < 1) return `${Math.round(d * 24)}h`;
  return `${d.toFixed(1)}d`;
}
