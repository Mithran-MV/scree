import Phaser from "phaser";
import { UI, button, label, nine } from "./chrome";
import { loadUiStock } from "./assets";
import { WebFontFile } from "./fonts";
import { layoutFor, type Layout, type Rect } from "./layout";
import { logical, pinToScreen } from "./screen";
import {
  EV,
  type ArriveEvent,
  type CitadelHover,
  type GuardianEvent,
  type MonsterEvent,
  type ScoutsEvent,
  type WelcomeEvent,
  type ZoneReading,
} from "./events";
import { T } from "./theme";
import type { Anchor, WorldScene } from "./WorldScene";
import { AXIS_H } from "./WorldScene";

export interface FeedRow {
  key: string;
  value: string;
  tone?: "peril" | "ley";
}

export interface TerraceChart {
  /** Crash liquidation price against dwell, in days. */
  curve: { t: number; price: number }[];
  /** The same curve with the proposed terrace's lift applied. */
  lifted: { t: number; price: number }[] | null;
  /** The terrace's dwell band, in days. */
  band: { lo: number; hi: number } | null;
  note: string;
}

export interface UIState {
  label: string;
  /** The line at the right end of the top bar. */
  headline: string;
  busy: boolean;
  error: string | null;
  wallet: string | null;
  feed: FeedRow[];
  chart: TerraceChart;
  /**
   * What the survey has to say about its sources: deployments that did not
   * answer, and deployments set aside because the schema could not explain
   * them. Each new line is written to the log once.
   */
  notes: string[];
  /** Each deployment's market size in the charted asset, in USD, for the banners. */
  tvl: Record<string, number>;
  /** Owned by the interface: set when the scouts go out, cleared when the world reports them home. */
  scoutsBusy: boolean;
}

/** What the page pushes in. The interface keeps its own flags. */
export type PushedState = Omit<UIState, "scoutsBusy">;

/** A handler for one of the world's events; `never` lets each take its own payload. */
type Listener = (payload: never) => void;

export interface UIData {
  fonts: { mono: string; serif: string; display: string; pixel: string };
  /** The current state, pulled once at create; pushed afterwards with setState. */
  getState: () => PushedState;
  actions: {
    connect: () => void;
    survey: () => void;
    reference: () => void;
    scouts: () => void;
    plate: () => void;
    markets: () => void;
    receipts: () => void;
  };
}

/** Depth plan for the interface: everything above the world, pop-ups on top. */
const UI_DEPTH = { frame: 90, column: 92, banners: 93, bar: 95, plate: 96, hover: 100, popup: 100 } as const;

/** Type sizes, in CSS pixels. Pixel-face kickers stay on their 8px grid. */
const TYPE = { kicker: 8, title: 17, body: 12.5, feedKey: 13, feedValue: 12, log: 12.5, caption: 10, small: 10 } as const;

interface Banner {
  anchor: Anchor;
  box: Phaser.GameObjects.Container;
  w: number;
  h: number;
  bob: number;
}

const usd = (x: number | null) =>
  x === null || !Number.isFinite(x) ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const usd0 = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
/** aave-v3-ethereum → aave·eth: room on a scale. */
const shortId = (id: string) => {
  const [protocol, , network] = id.split("-");
  const net = { ethereum: "eth", arbitrum: "arb", polygon: "poly", avalanche: "avax", base: "base", optimism: "op", gnosis: "gno" }[network ?? ""] ?? network ?? "";
  const proto = { aave: "aave", compound: "comp", spark: "spark" }[protocol ?? ""] ?? protocol ?? id;
  return net ? `${proto}·${net}` : proto;
};
/** $3.6B, $412M, $9.1M: a size on a banner. */
const short = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(x >= 1e8 ? 0 : 1)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(0)}K` : `$${x.toFixed(0)}`;
const days = (d: number) => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`);

/**
 * The instrument around the map.
 *
 * Launched over the world and pinned to the screen: the top bar, the bezel,
 * the title plate, the live feed, the terrace chart, the hover box and the
 * pop-ups. Every box is a nine-slice of baked pixel-art stock. It draws no
 * terrain and holds no arithmetic; it listens to the world and to the page,
 * and it calls the actions it was handed. Its geometry comes from one shared
 * layout, wide or narrow, that the page also reads.
 */
export class UIScene extends Phaser.Scene {
  private opts!: UIData;
  private state!: UIState;
  private world!: WorldScene;
  private lay!: Layout;

  private bar!: Phaser.GameObjects.Container;
  private frame!: Phaser.GameObjects.Container;
  private plate!: Phaser.GameObjects.Container;
  private column!: Phaser.GameObjects.Container;
  private hover!: Phaser.GameObjects.Container;
  private popup!: Phaser.GameObjects.Container;
  private popupTween: Phaser.Tweens.Tween | undefined;
  private popupTimer: Phaser.Time.TimerEvent | undefined;
  private popupPinnedUntil = 0;
  private log: string[] = [];
  private banners: Banner[] = [];
  private axisLabels: Phaser.GameObjects.Text[] = [];
  private markLabels: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: "UIScene" });
  }

  init(data: UIData) {
    this.opts = data;
    this.state = { scoutsBusy: false, ...data.getState() };
  }

  /** The interface's stock, and the pixel face the page declared: the loader waits for it. */
  preload() {
    loadUiStock(this);
    this.load.addFile(new WebFontFile(this.load, this.opts.fonts.pixel));
  }

  create() {
    this.world = this.scene.get("WorldScene") as WorldScene;
    this.banners = [];
    this.axisLabels = [];
    this.frame = this.add.container(0, 0).setDepth(UI_DEPTH.frame);
    this.column = this.add.container(0, 0).setDepth(UI_DEPTH.column);
    this.bar = this.add.container(0, 0).setDepth(UI_DEPTH.bar);
    this.plate = this.add.container(0, 0).setDepth(UI_DEPTH.plate);
    this.hover = this.add.container(0, 0).setDepth(UI_DEPTH.hover);
    this.popup = this.add.container(0, 0).setDepth(UI_DEPTH.popup).setVisible(false);

    this.layout();
    this.raiseBanners();
    const onResize = () => this.layout();
    this.scale.on("resize", onResize);

    // The world restarts with every new survey and launches this scene again,
    // so create() runs once per survey seen. Whatever it listens for is
    // forgotten at shutdown; otherwise each arrival would be logged once per
    // survey and the resize handlers would pile up.
    const ev = this.world.events;
    const listening: Array<[string, Listener]> = [];
    const on = (name: string, fn: Listener) => {
      ev.on(name, fn);
      listening.push([name, fn]);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", onResize);
      for (const [name, fn] of listening) ev.off(name, fn);
    });

    on(EV.zoneHover, (r: ZoneReading) => this.showZone(r));
    on(EV.citadelHover, (c: CitadelHover) => (c.entered ? this.showCitadel(c) : this.showIdle()));
    on(EV.hoverEnd, () => this.showIdle());
    on(EV.monsterHover, (m: MonsterEvent) => (m.entered ? this.showMonster(m, false) : this.hidePopup()));
    on(EV.monsterClick, (m: MonsterEvent) => {
      this.showMonster(m, true);
      this.note(`${m.name}: ${m.warning}`);
    });
    on(EV.welcome, (w: WelcomeEvent) => this.showWelcome(w));
    on(EV.arrive, (r: ArriveEvent) =>
      this.note(
        r.drowned
          ? `Drowned at ${usd(r.price)}, held ${days(r.dwellDays)}. ${r.deploymentId ?? "The ground"} takes the book.`
          : `Stood at ${usd(r.price)}, held ${days(r.dwellDays)}: health ${r.hf.toFixed(3)}.`,
      ),
    );
    on(EV.guardian, (g: GuardianEvent) =>
      this.note(`The ${g.name} stirs in ${g.reading.deploymentId ?? "open"} water, ${usd(g.reading.price)} deep: ${g.warning}`),
    );
    on(EV.scouts, (s: ScoutsEvent) => {
      this.state.scoutsBusy = false;
      const pct = ((s.survived / s.total) * 100).toFixed(1);
      this.note(`${s.survived} of ${s.total} scouts returned: ${pct}% survive from here.`);
      const { map: v } = this.lay;
      this.showPopup(
        "THE SCOUTS ARE BACK",
        `${s.survived} of ${s.total} came home. ${pct}% of thirty-day price walks from where the surveyor stands end on dry ground; the rest crossed the shore and drowned where they fell.`,
        v.x + v.w / 2 - 140 - 18,
        v.y + 96 - 18,
        s.survived / s.total < 0.5 ? T.peril : T.ley,
        8000,
      );
    });
  }

  /**
   * Territory banners float over the holdfasts and price labels sit on the
   * scale under the map. Both live in this scene, so their type stays crisp
   * at any zoom, and are projected from world to screen every frame.
   */
  private raiseBanners() {
    const f = this.opts.fonts;
    for (const b of this.banners) b.box.destroy();
    for (const t of this.axisLabels) t.destroy();
    for (const t of this.markLabels) t.destroy();
    this.banners = this.world.holdfasts.map((anchor) => {
      const tvl = this.state.tvl[anchor.deploymentId];
      const text = label(this, 0, 0, `${anchor.deploymentId} · ${Math.round(anchor.share * 100)}%${tvl ? ` · ${short(tvl)}` : ""}`, { size: TYPE.kicker, font: f.pixel, color: T.vellumInk, crisp: true });
      const w = Math.round(text.width) + 38;
      const h = 26;
      const flag = this.add.rectangle(11, 8, 8, 10, anchor.colour).setOrigin(0, 0);
      const pole = this.add.rectangle(9, 6, 2, 14, 0x4a4238).setOrigin(0, 0);
      text.setPosition(26, 9);
      const box = this.add.container(0, 0, [nine(this, UI.panel, 0, 0, w, h), pole, flag, text]).setDepth(UI_DEPTH.banners);
      const banner: Banner = { anchor, box, w, h, bob: 0 };
      this.tweens.add({ targets: banner, bob: { from: -2, to: 2 }, duration: 1400 + Math.random() * 600, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      return banner;
    });
    this.axisLabels = this.world.axisTicks.map((tick) =>
      label(this, 0, 0, `$${tick.price.toLocaleString("en-US")}`, { size: TYPE.kicker, font: f.pixel, color: T.vellumInk, crisp: true, align: "center" }).setDepth(UI_DEPTH.banners),
    );
    // The high-water marks are lettered with the deployment and the price a maximum-leverage borrower drowns at.
    this.markLabels = this.world.axisMarks.map((m) =>
      label(this, 0, 0, `${shortId(m.deploymentId)} ${usd0(m.price)}`, { size: TYPE.kicker, font: f.pixel, color: m.colour, crisp: true, stroke: { color: T.vellum, thickness: 3 } }).setDepth(UI_DEPTH.banners),
    );
  }

  override update() {
    if (!this.lay) return;
    const cam = this.world.cameras.main;
    const { D } = logical(this);
    const v = this.lay.map;
    // The world camera works in device pixels; this scene in CSS pixels.
    const sx = (wx: number) => (cam.x + (wx - cam.worldView.x) * cam.zoom) / D;
    const sy = (wy: number) => (cam.y + (wy - cam.worldView.y) * cam.zoom) / D;
    for (const b of this.banners) {
      const x = sx(b.anchor.x);
      const y = sy(b.anchor.top) - 8 + b.bob;
      const left = Math.round(x - b.w / 2);
      const top = Math.round(y - b.h);
      // A banner is shown whole or not at all: nothing of it may lie on the bezel.
      const inside = left >= v.x && left + b.w <= v.x + v.w && top >= v.y && top + b.h <= v.y + v.h;
      b.box.setVisible(inside).setPosition(left, top);
    }
    this.world.axisTicks.forEach((tick, i) => {
      const t = this.axisLabels[i]!;
      const x = sx(tick.fx * this.world.worldWidth);
      const y = sy(this.world.worldHeight + AXIS_H * 0.5);
      const inside = x > v.x + 20 && x < v.x + v.w - 20 && y > v.y && y < v.y + v.h - 8;
      t.setVisible(inside).setPosition(Math.round(x), Math.round(y));
    });
    // Mark labels hang from their flags. Flags can crowd one stretch of the
    // scale, so labels take the first of four rows with room; one that would
    // overprint on every row is left to its flag alone until the map is
    // zoomed in and the rows open up.
    const rows: number[] = [-Infinity, -Infinity, -Infinity, -Infinity];
    const order = this.world.axisMarks.map((m, i) => ({ m, i })).sort((a, b) => a.m.fx - b.m.fx);
    for (const { m, i } of order) {
      const t = this.markLabels[i];
      if (!t) continue;
      const x = sx(m.fx * this.world.worldWidth) + 6;
      const row = rows.findIndex((right) => x > right + 6);
      if (row < 0) {
        t.setVisible(false);
        continue;
      }
      rows[row] = x + t.width;
      const y = sy(this.world.worldHeight + AXIS_H * (0.46 + row * 0.13));
      const inside = x > v.x && x + t.width < v.x + v.w && y > v.y && y < v.y + v.h - 8;
      t.setVisible(inside).setPosition(Math.round(x), Math.round(y));
    }
  }

  /** Replace part of the state and redraw what shows it. */
  setState(next: Partial<UIState>) {
    // The page may push before the scene has started; the first state then comes through init.
    if (!this.state) return;
    const before = new Set(this.state.notes);
    this.state = { ...this.state, ...next };
    for (const line of this.state.notes) {
      if (!before.has(line)) this.log = [line, ...this.log].slice(0, 8);
    }
    if (this.column) {
      this.drawColumn();
      this.drawBar();
      // New market sizes or marks re-letter the banners and the scale.
      if (next.tvl !== undefined) this.raiseBanners();
    }
  }

  /** The world's scale changed under the interface: letter it again. */
  relabelAxis() {
    if (this.column) this.raiseBanners();
  }

  /* ── layout ───────────────────────────────────────────────────────── */

  private layout() {
    const { W, H, D } = logical(this);
    pinToScreen(this.cameras.main, D);
    this.lay = layoutFor(W, H);
    this.drawBar();
    this.drawFrame();
    this.drawPlate();
    this.showIdle();
    this.drawColumn();
  }

  /** The top bar: dark ashlar across the whole width, the title cut into it. */
  private drawBar() {
    const { W, narrow, compact, topBar } = this.lay;
    const f = this.opts.fonts;
    const s = this.state;
    this.bar.removeAll(true);
    const ground = this.add.tileSprite(0, 0, W, topBar, UI.topbar).setOrigin(0, 0);
    this.bar.add(ground);
    const titleSize = narrow ? 16 : 24;
    this.bar.add(label(this, 14, Math.round((topBar - titleSize) / 2) - 2, "SCREE", { size: titleSize, font: f.pixel, color: T.vellum, stroke: { color: T.shellEdge, thickness: narrow ? 4 : 6 }, shadow: true, crisp: true }));
    if (!compact) {
      this.bar.add(label(this, narrow ? 112 : 160, Math.round(topBar / 2) - 4, "LIQUIDATION TOPOGRAPHY", { size: TYPE.kicker, font: f.pixel, color: T.ley, tracking: 2, stroke: { color: T.shellEdge, thickness: 3 }, crisp: true }));
    }
    const headline = narrow ? s.label : s.headline;
    this.bar.add(label(this, W - 14, Math.round(topBar / 2) - 4, headline, { size: TYPE.kicker, font: f.pixel, color: T.inkDim, align: "right", stroke: { color: T.shellEdge, thickness: 3 }, crisp: true }));
  }

  /** The bezel: housing around the map viewport under the bar, and the inset lines that make it read as glass. */
  private drawFrame() {
    const { W, H, topBar, map: v } = this.lay;
    this.frame.removeAll(true);
    const housing = this.add.graphics();
    housing.fillStyle(T.shellDark, 1);
    housing.fillRect(0, topBar, W, v.y - topBar);
    housing.fillRect(0, v.y + v.h, W, H - v.y - v.h);
    housing.fillRect(0, topBar, v.x, H - topBar);
    housing.fillRect(v.x + v.w, topBar, W - v.x - v.w, H - topBar);
    housing.lineStyle(2, T.shellLit, 0.7);
    housing.strokeRoundedRect(v.x - 5, v.y - 5, v.w + 10, v.h + 10, 4);
    housing.lineStyle(1, T.shellEdge, 1);
    housing.strokeRoundedRect(v.x - 2, v.y - 2, v.w + 4, v.h + 4, 2);
    this.frame.add(housing);
  }

  /** The title plate, pinned inside the north-west corner of the map. Narrow screens have no room for it. */
  private drawPlate() {
    const { map: v, narrow } = this.lay;
    const f = this.opts.fonts;
    this.plate.removeAll(true);
    if (narrow) return;
    const w = 288;
    const pad = 14;
    const kicker = label(this, pad, pad - 2, "THE SCREE SURVEY", { size: TYPE.kicker, font: f.pixel, color: T.vellumInkDim, crisp: true });
    const title = label(this, pad, pad + 12, "Liquidation Topography", { size: TYPE.title, font: f.display, color: T.vellumInk });
    const blurb = label(this, pad, pad + 40, "Elevation is health. Sea level is liquidation. West to east is price; north is how long it held.", {
      size: TYPE.body,
      font: f.serif,
      color: T.vellumInkDim,
      wrap: w - pad * 2,
    });
    const h = pad + 40 + blurb.height + pad - 2;
    this.plate.setPosition(v.x + 14, v.y + 14);
    this.plate.add([nine(this, UI.panel, 0, 0, w, h), kicker, title, blurb]);
  }

  /**
   * The reading panel, pinned to the south-west corner of the map: what the
   * ground under the pointer says, with the terrace-depth graph set into its
   * right-hand side when there is room, sized to its text and never larger
   * than it needs.
   */
  private showHover(title: string, body: string) {
    const { map: v, narrow } = this.lay;
    const f = this.opts.fonts;
    const pad = 14;
    const inset = narrow ? 8 : 14;
    const maxW = v.w - inset * 2;
    const chartW = 132;
    const chartH = 68;
    const withChart = maxW >= 380;
    const textW = withChart ? Math.min(250, maxW - chartW - 12 - pad * 2) : Math.min(360, maxW - pad * 2);
    const w = withChart ? pad + textW + 12 + chartW + pad : pad + textW + pad;
    this.hover.removeAll(true);
    const t = label(this, pad, pad - 3, title, { size: TYPE.kicker, font: f.pixel, color: T.vellumInk, wrap: textW, crisp: true });
    const b = label(this, pad, pad + t.height + 5, body, { size: TYPE.body, font: f.serif, color: T.vellumInkDim, wrap: textW });
    const block = Math.max(t.height + 5 + b.height, withChart ? chartH + 12 : 0);
    const showCaption = Boolean(this.state.chart.note) && !narrow;
    const caption = showCaption
      ? label(this, pad, pad + block + 6, this.state.chart.note, { size: TYPE.caption, font: f.mono, color: T.vellumInk, wrap: w - pad * 2 })
      : null;
    const h = pad + block + (caption ? 6 + caption.height : 0) + pad - 2;
    this.hover.setPosition(v.x + inset, this.hoverBottom(v, h, inset) - h);
    const parts: Phaser.GameObjects.GameObject[] = [nine(this, UI.panel, 0, 0, w, h), t, b];
    if (caption) parts.push(caption);
    if (withChart) parts.push(...this.miniChart(pad + textW + 12, pad, chartW, chartH));
    this.hover.add(parts);
  }

  /** Terrace depth in miniature: the crash edge against dwell, the proposed band shaded, the lifted curve beneath. */
  private miniChart(x: number, y: number, w: number, h: number): Phaser.GameObjects.GameObject[] {
    const f = this.opts.fonts;
    const { curve, lifted, band } = this.state.chart;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.35);
    g.fillRect(x, y + 12, w, h - 12);
    g.lineStyle(1, T.vellumEdge, 0.7);
    g.strokeRect(x, y + 12, w, h - 12);
    const head = label(this, x, y - 3, "TERRACE DEPTH", { size: TYPE.kicker, font: f.pixel, color: T.vellumInkDim, crisp: true });
    if (curve.length < 2) return [g, head];
    const px = x + 4;
    const py = y + 16;
    const pw = w - 8;
    const ph = h - 20;
    const all = [...curve, ...(lifted ?? [])].map((c) => c.price);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = Math.max(hi - lo, hi * 0.01);
    const tMax = curve[curve.length - 1]!.t;
    const X = (t: number) => px + (t / tMax) * pw;
    const Y = (p: number) => py + ph - ((p - (lo - span * 0.15)) / (span * 1.3)) * ph;
    if (band) {
      g.fillStyle(T.ley, 0.22);
      g.fillRect(X(band.lo), py, Math.max(2, X(band.hi) - X(band.lo)), ph);
    }
    const stroke = (pts: { t: number; price: number }[], colour: number) => {
      g.lineStyle(1.5, colour, 0.95);
      g.beginPath();
      pts.forEach((c, i) => (i === 0 ? g.moveTo(X(c.t), Y(c.price)) : g.lineTo(X(c.t), Y(c.price))));
      g.strokePath();
    };
    stroke(curve, T.peril);
    if (lifted) stroke(lifted, T.leyDim);
    const axis = label(this, x + w, y + h - 10, `${Math.round(tMax)}d`, { size: 9, font: f.mono, color: T.vellumInkDim, align: "right" });
    return [g, head, axis];
  }

  /** The instrument column: controls, feed, log. Beside the map, or under it. */
  private drawColumn() {
    const { H, narrow, column, slot, survey, buttons, buttonLabels, feedTop, frame } = this.lay;
    const f = this.opts.fonts;
    const s = this.state;
    const x0 = column.x + 8;
    const cw = column.w - 16;
    const pad = 12;
    this.column.removeAll(true);

    const add = (r: Rect, text: string, onClick: () => void, enabled = true) =>
      this.column.add(button(this, r.x, r.y, text, { width: r.w, height: r.h, onClick, enabled }));

    // Address slot (the page lays a real input over it) and the survey button.
    this.column.add(nine(this, UI.console, slot.x, slot.y, slot.w, slot.h));
    add(survey, s.busy ? "…" : "Survey", this.opts.actions.survey, !s.busy);

    const long = buttonLabels === "long";
    const walletText = s.wallet ? `${s.wallet.slice(0, 6)}…${s.wallet.slice(-4)}` : long ? "Connect wallet" : "Wallet";
    add(buttons[0]!, walletText, this.opts.actions.connect, !s.busy);
    add(buttons[1]!, long ? "Reference book" : "Book", this.opts.actions.reference);
    add(
      buttons[2]!,
      s.scoutsBusy ? (long ? "Scouts out…" : "Out…") : long ? "Send 200 scouts" : "Scouts",
      () => {
        this.setState({ scoutsBusy: true });
        const { map: v } = this.lay;
        this.showPopup(
          "SCOUTS OUT",
          "Two hundred scouts leave the surveyor's ground on thirty-day price walks. Watch the shore: the ones that cross it drown where they fall, and the count comes back to the log.",
          v.x + v.w / 2 - 140 - 18,
          v.y + 96 - 18,
          T.ley,
          3500,
        );
        this.opts.actions.scouts();
      },
      !s.scoutsBusy,
    );
    add(buttons[3]!, long ? "Survey plate" : "Plate", this.opts.actions.plate);
    add(buttons[4]!, "The markets", this.opts.actions.markets);
    add(buttons[5]!, "Receipts", this.opts.actions.receipts);

    let y = feedTop;
    if (s.error) {
      const err = label(this, x0 + 8, y, s.error, { size: TYPE.small, color: T.perilBright, font: f.mono, wrap: cw - 16 });
      this.column.add(err);
      y += err.height + 8;
    }

    // Live feed: one column of key and value, or two side by side when the column is under the map.
    const rowH = narrow ? 18 : 20;
    const cols = narrow ? 2 : 1;
    const rows = Math.ceil(s.feed.length / cols);
    const feedH = 30 + rows * rowH + 6;
    this.column.add(nine(this, UI.console, x0, y, cw, feedH));
    this.column.add(label(this, x0 + pad, y + 10, "LIVE FEED", { size: TYPE.kicker, font: f.pixel, color: T.ley, crisp: true }));
    if (!narrow) this.column.add(label(this, x0 + cw - pad, y + 10, s.label, { size: TYPE.small, color: T.inkDim, align: "right", font: f.mono }));
    const colW = (cw - pad * 2 - (cols - 1) * 12) / cols;
    s.feed.forEach((row, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const rx = x0 + pad + c * (colW + 12);
      const ry = y + 30 + r * rowH;
      const tone = row.tone === "peril" ? T.perilBright : row.tone === "ley" ? T.ley : T.ink;
      this.column.add(label(this, rx, ry, row.key, { size: narrow ? 11.5 : TYPE.feedKey, color: T.inkDim, font: f.serif }));
      this.column.add(label(this, rx + colW, ry + 1, row.value, { size: narrow ? 11 : TYPE.feedValue, color: tone, align: "right", font: f.mono }));
    });
    y += feedH + 8;

    // The log: what happened on the ground, newest first, filling what remains of the column.
    const logH = Math.max(narrow ? 84 : 120, H - y - frame);
    this.column.add(nine(this, UI.console, x0, y, cw, logH));
    this.column.add(label(this, x0 + pad, y + 10, "ON THE GROUND", { size: TYPE.kicker, font: f.pixel, color: T.ley, crisp: true }));
    if (this.log.length === 0) {
      this.column.add(label(this, x0 + pad, y + 30, narrow ? "Tap the map and the surveyor walks there." : "Nothing yet. Click the map and the surveyor walks there.", { size: TYPE.log, color: T.inkDim, font: f.serif, wrap: cw - pad * 2 }));
    }
    let ly = y + 30;
    for (const [i, line] of this.log.entries()) {
      if (ly > y + logH - 22) break;
      const t = label(this, x0 + pad, ly, line, { size: TYPE.log, color: i === 0 ? T.ink : T.inkDim, font: f.serif, wrap: cw - pad * 2 });
      if (ly + t.height > y + logH - 6) {
        t.destroy();
        break;
      }
      this.column.add(t);
      ly += t.height + 6;
    }
  }

  /* ── pop-ups ──────────────────────────────────────────────────────── */

  /**
   * A pop-up on the parchment stock, sized to its text, scaled in from
   * nothing with a Back ease so it lands with a snap. `x, y` is where it
   * points at, in CSS pixels; the box is kept inside the map viewport.
   */
  private showPopup(title: string, body: string, x: number, y: number, tone: number, pinMs: number) {
    const { map: v } = this.lay;
    const f = this.opts.fonts;
    const w = Math.min(280, v.w - 24);
    const pad = 14;
    this.popupTween?.destroy();
    this.popupTimer?.remove(false);
    this.popup.removeAll(true);

    const t = label(this, 0, 0, title, { size: TYPE.kicker, font: f.pixel, color: tone, wrap: w - pad * 2, crisp: true });
    const b = label(this, 0, 0, body, { size: TYPE.body, font: f.serif, color: T.vellumInkDim, wrap: w - pad * 2 });
    const h = pad + t.height + 8 + b.height + pad - 2;
    // Children sit around the container's origin, so the scale tween grows the box from its centre.
    const panel = nine(this, UI.panel, -w / 2, -h / 2, w, h);
    const rule = this.add.rectangle(-w / 2 + pad, -h / 2 + pad + t.height + 3, w - pad * 2, 1, tone, 0.6).setOrigin(0, 0);
    t.setPosition(-w / 2 + pad, -h / 2 + pad - 2);
    b.setPosition(-w / 2 + pad, -h / 2 + pad + t.height + 8);
    this.popup.add([panel, rule, t, b]);

    const cx = Phaser.Math.Clamp(x + 18 + w / 2, v.x + w / 2 + 6, v.x + v.w - w / 2 - 6);
    const cy = Phaser.Math.Clamp(y + 18 + h / 2, v.y + h / 2 + 6, v.y + v.h - h / 2 - 6);
    this.popup.setPosition(cx, cy).setVisible(true).setScale(0);
    this.popupTween = this.tweens.add({ targets: this.popup, scale: { from: 0, to: 1 }, duration: 200, ease: "Back.easeOut" });
    this.popupPinnedUntil = pinMs > 0 ? this.time.now + pinMs : 0;
    if (pinMs > 0) this.popupTimer = this.time.delayedCall(pinMs, () => this.hidePopup(true));
  }

  private hidePopup(force = false) {
    if (!this.popup.visible) return;
    if (!force && this.popupPinnedUntil > this.time.now) return;
    this.popupTween?.destroy();
    this.popupTween = this.tweens.add({
      targets: this.popup,
      scale: 0,
      duration: 150,
      ease: "Back.easeIn",
      onComplete: () => this.popup.setVisible(false),
    });
  }

  private showMonster(m: MonsterEvent, pinned: boolean) {
    const r = m.reading;
    const where = `It swims ${usd(r.price)} deep in ${r.deploymentId ? `${r.deploymentId}'s` : "open"} water, health ${r.hf.toFixed(3)}.`;
    this.showPopup(`WARNING: ${m.name.toUpperCase()}`, `${m.warning} ${where}`, m.x, m.y, T.peril, pinned ? 6000 : 0);
  }

  private showWelcome(w: WelcomeEvent) {
    const { map: v } = this.lay;
    const threshold = w.liquidationPrice !== null ? ` It liquidates ${w.exposure === "SHORT" ? "above" : "below"} ${usd(w.liquidationPrice)}.` : "";
    const body = `${w.greeting} It rules ${(w.share * 100).toFixed(0)}% of the ground.${threshold}`;
    this.showPopup(`WELCOME TO THE SEAT OF ${w.deploymentId.toUpperCase()}`, body, v.x + v.w / 2 - 140 - 18, v.y + 96 - 18, T.brass, 7000);
    this.note(`Welcomed at the seat of ${w.deploymentId}.`);
  }

  /* ── hover box ────────────────────────────────────────────────────── */

  private showIdle() {
    this.showHover("THE GROUND", this.lay.narrow ? "Tap the map to read it; the surveyor walks there." : "Move over the map to read it. Click, and the surveyor walks there.");
  }

  private showZone(r: ZoneReading) {
    const who = r.deploymentId ? r.deploymentId.toUpperCase() : "OPEN WATER";
    const threshold =
      r.liquidationPrice !== null
        ? `Liquidates ${r.exposure === "SHORT" ? "above" : "below"} ${usd(r.liquidationPrice)} at this dwell.`
        : "Nothing binds here.";
    this.showHover(
      `${who}${r.exposure ? ` · ${r.exposure}` : ""}${r.drowned ? " · DROWNED" : ""}`,
      `${usd(r.price)} · held ${days(r.dwellDays)} · health ${r.hf.toFixed(3)}. ${threshold}`,
    );
  }

  /**
   * Where the reading panel's bottom edge goes: just above the price scale
   * when the scale is on screen with room for the panel over it, so the
   * scale's marks and their labels are never covered; else the viewport's
   * bottom.
   */
  private hoverBottom(v: Rect, h: number, inset: number): number {
    const floor = v.y + v.h - inset;
    const cam = this.world?.cameras?.main;
    if (!cam) return floor;
    const { D } = logical(this);
    const axisTop = (cam.y + (this.world.worldHeight - cam.worldView.y) * cam.zoom) / D;
    const above = axisTop - 6;
    return above < floor && above - h > v.y + 48 ? above : floor;
  }

  private showCitadel(c: CitadelHover) {
    this.showHover(
      `SEAT OF ${c.deploymentId.toUpperCase()} · ${c.exposure}`,
      `Rules ${(c.share * 100).toFixed(0)}% of the dry ground. Liquidation threshold ${c.exposure === "SHORT" ? "above" : "below"} ${usd(c.liquidationPrice)}.`,
    );
  }

  private note(line: string) {
    this.log = [line, ...this.log].slice(0, 8);
    this.drawColumn();
  }
}
