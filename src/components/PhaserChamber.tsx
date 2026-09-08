"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type Phaser from "phaser";
import type { Basket } from "@/core/types";
import { bracket } from "@/core/bracket";
import { dwellYears, walletShape } from "@/core/kernel";
import { rasterize, fittedWindow, priceAt, sample } from "@/field/raster";
import { extractFeatures } from "@/field/features";
import { bakeChart } from "@/phaser/bakeChart";
import type { ChamberData, FeedRow } from "@/phaser/ChamberScene";

export interface ChartReadout {
  price: number;
  dwellDays: number;
  z: number;
  binder: string | null;
}

interface Props {
  baskets: Basket[];
  label: string;
  spot: number;
  busy: boolean;
  error: string | null;
  address: string;
  onAddress: (v: string) => void;
  onSurvey: () => void;
  onReference: () => void;
  onPlate: () => void;
  onFeatures?: (f: ReturnType<typeof extractFeatures>) => void;
}

function usd(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return "—";
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function placeName(shape: ReturnType<typeof walletShape>): string {
  if (shape === "MIXED") return "The Saddle Lands";
  if (shape === "LONG-ONLY") return "The Long Fall";
  if (shape === "SHORT-ONLY") return "The Rising Tide";
  return "Unsurveyed";
}

export function PhaserChamber(props: Props) {
  const { baskets, spot } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [aspect, setAspect] = useState(1.8);
  const [readout, setReadout] = useState<ChartReadout | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const next = rect.width / rect.height;
      setAspect((held) => (Math.abs(held - next) < 0.06 ? held : next));
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
  const br = useMemo(() => bracket(baskets, 0), [baskets]);
  const shape = useMemo(() => walletShape(baskets), [baskets]);

  useEffect(() => {
    props.onFeatures?.(features);
  }, [features, props]);

  const fluxCurve = useMemo(() => {
    const out: { t: number; price: number }[] = [];
    for (let day = 0; day <= 30; day += 0.5) {
      const b = bracket(baskets, dwellYears(day));
      if (b.lower === null) continue;
      out.push({ t: day, price: b.lower });
    }
    return out;
  }, [baskets]);

  const fluxNote = useMemo(() => {
    if (fluxCurve.length < 2) return "no crash edge";
    const drift = (fluxCurve[fluxCurve.length - 1]!.price / fluxCurve[0]!.price - 1) * 100;
    return `drifts ${drift.toFixed(2)}% over 30 days`;
  }, [fluxCurve]);

  const feed: FeedRow[] = useMemo(
    () => [
      { key: "ETH", value: usd(spot) },
      { key: "crash liquidation", value: usd(br.lower), tone: "peril" },
      { key: "pump liquidation", value: usd(br.upper), tone: "peril" },
      { key: "showing", value: props.label, section: "Book" },
      { key: "shape", value: shape },
      { key: "citadels", value: String(features.binders.length), section: "Measured" },
      { key: "ley-veins", value: String(features.foldLines8) },
      { key: "drowned basins", value: String(features.basins) },
      { key: "passes", value: features.boundaryPass ? "1" : "0", tone: "ley" },
      { key: "rises with price", value: `${(features.monoFraction * 100).toFixed(1)}%` },
      {
        key: "pass price",
        value: features.pass && features.boundaryPass
          ? `${usd(features.pass.price)} · held ${features.pass.dwellDays.toFixed(0)}d`
          : "none",
      },
      { key: "terrace parameters", value: "sealed", section: "Workflow" },
      { key: "enclave", value: "not yet armed" },
    ],
    [spot, br, props.label, shape, features],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let game: Phaser.Game | null = null;

    (async () => {
      const PhaserLib = (await import("phaser")).default;
      const { ChamberScene } = await import("@/phaser/ChamberScene");
      if (cancelled) return;

      const chart = bakeChart(raster, Math.max(1.4, aspect * 1.15));
      const data: ChamberData = {
        chart,
        priceLow: priceAt(win, 0),
        priceHigh: priceAt(win, win.width - 1),
        dwellHigh: win.dwellHigh,
        spotPrice: spot,
        title: "The Scree Survey",
        placeName: placeName(shape),
        blurb:
          "A living chart of where your book dies, and how long price must stay there to kill it.",
        feed,
        fluxCurve,
        fluxNote,
        error: props.error,
        onSurvey: props.onSurvey,
        onReference: props.onReference,
        onPlate: props.onPlate,
        onPointer: (price, dwellDays) => {
          const s = sample(baskets, price, dwellDays);
          setReadout({ price, dwellDays, z: s.z, binder: s.binder });
        },
        onLeave: () => setReadout(null),
      };

      game = new PhaserLib.Game({
        type: PhaserLib.AUTO,
        parent: host,
        transparent: false,
        backgroundColor: "#141c22",
        pixelArt: true,
        scale: { mode: PhaserLib.Scale.RESIZE, width: "100%", height: "100%" },
        banner: false,
        scene: [new ChamberScene()],
      });
      game.scene.start("chamber", data);
      gameRef.current = game;
    })();

    return () => {
      cancelled = true;
      gameRef.current = null;
      game?.destroy(true);
    };
  }, [raster, win, aspect, spot, shape, feed, fluxCurve, fluxNote, baskets, props]);

  return (
    <div className="chamber" ref={hostRef}>
      {/* The one control that stays in the DOM: a real text input, so paste,
          autofill and screen readers all keep working. */}
      <input
        className="address-slot"
        value={props.address}
        onChange={(e) => props.onAddress(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !props.busy && props.onSurvey()}
        placeholder={props.busy ? "reading…" : "0x… paste an address"}
        spellCheck={false}
      />
      <div className="readout-slot">
        {readout ? (
          <>
            {usd(readout.price)} · held{" "}
            {readout.dwellDays < 1
              ? `${Math.round(readout.dwellDays * 24)}h`
              : `${readout.dwellDays.toFixed(1)}d`}{" "}
            · health {(readout.z + 1).toFixed(3)} · {readout.binder ?? "nothing binds"}
          </>
        ) : (
          <span className="dim">move over the ground to read it</span>
        )}
      </div>
    </div>
  );
}
