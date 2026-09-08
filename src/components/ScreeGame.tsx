"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type Phaser from "phaser";
import type { Basket } from "@/core/types";
import { bracket } from "@/core/bracket";
import { bindingDeployment, dwellYears, elevation, exposure, liquidationPrice, walletShape } from "@/core/kernel";
import { fittedWindow, priceAt, rasterize } from "@/field/raster";
import { extractFeatures } from "@/field/features";
import { walkPaths } from "@/sim/paths";
import { bandOf, buildTerrainGrid } from "@/game/terrain";
import type { ZoneReading } from "@/game/events";
import type { ScoutPath, Terrace, WorldData, WorldScene } from "@/game/WorldScene";
import type { FeedRow, PushedState, TerraceChart, UIScene } from "@/game/UIScene";

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
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const CHART_POINTS = 31;

/** The proposed terrace: a strip around the crash edge, held for two days, lifted by 0.08 health. */
const PROPOSED = { below: 0.98, above: 1.06, days: 2, lift: 0.08 };

/**
 * Mounts the survey.
 *
 * Everything the scenes show is derived here from the book: the terrain grid,
 * the reading at any point, the terraces, the feed and the chart. The scenes
 * get data and callbacks; they never touch the arithmetic.
 */
export function ScreeGame(props: Props) {
  const { baskets, spot } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<WorldScene | null>(null);
  const uiRef = useRef<UIScene | null>(null);

  /* ── the book, measured ───────────────────────────────────────── */

  const br = useMemo(() => bracket(baskets, 0), [baskets]);
  const win = useMemo(() => fittedWindow(spot, br.lower, br.upper), [spot, br]);
  const raster = useMemo(() => rasterize(baskets, win), [baskets, win]);
  const grid = useMemo(() => buildTerrainGrid(raster, baskets, spot), [raster, baskets, spot]);
  const features = useMemo(() => extractFeatures(raster), [raster]);
  const shape = useMemo(() => walletShape(baskets), [baskets]);
  const healthToday = useMemo(() => elevation(baskets, spot, 0) + 1, [baskets, spot]);

  /* ── axes: fractions of the map ↔ price and dwell ─────────────── */

  const axes = useMemo(() => {
    const lo = priceAt(win, 0);
    const hi = priceAt(win, win.width - 1);
    return {
      priceOf: (fx: number) => lo * (hi / lo) ** clamp01(fx),
      fxOf: (price: number) => clamp01(Math.log(price / lo) / Math.log(hi / lo)),
      dwellOf: (fy: number) => clamp01(fy) * win.dwellHigh,
      fyOf: (dwellDays: number) => clamp01(dwellDays / win.dwellHigh),
    };
  }, [win]);

  /** The book's reading at a point on the map: what the hover box and the surveyor report. */
  const readAt = useCallback(
    (fx: number, fy: number): ZoneReading => {
      const price = axes.priceOf(fx);
      const dwellDays = axes.dwellOf(fy);
      const t = dwellYears(dwellDays);
      const z = elevation(baskets, price, t);
      const deploymentId = bindingDeployment(baskets, price, t);
      const basket = deploymentId ? baskets.find((b) => b.deploymentId === deploymentId) : undefined;
      return {
        price,
        dwellDays,
        hf: z + 1,
        band: bandOf(z, grid.ceiling),
        deploymentId,
        exposure: basket ? exposure(basket) : null,
        liquidationPrice: basket ? liquidationPrice(basket, t) : null,
        drowned: z < 0,
      };
    },
    [axes, baskets, grid.ceiling],
  );

  /* ── the terrace: the user's defence, drawn on the ground ─────── */

  const terraces = useMemo<Terrace[]>(() => {
    if (br.lower === null) return [];
    return [
      {
        priceFxLo: axes.fxOf(br.lower * PROPOSED.below),
        priceFxHi: axes.fxOf(br.lower * PROPOSED.above),
        dwellFyLo: 0,
        dwellFyHi: axes.fyOf(PROPOSED.days),
        liftHF: PROPOSED.lift,
        label: "proposed",
      },
    ];
  }, [br.lower, axes]);

  const chart = useMemo<TerraceChart>(() => {
    const curve: { t: number; price: number }[] = [];
    for (let i = 0; i < CHART_POINTS; i++) {
      const t = (i / (CHART_POINTS - 1)) * win.dwellHigh;
      const p = bracket(baskets, dwellYears(t)).lower;
      if (p !== null && Number.isFinite(p)) curve.push({ t, price: p });
    }
    const terrace = terraces[0];
    if (!terrace || curve.length < 2) return { curve, lifted: null, band: null, note: "" };
    // Lifting health by Δ at today's price means scaling collateral by
    // (H + Δ) / H, which moves the crash edge down by the inverse ratio.
    // First order, and the note says so.
    const ratio = healthToday / (healthToday + terrace.liftHF);
    const hiDays = terrace.dwellFyHi * win.dwellHigh;
    const lifted = curve.map((c) => ({ t: c.t, price: c.t <= hiDays ? c.price * ratio : c.price }));
    const edge = curve[0]!.price;
    return {
      curve,
      lifted,
      band: { lo: 0, hi: hiDays },
      note: `Proposed: +${terrace.liftHF.toFixed(2)} health for ${PROPOSED.days}d moves the crash edge from ${usd(edge)} to ${usd(edge * ratio)} (first order).`,
    };
  }, [baskets, win, terraces, healthToday]);

  /* ── the feed ─────────────────────────────────────────────────── */

  const feed = useMemo<FeedRow[]>(
    () => [
      { key: "ETH", value: usd(spot) },
      { key: "health today", value: healthToday.toFixed(3), tone: "ley" },
      { key: "crash liquidation", value: usd(br.lower), tone: "peril" },
      { key: "pump liquidation", value: usd(br.upper), tone: "peril" },
      { key: "shape", value: shape },
      { key: "territories", value: String(grid.zones.length) },
      { key: "ley-veins", value: String(features.foldLines8) },
      { key: "drowned basins", value: String(features.basins) },
      { key: "passes", value: features.boundaryPass ? "1" : "0", tone: "ley" },
      { key: "rises with price", value: `${(features.monoFraction * 100).toFixed(1)}%` },
    ],
    [spot, healthToday, br, shape, grid.zones.length, features],
  );

  /* ── state pushed to the interface ────────────────────────────── */

  const pushed = useMemo<PushedState>(
    () => ({
      label: props.label,
      headline: `ETH ${usd(spot)} · ${props.label}`,
      busy: props.busy,
      error: props.error,
      wallet: props.wallet,
      feed,
      chart,
    }),
    [props.label, props.busy, props.error, props.wallet, feed, chart, spot],
  );
  const pushedRef = useRef(pushed);
  useEffect(() => {
    pushedRef.current = pushed;
    uiRef.current?.setState(pushed);
  }, [pushed]);

  // Callbacks reach the scenes through refs, so a re-render never rebuilds the game.
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  /* ── scouts ───────────────────────────────────────────────────── */

  const sendScouts = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const run = walkPaths(baskets, { spot, count: 200, horizonDays: 30, steps: 60, volatility: 0.65, seed: 20260908 });
    const paths: ScoutPath[] = run.paths.map((p) => ({
      points: p.prices.map((price, i) => ({ fx: axes.fxOf(price), fy: axes.fyOf(p.dwellDays[i]!) })),
      diedAt: p.diedAt,
    }));
    world.sendScouts(paths);
  }, [baskets, spot, axes]);
  const sendScoutsRef = useRef(sendScouts);
  useEffect(() => {
    sendScoutsRef.current = sendScouts;
  }, [sendScouts]);

  /* ── mount ────────────────────────────────────────────────────── */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let game: Phaser.Game | null = null;

    (async () => {
      const PhaserLib = (await import("phaser")).default;
      const [{ WorldScene }, { UIScene }] = await Promise.all([import("@/game/WorldScene"), import("@/game/UIScene")]);
      if (cancelled) return;

      // Phaser draws text with canvas fonts, so the faces the page loaded are
      // handed over by name rather than by CSS variable.
      const cssVar = (name: string, fallback: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
      const fonts = {
        mono: cssVar("--font-mono", "ui-monospace, Menlo, monospace"),
        serif: cssVar("--font-body", "Georgia, serif"),
        display: cssVar("--font-display", "Georgia, serif"),
        pixel: cssVar("--font-pixel", "monospace"),
      };

      const world = new WorldScene();
      const ui = new UIScene();
      game = new PhaserLib.Game({
        type: PhaserLib.AUTO,
        parent: host,
        backgroundColor: "#141c22",
        pixelArt: true,
        physics: { default: "arcade" },
        scale: { mode: PhaserLib.Scale.RESIZE, width: "100%", height: "100%" },
        banner: false,
      });

      const data: WorldData = {
        grid,
        readAt,
        terraces,
        ui: {
          fonts,
          getState: () => pushedRef.current,
          actions: {
            connect: () => propsRef.current.onConnect(),
            survey: () => propsRef.current.onSurvey(),
            reference: () => propsRef.current.onReference(),
            scouts: () => sendScoutsRef.current(),
            plate: () => propsRef.current.onPlate(),
          },
        },
      };

      // The interface is registered but not started: the world launches it
      // once the ground exists. The world is added and started once, with its
      // data, rather than listed in the config, which would auto-start it
      // empty and restart it mid-load.
      game.scene.add("WorldScene", world, true, data);
      game.scene.add("UIScene", ui, false);

      worldRef.current = world;
      uiRef.current = ui;
      // Expose the game on its host element so tooling and tests can drive
      // the loop directly, without reaching into React.
      (host as unknown as { __game?: Phaser.Game }).__game = game;
    })();

    return () => {
      cancelled = true;
      worldRef.current = null;
      uiRef.current = null;
      game?.destroy(true);
    };
  }, [grid, readAt, terraces]);

  return (
    <div className="scree">
      <div className="world-host" ref={hostRef} />
      {/* The one control that stays in the DOM: a real text input, so paste,
          autofill and screen readers keep working. It sits on the slot the
          interface draws for it. */}
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
