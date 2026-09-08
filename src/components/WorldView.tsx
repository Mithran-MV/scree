"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Basket } from "@/core/types";
import { rasterize, fittedWindow, colOfPrice, priceAt, dwellAt, sample } from "@/field/raster";
import { bracket } from "@/core/bracket";
import { extractFeatures } from "@/field/features";
import { WORLD_H, WORLD_W, paintWorld } from "@/world/pixels";
import { SCATTER_ART, scatterWorld } from "@/world/scatter";
import { findLandmarks } from "@/world/landmarks";
import {
  FIGURE_PALETTE,
  HOLDFASTS,
  HOLDFAST_PALETTE,
  SCATTER_PALETTE,
  SURVEYOR,
  blit,
  drawStaff,
  spriteSize,
} from "@/world/sprites";

export interface WorldReadout {
  price: number;
  dwellDays: number;
  z: number;
  binder: string | null;
}

interface Props {
  baskets: Basket[];
  spot: number;
  scale?: number;
  onHover?: (r: WorldReadout | null) => void;
  onFeatures?: (f: ReturnType<typeof extractFeatures>) => void;
  /** HUD chrome, rendered over the world inside its own stacking context. */
  children?: React.ReactNode;
}

/** Field cell to world pixel. */
function toWorld(col: number, row: number, fw: number, fh: number): { x: number; y: number } {
  return {
    x: Math.round((col / (fw - 1)) * (WORLD_W - 1)),
    y: Math.round((1 - row / (fh - 1)) * (WORLD_H - 1)),
  };
}

export function WorldView({ baskets, spot, scale = 4, onHover, onFeatures, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Framed to the book rather than to a fixed range, so a tight wallet reads as
  // country instead of as open sea. The chosen range is printed on the axis.
  const win = useMemo(() => {
    const br = bracket(baskets, 0);
    return fittedWindow(spot, br.lower, br.upper);
  }, [baskets, spot]);
  const raster = useMemo(() => rasterize(baskets, win), [baskets, win]);
  const features = useMemo(() => extractFeatures(raster), [raster]);
  const paint = useMemo(() => paintWorld(raster), [raster]);
  const landmarks = useMemo(() => findLandmarks(raster), [raster]);

  useEffect(() => {
    onFeatures?.(features);
  }, [features, onFeatures]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = WORLD_W * scale;
    canvas.height = WORLD_H * scale;

    /* ── bake everything that never moves ─────────────────────────── */
    const stage = document.createElement("canvas");
    stage.width = WORLD_W;
    stage.height = WORLD_H;
    const sctx = stage.getContext("2d")!;
    sctx.putImageData(
      new ImageData(paint.image.data, paint.image.width, paint.image.height),
      0,
      0,
    );

    const holds = landmarks.map((mark, i) => {
      const art = HOLDFASTS[i % HOLDFASTS.length]!;
      const { w, h } = spriteSize(art);
      const p = toWorld(mark.col, mark.row, win.width, win.height);
      return {
        mark,
        art,
        x: Math.min(WORLD_W - w - 1, Math.max(1, p.x - Math.floor(w / 2))),
        y: Math.min(WORLD_H - h - 1, Math.max(1, p.y - h)),
        w,
        h,
      };
    });

    for (const item of scatterWorld(paint, holds)) {
      blit(sctx, SCATTER_ART[item.kind]!, SCATTER_PALETTE, item.x, item.y);
    }
    for (const hold of holds) {
      // A short shadow anchors the building to the ground it stands on.
      sctx.fillStyle = "rgba(30,26,20,0.24)";
      sctx.fillRect(hold.x + 1, hold.y + hold.h - 1, hold.w - 2, 2);
      blit(sctx, hold.art, HOLDFAST_PALETTE, hold.x, hold.y);
    }

    const baked = sctx.getImageData(0, 0, WORLD_W, WORLD_H);

    /* ── where you stand ──────────────────────────────────────────── */
    const liveCol = colOfPrice(win, spot);
    const live = toWorld(Math.round(liveCol), 0, win.width, win.height);
    const figureX = Math.min(WORLD_W - 8, Math.max(2, live.x - 3));
    const figureY = Math.min(WORLD_H - 12, Math.max(12, live.y - 10));

    let raf = 0;
    let start = 0;

    const frame = (now: number) => {
      if (!start) start = now;
      const t = (now - start) / 1000;

      const buffer = new ImageData(
        new Uint8ClampedArray(baked.data),
        baked.width,
        baked.height,
      );

      // Water glints. Two crossing swells, so the surface never visibly repeats.
      const d = buffer.data;
      for (let y = 0; y < WORLD_H; y++) {
        for (let x = 0; x < WORLD_W; x++) {
          const i = y * WORLD_W + x;
          if (!paint.wet[i]) continue;
          const s =
            Math.sin(x * 0.31 + t * 1.1) + Math.sin(y * 0.44 - t * 0.8) + Math.sin((x + y) * 0.19 + t * 1.6);
          if (s > 2.35) {
            const o = i * 4;
            d[o] = Math.min(255, d[o]! + 46);
            d[o + 1] = Math.min(255, d[o + 1]! + 52);
            d[o + 2] = Math.min(255, d[o + 2]! + 46);
          }
        }
      }
      sctx.putImageData(buffer, 0, 0);

      // The staff, then the figure over it, so the hand reads as holding it.
      drawStaff(sctx, figureX + 7, figureY + 10, 14);
      const breathing = Math.floor(t / 1.4) % 2;
      blit(sctx, SURVEYOR[breathing]!, FIGURE_PALETTE, figureX, figureY);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(stage, 0, 0, WORLD_W * scale, WORLD_H * scale);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paint, landmarks, raster, win, spot, scale]);

  function move(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = 1 - (event.clientY - rect.top) / rect.height;
    const price = priceAt(win, fx * (win.width - 1));
    const dwellDays = dwellAt(win, fy * (win.height - 1));
    const s = sample(baskets, price, dwellDays);
    onHover?.({ price, dwellDays, z: s.z, binder: s.binder });
  }

  // The hud owns the top strip and the right column. A label that would land
  // under it is pushed down rather than drawn through it.
  const HUD_TOP = 0.34;
  const HUD_RIGHT = 0.62;

  const holdLabels = landmarks.map((mark, i) => {
    const p = toWorld(mark.col, mark.row, win.width, win.height);
    let fx = p.x / WORLD_W;
    let fy = p.y / WORLD_H;
    if (fy < HUD_TOP && fx > HUD_RIGHT) fy = HUD_TOP + 0.06 * (i + 1);
    return {
      id: mark.deploymentId,
      share: mark.share,
      left: `${fx * 100}%`,
      top: `${Math.min(0.94, Math.max(0.16, fy)) * 100}%`,
      order: i,
    };
  });

  const passSpot = features.pass
    ? toWorld(features.pass.column, features.pass.row, win.width, win.height)
    : null;
  const passTop =
    passSpot && passSpot.y / WORLD_H < HUD_TOP && passSpot.x / WORLD_W > HUD_RIGHT
      ? HUD_TOP + 0.24
      : passSpot
        ? passSpot.y / WORLD_H
        : 0;

  return (
    <div className="world">
      <canvas
        ref={canvasRef}
        className="world-canvas"
        onMouseMove={move}
        onMouseLeave={() => onHover?.(null)}
      />
      {holdLabels.map((label) => (
        <span key={label.id} className="holdfast-name" style={{ left: label.left, top: label.top }}>
          {label.id}
          <em>{(label.share * 100).toFixed(0)}% of the ground</em>
        </span>
      ))}
      {features.pass && features.boundaryPass && passSpot ? (
        <span
          className="pass-name"
          style={{
            left: `${(passSpot.x / WORLD_W) * 100}%`,
            top: `${Math.min(0.9, Math.max(0.16, passTop)) * 100}%`,
          }}
        >
          THE PASS
          <em>
            ${Math.round(features.pass.price).toLocaleString("en-US")} · held{" "}
            {features.pass.dwellDays.toFixed(0)}d
          </em>
        </span>
      ) : null}
      {children}
    </div>
  );
}
