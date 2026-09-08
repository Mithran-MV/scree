"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Basket } from "@/core/types";
import { bracket } from "@/core/bracket";
import { rasterize, fittedWindow, colOfPrice, priceAt, dwellAt, sample } from "@/field/raster";
import { extractFeatures } from "@/field/features";
import { paintWorld, worldSizeFor, type WorldSize } from "@/world/pixels";
import { SCATTER_ART, scatterWorld } from "@/world/scatter";
import { findLandmarks } from "@/world/landmarks";
import {
  BANNER_COLOURS,
  drawBanner,
  drawFields,
  drawJetty,
  drawMenhirs,
  drawStreams,
  drawTrack,
  drawWreckage,
} from "@/world/detail";
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

export interface WorldMark {
  id: string;
  share: number;
  leftPct: number;
  topPct: number;
}

interface Props {
  baskets: Basket[];
  spot: number;
  onHover?: (r: WorldReadout | null) => void;
  onFeatures?: (f: ReturnType<typeof extractFeatures>) => void;
  children?: React.ReactNode;
}

/** Pixels per world cell. Bigger reads as chunkier art and costs less to draw. */
const SCALE = 4;

export function WorldView({ baskets, spot, onHover, onFeatures, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<WorldSize>(() => worldSizeFor(1.6));

  // The grid follows the container's shape so a pixel stays square and the same
  // size on screen however the window is resized.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const next = worldSizeFor(rect.width / rect.height);
      setSize((held) => (held.width === next.width && held.height === next.height ? held : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const win = useMemo(() => {
    const br = bracket(baskets, 0);
    return fittedWindow(spot, br.lower, br.upper);
  }, [baskets, spot]);
  const raster = useMemo(() => rasterize(baskets, win), [baskets, win]);
  const features = useMemo(() => extractFeatures(raster), [raster]);
  const paint = useMemo(() => paintWorld(raster, size), [raster, size]);
  const landmarks = useMemo(() => findLandmarks(raster), [raster]);

  const toWorld = useCallback(
    (col: number, row: number) => ({
      x: Math.round((col / (win.width - 1)) * (paint.width - 1)),
      y: Math.round((1 - row / (win.height - 1)) * (paint.height - 1)),
    }),
    [win, paint.width, paint.height],
  );

  useEffect(() => {
    onFeatures?.(features);
  }, [features, onFeatures]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width: W, height: H } = paint;
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;

    /* ── bake everything that never moves ─────────────────────────── */
    const stage = document.createElement("canvas");
    stage.width = W;
    stage.height = H;
    const sctx = stage.getContext("2d")!;
    sctx.putImageData(new ImageData(paint.image.data, W, H), 0, 0);

    const holds = landmarks.map((mark, i) => {
      const art = HOLDFASTS[i % HOLDFASTS.length]!;
      const { w, h } = spriteSize(art);
      const p = toWorld(mark.col, mark.row);
      return {
        art,
        banner: BANNER_COLOURS[i % BANNER_COLOURS.length]!,
        x: Math.min(W - w - 1, Math.max(1, p.x - Math.floor(w / 2))),
        y: Math.min(H - h - 1, Math.max(1, p.y - h)),
        w,
        h,
        anchor: p,
      };
    });

    // Order matters: ground first, then things standing on it, near last.
    drawStreams(sctx, paint);
    drawWreckage(sctx, paint);
    drawTrack(
      sctx,
      paint,
      holds.map((hold) => ({ x: hold.anchor.x, y: hold.anchor.y })),
    );
    for (const hold of holds) {
      drawJetty(sctx, paint, hold.anchor.x, hold.y + hold.h);
      drawFields(sctx, paint, hold.x, hold.y + hold.h - 4);
    }

    for (const item of scatterWorld(paint, holds)) {
      const art = SCATTER_ART[item.kind]!;
      sctx.fillStyle = "rgba(24,20,14,0.16)";
      sctx.fillRect(item.x, item.y + art.length - 1, art[0]!.length, 1);
      blit(sctx, art, SCATTER_PALETTE, item.x, item.y);
    }

    if (features.pass && features.boundaryPass) {
      const p = toWorld(features.pass.column, features.pass.row);
      drawMenhirs(sctx, p.x, Math.min(H - 6, Math.max(6, p.y)));
    }

    for (const hold of holds) {
      sctx.fillStyle = "rgba(24,20,14,0.26)";
      sctx.fillRect(hold.x + 1, hold.y + hold.h - 1, hold.w - 2, 2);
      blit(sctx, hold.art, HOLDFAST_PALETTE, hold.x, hold.y);
      drawBanner(sctx, hold.x + hold.w - 3, hold.y + 1, hold.banner);
    }

    const baked = sctx.getImageData(0, 0, W, H);

    /* ── where you stand ──────────────────────────────────────────── */
    const live = toWorld(Math.round(colOfPrice(win, spot)), 0);
    const figureX = Math.min(W - 9, Math.max(2, live.x - 3));
    const figureY = Math.min(H - 12, Math.max(14, live.y - 10));

    let raf = 0;
    let start = 0;

    const frame = (now: number) => {
      if (!start) start = now;
      const t = (now - start) / 1000;

      const buffer = new ImageData(new Uint8ClampedArray(baked.data), W, H);
      const d = buffer.data;
      // Cloud shadows drift west to east across the whole scene. Two slow
      // waves at different rates so the pattern never visibly repeats.
      const drift = t * 7;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const o = i * 4;

          if (paint.wet[i]) {
            const s =
              Math.sin(x * 0.31 + t * 1.1) +
              Math.sin(y * 0.44 - t * 0.8) +
              Math.sin((x + y) * 0.19 + t * 1.6);
            if (s > 2.35) {
              d[o] = Math.min(255, d[o]! + 46);
              d[o + 1] = Math.min(255, d[o + 1]! + 52);
              d[o + 2] = Math.min(255, d[o + 2]! + 46);
            }
            continue;
          }

          const cloud =
            Math.sin((x - drift) * 0.035 + y * 0.017) +
            Math.sin((x - drift * 0.62) * 0.021 - y * 0.03);
          if (cloud > 1.42) {
            const shade = 0.86;
            d[o] = d[o]! * shade;
            d[o + 1] = d[o + 1]! * shade;
            d[o + 2] = d[o + 2]! * shade;
          }
        }
      }
      sctx.putImageData(buffer, 0, 0);

      drawStaff(sctx, figureX + 7, figureY + 10, 14);
      blit(sctx, SURVEYOR[Math.floor(t / 1.4) % 2]!, FIGURE_PALETTE, figureX, figureY);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(stage, 0, 0, W * SCALE, H * SCALE);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paint, landmarks, features, win, spot, toWorld]);

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

  // The hud owns the top strip and the right column; a name that would land
  // under it is pushed clear rather than drawn through it.
  const place = (x: number, y: number, nudge: number) => {
    let fx = x / paint.width;
    let fy = y / paint.height;
    if (fy < 0.34 && fx > 0.52) fy = 0.34 + nudge;
    return { left: `${fx * 100}%`, top: `${Math.min(0.88, Math.max(0.22, fy)) * 100}%` };
  };

  const passSpot =
    features.pass && features.boundaryPass
      ? toWorld(features.pass.column, features.pass.row)
      : null;

  return (
    <div className="world" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="world-canvas"
        onMouseMove={move}
        onMouseLeave={() => onHover?.(null)}
      />
      {landmarks.map((mark, i) => {
        const p = toWorld(mark.col, mark.row);
        return (
          <span key={mark.deploymentId} className="holdfast-name" style={place(p.x, p.y, 0.07 * (i + 1))}>
            {mark.deploymentId}
            <em>{(mark.share * 100).toFixed(0)}% of the ground</em>
          </span>
        );
      })}
      {passSpot && features.pass ? (
        <span className="pass-name" style={place(passSpot.x, passSpot.y, 0.3)}>
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
