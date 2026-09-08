"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type Phaser from "phaser";
import type { Basket } from "@/core/types";
import { bracket } from "@/core/bracket";
import { rasterize, fittedWindow, colOfPrice, priceAt, dwellAt, sample } from "@/field/raster";
import { extractFeatures } from "@/field/features";
import { findLandmarks } from "@/world/landmarks";
import { bakeChart, type BakedChart } from "@/phaser/bakeChart";
import type { ChartScene } from "@/phaser/ChartScene";

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

/** Whole-number upscale from chart pixels to screen pixels. */
const SCALE = 4;

export function PhaserChart({ baskets, spot, onHover, onFeatures, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<ChartScene | null>(null);
  const [aspect, setAspect] = useState(2.2);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const next = rect.width / rect.height;
      setAspect((held) => (Math.abs(held - next) < 0.05 ? held : next));
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

  const [chart, setChart] = useState<BakedChart | null>(null);

  // Baking touches the DOM for its canvas, so it waits for the client.
  useEffect(() => {
    setChart(bakeChart(raster, aspect));
  }, [raster, aspect]);

  useEffect(() => {
    onFeatures?.(features);
  }, [features, onFeatures]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !chart) return;

    let cancelled = false;
    let game: Phaser.Game | null = null;

    (async () => {
      const PhaserLib = (await import("phaser")).default;
      const { ChartScene } = await import("@/phaser/ChartScene");
      if (cancelled) return;

      const scene = new ChartScene();
      game = new PhaserLib.Game({
        type: PhaserLib.AUTO,
        parent: host,
        transparent: true,
        // Blocky pixels with smooth edges between them: the art stays sharp
        // while the camera can sit at any zoom rather than integer steps only.
        pixelArt: true,
        scale: { mode: PhaserLib.Scale.RESIZE, width: "100%", height: "100%" },
        banner: false,
        scene: [scene],
      });

      game.scene.start("chart", {
        chart,
        scale: SCALE,
        onPointer: (cx: number, cy: number) => {
          const fx = cx / (chart.width - 1);
          const fy = 1 - cy / (chart.height - 1);
          if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
          const price = priceAt(win, fx * (win.width - 1));
          const dwellDays = dwellAt(win, fy * (win.height - 1));
          const s = sample(baskets, price, dwellDays);
          onHover?.({ price, dwellDays, z: s.z, binder: s.binder });
        },
        onLeave: () => onHover?.(null),
      });

      gameRef.current = game;
      sceneRef.current = scene;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      setReady(false);
      sceneRef.current = null;
      gameRef.current = null;
      game?.destroy(true);
    };
  }, [chart, win, baskets, onHover]);

  // Where you stand, replaced whenever the book or the price moves.
  useEffect(() => {
    if (!ready || !chart) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const col = colOfPrice(win, spot);
    scene.setStanding(
      Math.round((col / (win.width - 1)) * (chart.width - 1)),
      chart.height - 6,
    );
  }, [ready, chart, win, spot]);

  const place = (at: { x: number; y: number }, nudge: number) => {
    if (!chart) return { display: "none" };
    let left = at.x / chart.width;
    let top = at.y / chart.height;
    if (left > 0.82) left = 0.82;
    if (top < 0.42) top = 0.42 + nudge;
    return { left: `${left * 100}%`, top: `${Math.min(0.88, top) * 100}%` };
  };

  return (
    <div className="chart" ref={hostRef}>
      {chart?.seats.map((seat, i) => (
        <span key={seat.id} className="sigil" style={place(seat.at, 0.09 * (i + 1))}>
          <b>{seat.id}</b>
          <em>{(seat.share * 100).toFixed(0)}% of the ground</em>
        </span>
      ))}
      {chart?.pass && features.pass ? (
        <span className="sigil ward" style={place(chart.pass, 0.34)}>
          <b>The Pass</b>
          <em>
            ${Math.round(features.pass.price).toLocaleString("en-US")} · held{" "}
            {features.pass.dwellDays.toFixed(0)}d
          </em>
        </span>
      ) : null}
      {landmarks.length === 0 && <span className="sigil"><b>unsurveyed</b></span>}
      {children}
    </div>
  );
}
