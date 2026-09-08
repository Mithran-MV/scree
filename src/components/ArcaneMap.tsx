"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Basket } from "@/core/types";
import { bracket } from "@/core/bracket";
import { rasterize, fittedWindow, colOfPrice, priceAt, dwellAt, sample } from "@/field/raster";
import { extractFeatures } from "@/field/features";
import { niceInterval } from "@/render/contours";
import { paintGround } from "@/arcane/chart";
import { drawContours, drawLeyVeins, drawRidge } from "@/arcane/leylines";
import { drawCitadel, drawStandingStone, drawWardGate } from "@/arcane/citadels";
import { findLandmarks } from "@/world/landmarks";

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

export function ArcaneMap({ baskets, spot, onHover, onFeatures, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 1200, h: 700 });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      setBox((held) =>
        Math.abs(held.w - rect.width) < 1 && Math.abs(held.h - rect.height) < 1
          ? held
          : { w: Math.round(rect.width), h: Math.round(rect.height) },
      );
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
  const ceiling = useMemo(() => Math.max(0.05, raster.range.max), [raster]);
  const interval = useMemo(() => niceInterval(ceiling, 14), [ceiling]);

  const project = useCallback(
    (col: number, row: number): [number, number] => [
      (col / (win.width - 1)) * box.w,
      box.h - (row / (win.height - 1)) * box.h,
    ],
    [win.width, win.height, box.w, box.h],
  );

  useEffect(() => {
    onFeatures?.(features);
  }, [features, onFeatures]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    canvas.style.width = `${box.w}px`;
    canvas.style.height = `${box.h}px`;

    /* ── bake the sheet: ground, contours, waterline ──────────────── */
    const plate = document.createElement("canvas");
    plate.width = canvas.width;
    plate.height = canvas.height;
    const pctx = plate.getContext("2d")!;
    pctx.scale(dpr, dpr);

    const ground = paintGround(raster, Math.round(box.w), Math.round(box.h));
    const groundCanvas = document.createElement("canvas");
    groundCanvas.width = ground.width;
    groundCanvas.height = ground.height;
    groundCanvas
      .getContext("2d")!
      .putImageData(new ImageData(ground.data, ground.width, ground.height), 0, 0);
    pctx.drawImage(groundCanvas, 0, 0, box.w, box.h);

    drawContours(pctx, raster, project, interval, ceiling);

    const baked = plate;

    /* ── the live layers ──────────────────────────────────────────── */
    const liveAt = project(colOfPrice(win, spot), 0);
    const passAt =
      features.pass && features.boundaryPass
        ? project(features.pass.column, features.pass.row)
        : null;
    const citadels = landmarks.map((mark) => ({
      at: project(mark.col, mark.row),
      share: mark.share,
    }));

    let raf = 0;
    let start = 0;

    const frame = (now: number) => {
      if (!start) start = now;
      const t = (now - start) / 1000;
      // One slow breath drives every glow on the sheet, so nothing beats
      // against anything else.
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.15);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(baked, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      drawLeyVeins(ctx, raster, project, pulse);
      if (features.boundaryPass) drawRidge(ctx, raster, project);
      for (const c of citadels) drawCitadel(ctx, c.at[0], c.at[1], c.share, pulse);
      if (passAt) drawWardGate(ctx, passAt[0], passAt[1], pulse);
      drawStandingStone(ctx, liveAt[0], Math.min(liveAt[1] - 6, box.h - 14), pulse);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [raster, features, landmarks, win, spot, box, project, interval, ceiling]);

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
  const place = (at: [number, number], nudge: number) => {
    let left = at[0] / box.w;
    let top = at[1] / box.h;
    // The ledger owns the eastern column and the rail the northern strip; a
    // plaque that would land under either is walked clear rather than hidden.
    if (left > 0.68) left = 0.68;
    if (top < 0.34) top = 0.34 + nudge;
    return {
      left: `${left * 100}%`,
      top: `${Math.min(0.84, Math.max(0.2, top)) * 100}%`,
    };
  };

  const passAt =
    features.pass && features.boundaryPass
      ? project(features.pass.column, features.pass.row)
      : null;

  return (
    <div className="chart" ref={hostRef}>
      <canvas ref={canvasRef} onMouseMove={move} onMouseLeave={() => onHover?.(null)} />
      {landmarks.map((mark, i) => (
        <span
          key={mark.deploymentId}
          className="sigil"
          style={place(project(mark.col, mark.row), 0.08 * (i + 1))}
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
