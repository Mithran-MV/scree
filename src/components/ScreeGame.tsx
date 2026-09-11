"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Phaser from "phaser";
import type { Basket } from "@/core/types";
import { bracket } from "@/core/bracket";
import { bindingDeployment, dwellYears, elevation, exposure, liquidationPrice, walletShape } from "@/core/kernel";
import { priceAt, rasterize } from "@/field/raster";
import { niceInterval } from "@/render/contours";
import { extractFeatures } from "@/field/features";
import { walkPaths } from "@/sim/paths";
import { bandOf, buildTerrainGrid, mapFxOf, surveyWindow, warpFx } from "@/game/terrain";
import type { ZoneReading } from "@/game/events";
import type { PriceMark, PriceTick, ScoutPath, WorldData, WorldScene } from "@/game/WorldScene";
import { cliffPrice } from "@/graph/markets";
import type { MarketsPayload } from "./MarketsWindow";
import type { FeedRow, PushedState, TerraceChart, UIData, UIScene } from "@/game/UIScene";
import type { LandingScene } from "@/game/LandingScene";
import { doorLayout, layoutFor } from "@/game/layout";
import { DPR_KEY, dprOf } from "@/game/screen";

/** How a survey was bought, as the terrain route reports it when the platform paid. */
export interface Payment {
  paidHbar: string;
  payer: string;
  payTo: string;
  transaction: string;
  network: string;
  tookMs: number;
  links: { transaction: string; topic: string | null };
}

/** The enclave's latest verdict for the surveyed wallet, as `/api/guardian` reads it from the ledger. */
export interface Guardian {
  guardian: string;
  count: number;
  wallet: string;
  verdict: "HOLD" | "RAISE" | "DROWNED" | null;
  health: number | null;
  lift: number | null;
  policyHash: string | null;
  observedAt: string | null;
  recordedAt: string | null;
  links: { contract: string; events: string };
}

export interface Sources {
  /** Deployments the survey asked, in registry order. Empty for the reference book. */
  asked: string[];
  /** Deployments that answered. */
  healthy: string[];
  /** Deployments that did not answer, or were set aside, each with its reason. */
  notes: { deploymentId: string; reason: string }[];
}

interface Props {
  baskets: Basket[];
  label: string;
  spot: number;
  sources: Sources;
  busy: boolean;
  error: string | null;
  address: string;
  onAddress: (v: string) => void;
  onSurvey: () => void;
  onConnect: () => void;
  /** Ask the browser's wallet for an address: null without a provider, a rejection when declined. */
  connectWallet: () => Promise<string | null>;
  /** The door hands over an address, or none for the reference book. */
  onBegin: (address: string | null) => void;
  wallet: string | null;
  onReference: () => void;
  onPlate: () => void;
  /** The second query's answer, for the marks on the scale and the sizes on the banners. */
  markets: MarketsPayload | null;
  onMarkets: () => void;
  payment: Payment | null;
  guardian: Guardian | null;
  onReceipts: () => void;
}

/** A defence terrace: a price band × dwell band the user raises by `liftHF`. */
interface Terrace {
  priceFxLo: number;
  priceFxHi: number;
  dwellFyLo: number;
  dwellFyHi: number;
  liftHF: number;
  label: string;
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
  const landingRef = useRef<LandingScene | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const doorFieldRef = useRef<HTMLInputElement>(null);
  /** The host observer's apply, so the game can ask for a fresh measurement once it has booted. */
  const applySizeRef = useRef<() => void>(() => {});
  /** The host's size in CSS pixels, so the page can lay its inputs where the scenes draw their slots. */
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  /** The door is up until the survey begins; the address slot belongs to the survey. */
  const [phase, setPhase] = useState<"door" | "survey">("door");

  /* ── the book, measured ───────────────────────────────────────── */

  const br = useMemo(() => bracket(baskets, 0), [baskets]);
  const win = useMemo(() => surveyWindow(spot, br.lower, br.upper), [spot, br]);
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

  /**
   * The book's reading at a point on the map: what the hover box and the
   * surveyor report. The map column is warped into the price axis first, at
   * the map height (the dwell axis is drawn square-rooted).
   */
  const readAt = useCallback(
    (fxMap: number, fy: number): ZoneReading => {
      const price = axes.priceOf(warpFx(fxMap, Math.sqrt(clamp01(fy))));
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

  /* ── the scale under the map: round prices, where they show ───── */

  const ticks = useMemo<PriceTick[]>(() => {
    const lo = priceAt(win, 0);
    const hi = priceAt(win, win.width - 1);
    const step = niceInterval(hi - lo, 7);
    const out: PriceTick[] = [];
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) out.push({ price: p, fx: mapFxOf(axes.fxOf(p), 0) });
    return out;
  }, [win, axes]);

  /* ── the high-water marks: one flag per deployment on the scale ──── */

  const marks = useMemo<PriceMark[]>(() => {
    if (!props.markets) return [];
    const out: PriceMark[] = [];
    for (const d of props.markets.deployments) {
      if (!d.charted) continue;
      const price = cliffPrice(spot, d.charted.maximumLTV, d.charted.liquidationThreshold);
      if (price === null) continue;
      out.push({ deploymentId: d.deploymentId, price, fx: mapFxOf(axes.fxOf(price), 0) });
    }
    return out;
  }, [props.markets, spot, axes]);

  const tvl = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const d of props.markets?.deployments ?? []) if (d.charted) out[d.deploymentId] = d.charted.tvlUSD;
    return out;
  }, [props.markets]);

  /* ── the terrace: the user's defence, drawn in the reading panel ── */

  const terraces = useMemo<Terrace[]>(() => {
    if (br.lower === null) return [];
    return [
      {
        priceFxLo: mapFxOf(axes.fxOf(br.lower * PROPOSED.below), 0),
        priceFxHi: mapFxOf(axes.fxOf(br.lower * PROPOSED.above), 0),
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
      note:
        `Proposed: +${terrace.liftHF.toFixed(2)} health for ${PROPOSED.days}d moves the crash edge from ${usd(edge)} to ${usd(edge * ratio)} (first order).` +
        (props.guardian?.verdict
          ? ` Enclave: ${props.guardian.verdict}${props.guardian.lift ? ` +${props.guardian.lift.toFixed(2)}` : ""}, policy ${props.guardian.policyHash?.slice(2, 8)}.`
          : ""),
    };
  }, [baskets, win, terraces, healthToday, props.guardian]);

  /* ── the feed ─────────────────────────────────────────────────── */

  const { sources } = props;
  const feed = useMemo<FeedRow[]>(
    () => [
      { key: "ETH", value: usd(spot) },
      {
        key: "sources",
        value: sources.asked.length
          ? `${sources.healthy.length} of ${sources.asked.length} answered`
          : "reference book",
        ...(sources.notes.length ? { tone: "peril" as const } : {}),
      },
      ...(props.payment ? [{ key: "paid", value: `${props.payment.paidHbar} HBAR · settled`, tone: "ley" as const }] : []),
      ...(props.guardian?.verdict
        ? [
            {
              key: "enclave verdict",
              value: `${props.guardian.verdict}${props.guardian.lift ? ` · lift +${props.guardian.lift.toFixed(2)}` : ""}`,
              tone: props.guardian.verdict === "HOLD" ? ("ley" as const) : ("peril" as const),
            },
          ]
        : []),
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
    [spot, sources, props.payment, props.guardian, healthToday, br, shape, grid.zones.length, features],
  );

  const notes = useMemo(() => {
    const lines = sources.notes.map((n) => `${n.deploymentId}: ${n.reason}`);
    if (props.payment) {
      lines.unshift(
        `Bought this survey for ${props.payment.paidHbar} HBAR from ${props.payment.payer}: settled on Hedera as ${props.payment.transaction}, receipt on the topic. Open Receipts for the links.`,
      );
    }
    const g = props.guardian;
    if (g?.verdict) {
      const when = g.observedAt ? new Date(g.observedAt).toUTCString().replace(" GMT", " UTC") : "";
      lines.unshift(
        `The enclave's verdict on this wallet: ${g.verdict}${g.lift ? `, lift +${g.lift.toFixed(2)} health` : ""}, measured ${when} against policy ${g.policyHash?.slice(0, 10)}…, which never left the enclave. Recorded on Sepolia at ${g.guardian.slice(0, 10)}…`,
      );
    }
    return lines;
  }, [sources, props.payment, props.guardian]);

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
      notes,
      tvl,
    }),
    [props.label, props.busy, props.error, props.wallet, feed, chart, notes, tvl, spot],
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
      points: p.prices.map((price, i) => {
        const fy = axes.fyOf(p.dwellDays[i]!);
        return { fx: mapFxOf(axes.fxOf(price), Math.sqrt(fy)), fy };
      }),
      diedAt: p.diedAt,
    }));
    world.sendScouts(paths);
  }, [baskets, spot, axes]);
  const sendScoutsRef = useRef(sendScouts);
  useEffect(() => {
    sendScoutsRef.current = sendScouts;
  }, [sendScouts]);

  /* ── the world's data: rebuilt when the book changes, restarting the world ── */

  const uiRef2 = useRef<UIData | null>(null);
  const worldDataRef = useRef<WorldData | null>(null);
  useEffect(() => {
    const ui = uiRef2.current;
    if (!ui) return;
    const data: WorldData = { grid, readAt, axis: { ticks, marks }, ui };
    const first = worldDataRef.current === null;
    worldDataRef.current = data;
    // A new book while the survey is open: the world starts again on it.
    if (!first && worldRef.current?.scene.isActive()) worldRef.current.scene.restart(data);
  }, [grid, readAt, ticks, marks]);

  // Marks arrive after the world is up, and move with spot: plant them and re-letter the scale.
  useEffect(() => {
    const world = worldRef.current;
    if (!world || !world.scene.isActive()) return;
    world.setAxisMarks(marks);
    uiRef.current?.relabelAxis();
  }, [marks]);

  /* ── mount, once ──────────────────────────────────────────────── */

  const gridRef = useRef(grid);
  gridRef.current = grid;
  const readAtRef = useRef(readAt);
  readAtRef.current = readAt;
  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;
  const marksRef = useRef(marks);
  marksRef.current = marks;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let game: Phaser.Game | null = null;

    (async () => {
      const PhaserLib = (await import("phaser")).default;
      const [{ LandingScene }, { WorldScene }, { UIScene }] = await Promise.all([
        import("@/game/LandingScene"),
        import("@/game/WorldScene"),
        import("@/game/UIScene"),
      ]);
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

      const ui: UIData = {
        fonts,
        getState: () => pushedRef.current,
        actions: {
          connect: () => propsRef.current.onConnect(),
          survey: () => propsRef.current.onSurvey(),
          reference: () => propsRef.current.onReference(),
          scouts: () => sendScoutsRef.current(),
          plate: () => propsRef.current.onPlate(),
          markets: () => propsRef.current.onMarkets(),
          receipts: () => propsRef.current.onReceipts(),
        },
      };
      uiRef2.current = ui;
      worldDataRef.current = { grid: gridRef.current, readAt: readAtRef.current, axis: { ticks: ticksRef.current, marks: marksRef.current }, ui };

      const landing = new LandingScene();
      const world = new WorldScene();
      const uiScene = new UIScene();
      // The canvas holds device pixels and is shown at CSS size; the scenes
      // pin their screen cameras to the density, so sprites scale up in-game
      // and type lands one glyph pixel on one screen pixel.
      const D = dprOf();
      // The host can measure empty while styles are still arriving; the
      // window is the next best guess, and the observer corrects it after boot.
      const w = host.clientWidth >= 8 ? host.clientWidth : window.innerWidth;
      const h = host.clientHeight >= 8 ? host.clientHeight : window.innerHeight;
      game = new PhaserLib.Game({
        type: PhaserLib.AUTO,
        parent: host,
        backgroundColor: "#141c22",
        pixelArt: true,
        physics: { default: "arcade" },
        scale: { mode: PhaserLib.Scale.NONE, width: Math.round(w * D), height: Math.round(h * D), zoom: 1 / D },
        input: { activePointers: 3 },
        banner: false,
      });
      game.registry.set(DPR_KEY, D);
      gameRef.current = game;
      setHostSize({ w, h });
      // Whatever the host measured at creation, the observer's measurement wins once the game is up.
      game.events.once("ready", () => applySizeRef.current());

      // The door starts; the world and its interface are registered and wait.
      // Scenes are added here rather than listed in the config, which would
      // auto-start them empty and restart them mid-load.
      game.scene.add("WorldScene", world, false);
      game.scene.add("UIScene", uiScene, false);
      game.scene.add("LandingScene", landing, true, {
        grid: gridRef.current,
        fonts,
        worldData: () => worldDataRef.current!,
        onBegin: (address: string | null) => {
          setPhase("survey");
          propsRef.current.onBegin(address);
        },
        connect: () => propsRef.current.connectWallet(),
        field: {
          get: () => doorFieldRef.current?.value ?? "",
          set: (value: string) => {
            if (doorFieldRef.current) doorFieldRef.current.value = value;
          },
          disable: () => {
            if (doorFieldRef.current) doorFieldRef.current.disabled = true;
          },
        },
      });

      worldRef.current = world;
      uiRef.current = uiScene;
      landingRef.current = landing;
      // Expose the game on its host element so tooling and tests can drive
      // the loop directly, without reaching into React.
      (host as unknown as { __game?: Phaser.Game }).__game = game;
    })();

    return () => {
      cancelled = true;
      worldRef.current = null;
      uiRef.current = null;
      uiRef2.current = null;
      landingRef.current = null;
      gameRef.current = null;
      game?.destroy(true);
    };
    // The game is made once; everything that changes reaches it through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The host's size drives the canvas and the page's inputs alike. A move
  // between screens changes the density too, so it is re-read on every resize.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const apply = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      // A host with no size yet (styles still arriving) is not a layout.
      if (w < 8 || h < 8) return;
      setHostSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      const game = gameRef.current;
      if (!game) return;
      if (!game.isBooted || !game.scale) {
        game.events.once("ready", apply);
        return;
      }
      const D = dprOf();
      if (game.registry.get(DPR_KEY) !== D) {
        game.registry.set(DPR_KEY, D);
        game.scale.setZoom(1 / D);
      }
      const gw = Math.round(w * D);
      const gh = Math.round(h * D);
      if (game.scale.width !== gw || game.scale.height !== gh) game.scale.resize(gw, gh);
    };
    applySizeRef.current = apply;
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  const slot = hostSize.w > 0 ? layoutFor(hostSize.w, hostSize.h).slot : null;
  const door = hostSize.w > 0 ? doorLayout(hostSize.w, hostSize.h).input : null;

  return (
    <div className="scree">
      <div className="world-host" ref={hostRef} />
      {/* The one control that stays in the DOM: a real text input, so paste,
          autofill and screen readers keep working. It sits on the slot the
          interface draws for it. */}
      {phase === "survey" && slot && (
        <input
          className="address-slot"
          style={{ left: slot.x + 4, top: slot.y + 4, width: slot.w - 8, height: slot.h - 8 }}
          value={props.address}
          onChange={(e) => props.onAddress(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !props.busy && props.onSurvey()}
          placeholder={props.busy ? "reading…" : "0x… paste an address"}
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
        />
      )}
      {/* The door's field: the same kind of real input, set into the stone
          console where the door's layout says the slot is. */}
      {phase === "door" && door && (
        <input
          ref={doorFieldRef}
          className="scree-terminal"
          style={{ left: door.x, top: door.y, width: door.w, height: door.h }}
          onKeyDown={(e) => e.key === "Enter" && landingRef.current?.beginFromField()}
          placeholder="0x… paste an address"
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
        />
      )}
    </div>
  );
}
