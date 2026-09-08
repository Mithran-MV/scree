"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Basket } from "@/core/types";
import { bracket } from "@/core/bracket";
import { rasterize, fittedWindow, colOfPrice, priceAt, dwellAt, sample } from "@/field/raster";
import { extractFeatures } from "@/field/features";
import { findLandmarks } from "@/world/landmarks";
import {
  blit,
  chartSizeFor,
  citadelFor,
  drawBeacon,
  drawContourRings,
  drawFurniture,
  drawLeyNetwork,
  drawShoreline,
  leyNetwork,
  paintGround,
  placeFurniture,
  sampleField,
  WARD_CIRCLE,
  type Placed,
} from "@/arcane/pixelchart";

export interface ChartReadout {
  price: number;
  dwellDays: number;
  z: number;
  binder: string | null;
}

interface Props {
  baskets: Basket[];
  spot: number;
  onHover?: (r: ChartReadout | null) => void;
  onFeatures?: (f: ReturnType<typeof extractFeatures>) => void;
  children?: React.ReactNode;
}

/** Whole-number upscale. Anything else would soften the pixels. */
const SCALE = 4;

export function ArcaneMap({ baskets, spot, onHover, onFeatures, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(2.2);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const next = rect.width / rect.height;
      setAspect((held) => (Math.abs(held - next) < 0.02 ? held : next));
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
  const landmarks = useMemo(() => findLandmarks(raster), [raster]);
  const size = useMemo(() => chartSizeFor(aspect), [aspect]);
  const field = useMemo(() => sampleField(raster, size), [raster, size]);

  const toChart = useMemo(
    () =>
      (col: number, row: number) => ({
        x: Math.round((col / (win.width - 1)) * (size.width - 1)),
        y: Math.round((1 - row / (win.height - 1)) * (size.height - 1)),
      }),
    [win.width, win.height, size.width, size.height],
  );

  useEffect(() => {
    onFeatures?.(features);
  }, [features, onFeatures]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width: W, height: H } = size;
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;

    const stage = document.createElement("canvas");
    stage.width = W;
    stage.height = H;
    const sctx = stage.getContext("2d")!;

    /* ── bake the country ─────────────────────────────────────────── */
    paintGround(sctx, field);
    drawContourRings(sctx, field);
    drawShoreline(sctx, field);

    const seats: Placed[] = landmarks.map((mark) => {
      const sprite = citadelFor(mark.share);
      const at = toChart(mark.col, mark.row);
      const w = sprite.art[0]?.length ?? 0;
      const h = sprite.art.length;
      return {
        sprite,
        x: Math.min(W - w - 1, Math.max(1, at.x - (w >> 1))),
        y: Math.min(H - h - 1, Math.max(1, at.y - h)),
      };
    });

    const passAt =
      features.pass && features.boundaryPass
        ? toChart(features.pass.column, features.pass.row)
        : null;
    const wardAt = passAt
      ? {
          x: Math.min(W - 10, Math.max(1, passAt.x - 4)),
          y: Math.min(H - 8, Math.max(1, passAt.y - 3)),
        }
      : null;

    const keepOut = [...seats];
    if (wardAt) keepOut.push({ sprite: WARD_CIRCLE, x: wardAt.x, y: wardAt.y });

    drawFurniture(sctx, placeFurniture(field, keepOut));
    drawFurniture(sctx, seats);
    if (wardAt) blit(sctx, WARD_CIRCLE, wardAt.x, wardAt.y);

    const baked = sctx.getImageData(0, 0, W, H);

    /* ── the live layers ──────────────────────────────────────────── */
    const nodes = seats.map((seat) => ({
      x: seat.x + ((seat.sprite.art[0]?.length ?? 0) >> 1),
      y: seat.y + seat.sprite.art.length - 2,
    }));
    const lines = leyNetwork(field, nodes, passAt);
    const live = toChart(Math.round(colOfPrice(win, spot)), 0);

    let raf = 0;
    let start = 0;

    const frame = (now: number) => {
      if (!start) start = now;
      const t = (now - start) / 1000;
      // One slow breath drives every glow, so nothing beats against anything else.
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.05);

      sctx.putImageData(baked, 0, 0);
      drawLeyNetwork(sctx, lines, pulse);
      for (const seat of seats) {
        drawBeacon(sctx, seat.x + ((seat.sprite.art[0]?.length ?? 0) >> 1), seat.y, pulse);
      }

      // Where you stand: the one cold light on a chart lit entirely in gold.
      const ly = Math.min(H - 4, Math.max(3, live.y - 2));
      sctx.fillStyle = `rgba(87,214,232,${0.16 + 0.16 * pulse})`;
      sctx.beginPath();
      sctx.arc(live.x, ly, 4 + 3 * pulse, 0, Math.PI * 2);
      sctx.fill();
      sctx.fillStyle = "#d9f7ff";
      sctx.fillRect(live.x - 1, ly - 3, 2, 6);
      sctx.fillRect(live.x - 3, ly - 1, 6, 2);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(stage, 0, 0, W * SCALE, H * SCALE);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [field, size, landmarks, features, win, spot, toChart]);

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

  // Keep floating names out of the gutters the chrome occupies.
  const place = (at: { x: number; y: number }, nudge: number) => {
    let left = at.x / size.width;
    let top = at.y / size.height;
    if (left > 0.82) left = 0.82;
    if (top < 0.42) top = 0.42 + nudge;
    return { left: `${left * 100}%`, top: `${Math.min(0.88, top) * 100}%` };
  };

  const passAt =
    features.pass && features.boundaryPass
      ? toChart(features.pass.column, features.pass.row)
      : null;

  return (
    <div className="chart" ref={hostRef}>
      <canvas ref={canvasRef} onMouseMove={move} onMouseLeave={() => onHover?.(null)} />
      {landmarks.map((mark, i) => (
        <span
          key={mark.deploymentId}
          className="sigil"
          style={place(toChart(mark.col, mark.row), 0.09 * (i + 1))}
        >
          <b>{mark.deploymentId}</b>
          <em>{(mark.share * 100).toFixed(0)}% of the ground</em>
        </span>
      ))}
      {passAt && features.pass ? (
        <span className="sigil ward" style={place(passAt, 0.34)}>
          <b>The Pass</b>
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
