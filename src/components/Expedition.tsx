"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Phaser from "phaser";
import type { Basket } from "@/core/types";
import { bracket } from "@/core/bracket";
import { walletShape } from "@/core/kernel";
import { rasterize, fittedWindow, priceAt, sample, colOfPrice } from "@/field/raster";
import { extractFeatures } from "@/field/features";
import { walkPaths } from "@/sim/paths";
import { bakeChart, type BakedChart } from "@/phaser/bakeChart";
import type { WorldScene, ScoutPath } from "@/phaser/WorldScene";
import type { HudScene, HudEntry, HudFeedRow } from "@/phaser/HudScene";
import { PANEL_W } from "@/phaser/HudScene";

type Entry = HudEntry;
type FeedRow = HudFeedRow;

interface Props {
  baskets: Basket[];
  label: string;
  spot: number;
  busy: boolean;
  error: string | null;
  address: string;
  onAddress: (v: string) => void;
  onSurvey: () => void;
  onConnect: () => void;
  wallet: string | null;
  onReference: () => void;
  onPlate: () => void;
}

const usd = (x: number | null) =>
  x === null || !Number.isFinite(x) ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const days = (d: number) => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`);

export function Expedition(props: Props) {
  const { baskets, spot } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const hudRef = useRef<HudScene | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [scoutsBusy, setScoutsBusy] = useState(false);
  const nextId = useRef(1);

  const win = useMemo(() => {
    const br = bracket(baskets, 0);
    return fittedWindow(spot, br.lower, br.upper);
  }, [baskets, spot]);
  const raster = useMemo(() => rasterize(baskets, win), [baskets, win]);
  const features = useMemo(() => extractFeatures(raster), [raster]);
  const br = useMemo(() => bracket(baskets, 0), [baskets]);
  const shape = useMemo(() => walletShape(baskets), [baskets]);

  const log = useCallback((kind: Entry["kind"], title: string, body: string) => {
    setEntries((held) => [{ id: nextId.current++, kind, title, body }, ...held].slice(0, 60));
  }, []);

  /* ── chart coordinates <-> the field ──────────────────────────── */

  const chartRef = useRef<BakedChart | null>(null);

  const toChart = useCallback(
    (price: number, dwellDays: number) => {
      const chart = chartRef.current!;
      const lo = priceAt(win, 0);
      const hi = priceAt(win, win.width - 1);
      const fx = Math.log(price / lo) / Math.log(hi / lo);
      const fy = Math.sqrt(Math.min(1, Math.max(0, dwellDays / win.dwellHigh)));
      return {
        x: Math.round(Math.min(1, Math.max(0, fx)) * (chart.width - 1)),
        y: Math.round((1 - fy) * (chart.height - 1)),
      };
    },
    [win],
  );

  const fromChart = useCallback(
    (cx: number, cy: number) => {
      const chart = chartRef.current!;
      const lo = priceAt(win, 0);
      const hi = priceAt(win, win.width - 1);
      const fx = cx / (chart.width - 1);
      const fy = 1 - cy / (chart.height - 1);
      return { price: lo * (hi / lo) ** fx, dwellDays: fy * fy * win.dwellHigh };
    },
    [win],
  );

  /* ── the feed ─────────────────────────────────────────────────── */

  const feed: FeedRow[] = useMemo(
    () => [
      { key: "ETH", value: usd(spot) },
      { key: "crash liquidation", value: usd(br.lower), tone: "peril" },
      { key: "pump liquidation", value: usd(br.upper), tone: "peril" },
      { key: "shape", value: shape },
      { key: "citadels", value: String(features.binders.length) },
      { key: "ley-veins", value: String(features.foldLines8) },
      { key: "drowned basins", value: String(features.basins) },
      { key: "passes", value: features.boundaryPass ? "1" : "0", tone: "ley" },
      { key: "rises with price", value: `${(features.monoFraction * 100).toFixed(1)}%` },
    ],
    [spot, br, shape, features],
  );

  /* ── mount the world ──────────────────────────────────────────── */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let game: Phaser.Game | null = null;

    (async () => {
      const PhaserLib = (await import("phaser")).default;
      const { WorldScene } = await import("@/phaser/WorldScene");
      const { HudScene } = await import("@/phaser/HudScene");
      if (cancelled) return;

      // Phaser draws text with canvas fonts, so the faces the page loaded are
      // handed over by name rather than by CSS variable.
      const cssVar = (name: string, fallback: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
      const fonts = {
        mono: cssVar("--font-mono", "ui-monospace, Menlo, monospace"),
        serif: cssVar("--font-body", "Georgia, serif"),
        display: cssVar("--font-display", "Georgia, serif"),
      };

      const rect = host.getBoundingClientRect();
      const chart = bakeChart(raster, Math.max(1.4, (rect.width - PANEL_W) / Math.max(1, rect.height)));
      chartRef.current = chart;

      const startCol = colOfPrice(win, spot);
      const start = {
        x: Math.round((startCol / (win.width - 1)) * (chart.width - 1)),
        y: chart.height - 10,
      };

      // The scene is added and started once, with its data. Listing it in the
      // game config would auto-start it empty and then restart it mid-load,
      // which leaves create() running before the sheets have arrived.
      const scene = new WorldScene();
      game = new PhaserLib.Game({
        type: PhaserLib.AUTO,
        parent: host,
        backgroundColor: "#081820",
        pixelArt: true,
        scale: { mode: PhaserLib.Scale.RESIZE, width: "100%", height: "100%" },
        banner: false,
      });

      game.scene.add("world", scene, true, {
        chart,
        crashBinder: br.lowerBinder,
        pumpBinder: br.upperBinder,
        start,
        onArrive: (cx: number, cy: number, drowned: boolean) => {
          const { price, dwellDays } = fromChart(cx, cy);
          const s = sample(baskets, price, dwellDays);
          if (drowned) {
            log(
              "drowned",
              `Drowned at ${usd(price)}, held ${days(dwellDays)}`,
              `Health ${(s.z + 1).toFixed(3)}. ${s.binder ?? "The ground"} takes the book here.`,
            );
          } else {
            log(
              "reading",
              `${usd(price)} · held ${days(dwellDays)}`,
              `Health ${(s.z + 1).toFixed(3)} · ${s.binder ? `${s.binder} binds` : "nothing binds"}.`,
            );
          }
        },
        onNearSeat: (id: string | null) => {
          if (!id) return;
          const b = baskets.find((x) => x.deploymentId === id);
          const share = chart.seats.find((x) => x.id === id)?.share ?? 0;
          log(
            "seat",
            `The seat of ${id}`,
            `Rules ${(share * 100).toFixed(0)}% of the ground. ${b ? `Supplies ${b.a > 0 ? "the charted asset" : "other collateral"}, borrows ${b.u > 0 ? "the charted asset" : "other debt"}.` : ""}`,
          );
        },
        onGuardian: (which: "serpent" | "drake", binder: string | null) => {
          log(
            "guardian",
            which === "serpent" ? "The serpent stirs" : "The drake stirs",
            which === "serpent"
              ? `This is the crash side. Below ${usd(br.lower)}, ${binder ?? "the market"} liquidates you.`
              : `This is the pump side. Above ${usd(br.upper)}, ${binder ?? "the market"} liquidates you.`,
          );
        },
        onScouts: (survived: number, total: number) => {
          setScoutsBusy(false);
          log(
            "scouts",
            `${survived} of ${total} scouts returned`,
            `${((survived / total) * 100).toFixed(1)}% of 30-day price walks survive from here. The rest drowned where they stand.`,
          );
        },
      });

      const hud = new HudScene();
      game.scene.add("hud", hud, true, {
        fonts,
        onSurvey: () => propsRef.current.onSurvey(),
        onConnect: () => propsRef.current.onConnect(),
        onReference: () => propsRef.current.onReference(),
        onScouts: () => sendScoutsRef.current(),
        onPlate: () => propsRef.current.onPlate(),
      });

      gameRef.current = game;
      sceneRef.current = scene;
      hudRef.current = hud;
      hud.setState(hudStateRef.current);
      // Expose the game on its host element so tooling and tests can drive
      // the loop directly, without reaching into React.
      (host as unknown as { __game?: Phaser.Game }).__game = game;
    })();

    return () => {
      cancelled = true;
      sceneRef.current = null;
      hudRef.current = null;
      gameRef.current = null;
      game?.destroy(true);
    };
  }, [raster, win, spot, baskets, br, fromChart, log]);

  // Callbacks reach the hud through refs, so a re-render never rebuilds the game.
  const propsRef = useRef(props);
  propsRef.current = props;
  const sendScoutsRef = useRef<() => void>(() => {});

  // Everything the dashboard shows is pushed in; the hud redraws on change.
  // The latest state is also kept on a ref, so a hud created after this effect
  // last ran can be handed the current state the moment it exists.
  const hudStateRef = useRef<Partial<import("@/phaser/HudScene").HudState>>({});
  useEffect(() => {
    hudStateRef.current = {
      label: props.label,
      busy: props.busy,
      error: props.error,
      wallet: props.wallet,
      scoutsBusy,
      feed,
      entries,
    };
    hudRef.current?.setState(hudStateRef.current);
  }, [props.label, props.busy, props.error, props.wallet, scoutsBusy, feed, entries]);

  /* ── scouts ───────────────────────────────────────────────────── */

  const sendScouts = useCallback(() => {
    const scene = sceneRef.current;
    const chart = chartRef.current;
    if (!scene || !chart || scoutsBusy) return;
    setScoutsBusy(true);

    const run = walkPaths(baskets, {
      spot,
      count: 200,
      horizonDays: 30,
      steps: 60,
      volatility: 0.65,
      seed: 20260908,
    });
    const paths: ScoutPath[] = run.paths.map((p) => ({
      points: p.prices.map((price, i) => toChart(price, p.dwellDays[i]!)),
      diedAt: p.diedAt,
    }));
    log("note", "Scouts sent", "Two hundred walk the price paths the simulation drew. Watch who comes home.");
    scene.sendScouts(paths);
  }, [baskets, spot, scoutsBusy, toChart, log]);
  sendScoutsRef.current = sendScouts;

  return (
    <div className="expedition">
      <div className="world-host" ref={hostRef} />
      {/* The one control that stays in the DOM: a real text input, so paste,
          autofill and screen readers keep working. It sits on the slot the
          dashboard draws for it. */}
      <input
        className="address-slot"
        value={props.address}
        onChange={(e) => props.onAddress(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !props.busy && props.onSurvey()}
        placeholder={props.busy ? "reading…" : "0x… paste an address"}
        spellCheck={false}
      />
    </div>
  );
}
