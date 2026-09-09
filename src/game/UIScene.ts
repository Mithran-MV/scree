import Phaser from "phaser";
import { UI, button, label, nine } from "./chrome";
import { WebFontFile } from "./fonts";
import { LAYOUT, mapViewport } from "./layout";
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
  /** Owned by the interface: set when the scouts go out, cleared when the world reports them home. */
  scoutsBusy: boolean;
}

/** What the page pushes in. The interface keeps its own flags. */
export type PushedState = Omit<UIState, "scoutsBusy">;

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
  };
}

/** Depth plan for the interface: everything above the world, pop-ups on top. */
const UI_DEPTH = { frame: 90, column: 92, banners: 93, bar: 95, plate: 96, hover: 100, popup: 100 } as const;

interface Banner {
  anchor: Anchor;
  box: Phaser.GameObjects.Container;
  w: number;
  h: number;
  bob: number;
}

const usd = (x: number | null) =>
  x === null || !Number.isFinite(x) ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const days = (d: number) => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`);

/**
 * The instrument around the map.
 *
 * Launched over the world and pinned to the screen: the top bar, the bezel,
 * the title plate, the live feed, the terrace chart, the hover box and the
 * pop-ups. Every box is a nine-slice of baked pixel-art stock. It draws no
 * terrain and holds no arithmetic; it listens to the world and to the page,
 * and it calls the actions it was handed.
 */
export class UIScene extends Phaser.Scene {
  private opts!: UIData;
  private state!: UIState;
  private world!: WorldScene;

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

  constructor() {
    super({ key: "UIScene" });
  }

  init(data: UIData) {
    this.opts = data;
    this.state = { scoutsBusy: false, ...data.getState() };
  }

  /** The interface's stock, and the pixel face the page declared: the loader waits for it. */
  preload() {
    this.load.image(UI.panel, "/assets/scree/ui-panel.png");
    this.load.image(UI.console, "/assets/scree/ui-console.png");
    this.load.image(UI.button, "/assets/scree/ui-button.png");
    this.load.image(UI.topbar, "/assets/scree/ui-topbar.png");
    this.load.addFile(new WebFontFile(this.load, this.opts.fonts.pixel));
  }

  create() {
    this.world = this.scene.get("WorldScene") as WorldScene;
    this.frame = this.add.container(0, 0).setDepth(UI_DEPTH.frame);
    this.column = this.add.container(0, 0).setDepth(UI_DEPTH.column);
    this.bar = this.add.container(0, 0).setDepth(UI_DEPTH.bar);
    this.plate = this.add.container(0, 0).setDepth(UI_DEPTH.plate);
    this.hover = this.add.container(0, 0).setDepth(UI_DEPTH.hover);
    this.popup = this.add.container(0, 0).setDepth(UI_DEPTH.popup).setVisible(false);

    this.layout();
    this.raiseBanners();
    this.scale.on("resize", () => this.layout(), this);

    const ev = this.world.events;
    ev.on(EV.zoneHover, (r: ZoneReading) => this.showZone(r));
    ev.on(EV.citadelHover, (c: CitadelHover) => (c.entered ? this.showCitadel(c) : this.showIdle()));
    ev.on(EV.hoverEnd, () => this.showIdle());
    ev.on(EV.monsterHover, (m: MonsterEvent) => (m.entered ? this.showMonster(m, false) : this.hidePopup()));
    ev.on(EV.monsterClick, (m: MonsterEvent) => {
      this.showMonster(m, true);
      this.note(`${m.name}: ${m.warning}`);
    });
    ev.on(EV.welcome, (w: WelcomeEvent) => this.showWelcome(w));
    ev.on(EV.arrive, (r: ArriveEvent) =>
      this.note(
        r.drowned
          ? `Drowned at ${usd(r.price)}, held ${days(r.dwellDays)}. ${r.deploymentId ?? "The ground"} takes the book.`
          : `Stood at ${usd(r.price)}, held ${days(r.dwellDays)}: health ${r.hf.toFixed(3)}.`,
      ),
    );
    ev.on(EV.guardian, (g: GuardianEvent) =>
      this.note(`The ${g.name} stirs in ${g.reading.deploymentId ?? "open"} water, ${usd(g.reading.price)} deep: ${g.warning}`),
    );
    ev.on(EV.scouts, (s: ScoutsEvent) => {
      this.state.scoutsBusy = false;
      this.note(`${s.survived} of ${s.total} scouts returned: ${((s.survived / s.total) * 100).toFixed(1)}% survive from here.`);
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
    this.banners = this.world.holdfasts.map((anchor) => {
      const text = label(this, 0, 0, `${anchor.deploymentId} · ${Math.round(anchor.share * 100)}%`, { size: 8, font: f.pixel, color: T.vellumInk, crisp: true });
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
      label(this, 0, 0, `$${tick.price.toLocaleString("en-US")}`, { size: 8, font: f.pixel, color: T.vellumInk, crisp: true, align: "center" }).setDepth(UI_DEPTH.banners),
    );
  }

  override update() {
    const cam = this.world.cameras.main;
    const v = mapViewport(this.scale.width, this.scale.height);
    const sx = (wx: number) => cam.x + (wx - cam.worldView.x) * cam.zoom;
    const sy = (wy: number) => cam.y + (wy - cam.worldView.y) * cam.zoom;
    for (const b of this.banners) {
      const x = sx(b.anchor.x);
      const y = sy(b.anchor.top) - 8 + b.bob;
      const inside = x > v.x - b.w && x < v.x + v.w + b.w && y > v.y && y < v.y + v.h;
      b.box.setVisible(inside).setPosition(Math.round(x - b.w / 2), Math.round(y - b.h));
    }
    this.world.axisTicks.forEach((tick, i) => {
      const t = this.axisLabels[i]!;
      const x = sx(tick.fx * this.world.worldWidth);
      const y = sy(this.world.worldHeight + AXIS_H * 0.5);
      const inside = x > v.x + 20 && x < v.x + v.w - 20 && y > v.y && y < v.y + v.h - 8;
      t.setVisible(inside).setPosition(Math.round(x), Math.round(y));
    });
  }

  /** Replace part of the state and redraw what shows it. */
  setState(next: Partial<UIState>) {
    this.state = { ...this.state, ...next };
    if (this.column) {
      this.drawColumn();
      this.drawBar();
    }
  }

  /* ── layout ───────────────────────────────────────────────────────── */

  private layout() {
    this.drawBar();
    this.drawFrame();
    this.drawPlate();
    this.showIdle();
    this.drawColumn();
  }

  /** The top bar: dark ashlar across the whole width, the title cut into it. */
  private drawBar() {
    const W = this.scale.width;
    const f = this.opts.fonts;
    this.bar.removeAll(true);
    const ground = this.add.tileSprite(0, 0, W, LAYOUT.topBar, UI.topbar).setOrigin(0, 0);
    this.bar.add(ground);
    this.bar.add(label(this, 18, 8, "SCREE", { size: 24, font: f.pixel, color: T.vellum, stroke: { color: T.shellEdge, thickness: 6 }, shadow: true, crisp: true }));
    this.bar.add(label(this, 160, 18, "LIQUIDATION TOPOGRAPHY", { size: 8, font: f.pixel, color: T.ley, tracking: 2, stroke: { color: T.shellEdge, thickness: 3 }, crisp: true }));
    this.bar.add(label(this, W - 18, 18, this.state.headline, { size: 8, font: f.pixel, color: T.inkDim, align: "right", stroke: { color: T.shellEdge, thickness: 3 }, crisp: true }));
  }

  /** The bezel: housing around the map viewport under the bar, and the inset lines that make it read as glass. */
  private drawFrame() {
    const W = this.scale.width;
    const H = this.scale.height;
    const v = mapViewport(W, H);
    this.frame.removeAll(true);
    const housing = this.add.graphics();
    housing.fillStyle(T.shellDark, 1);
    housing.fillRect(0, LAYOUT.topBar, W, v.y - LAYOUT.topBar);
    housing.fillRect(0, v.y + v.h, W, H - v.y - v.h);
    housing.fillRect(0, LAYOUT.topBar, v.x, H - LAYOUT.topBar);
    housing.fillRect(v.x + v.w, LAYOUT.topBar, W - v.x - v.w, H - LAYOUT.topBar);
    housing.lineStyle(2, T.shellLit, 0.7);
    housing.strokeRoundedRect(v.x - 5, v.y - 5, v.w + 10, v.h + 10, 4);
    housing.lineStyle(1, T.shellEdge, 1);
    housing.strokeRoundedRect(v.x - 2, v.y - 2, v.w + 4, v.h + 4, 2);
    this.frame.add(housing);
  }

  /** The title plate, pinned inside the north-west corner of the screen. */
  private drawPlate() {
    const v = mapViewport(this.scale.width, this.scale.height);
    const f = this.opts.fonts;
    this.plate.removeAll(true);
    const w = 272;
    const pad = 14;
    const kicker = label(this, pad, pad - 2, "THE SCREE SURVEY", { size: 8, font: f.pixel, color: T.vellumInkDim, crisp: true });
    const title = label(this, pad, pad + 12, "Liquidation Topography", { size: 15, font: f.display, color: T.vellumInk });
    const blurb = label(this, pad, pad + 36, "Elevation is health. Sea level is liquidation. West to east is price; north is how long it held.", {
      size: 10,
      font: f.serif,
      color: T.vellumInkDim,
      wrap: w - pad * 2,
    });
    const h = pad + 36 + blurb.height + pad - 2;
    this.plate.setPosition(v.x + 14, v.y + 14);
    this.plate.add([nine(this, UI.panel, 0, 0, w, h), kicker, title, blurb]);
  }

  /**
   * The reading panel, pinned to the south-west corner of the screen: what
   * the ground under the pointer says, with the terrace-depth graph set into
   * its right-hand side, sized to its text and never larger than it needs.
   */
  private showHover(title: string, body: string) {
    const v = mapViewport(this.scale.width, this.scale.height);
    const f = this.opts.fonts;
    const pad = 14;
    const textW = 236;
    const chartW = 132;
    const chartH = 68;
    const w = pad + textW + 12 + chartW + pad;
    this.hover.removeAll(true);
    const t = label(this, pad, pad - 3, title, { size: 8, font: f.pixel, color: T.vellumInk, wrap: textW, crisp: true });
    const b = label(this, pad, pad + t.height + 4, body, { size: 11, font: f.serif, color: T.vellumInkDim, wrap: textW });
    const block = Math.max(t.height + 4 + b.height, chartH + 12);
    const caption = label(this, pad, pad + block + 6, this.state.chart.note, { size: 8.5, font: f.mono, color: T.vellumInk, wrap: w - pad * 2 });
    const h = pad + block + 6 + (this.state.chart.note ? caption.height : 0) + pad - 2;
    this.hover.setPosition(v.x + 14, v.y + v.h - 14 - h);
    this.hover.add([nine(this, UI.panel, 0, 0, w, h), t, b, caption, ...this.miniChart(pad + textW + 12, pad, chartW, chartH)]);
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
    const head = label(this, x, y - 3, "TERRACE DEPTH", { size: 8, font: f.pixel, color: T.vellumInkDim, crisp: true });
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
    const axis = label(this, x + w, y + h - 9, `${Math.round(tMax)}d`, { size: 7, font: f.mono, color: T.vellumInkDim, align: "right" });
    return [g, head, axis];
  }

  /** The instrument column on the right: controls, feed, log, chart. */
  private drawColumn() {
    const W = this.scale.width;
    const H = this.scale.height;
    const f = this.opts.fonts;
    const s = this.state;
    const x0 = W - LAYOUT.uiRight + 8;
    const cw = LAYOUT.uiRight - 16;
    const pad = 12;
    const half = (cw - 24) / 2;
    this.column.removeAll(true);

    // Address slot (the page lays a real input over it) and the survey button.
    let y = LAYOUT.topBar + LAYOUT.frame + 4;
    this.column.add(nine(this, UI.console, x0 + 8, y, cw - 16 - 70, 30));
    this.column.add(button(this, x0 + cw - 8 - 62, y + 2, s.busy ? "…" : "Survey", { width: 62, tone: T.peril, onClick: this.opts.actions.survey, enabled: !s.busy }));

    y += 40;
    const walletText = s.wallet ? `${s.wallet.slice(0, 6)}…${s.wallet.slice(-4)}` : "Connect wallet";
    this.column.add(button(this, x0 + 8, y, walletText, { width: half, tone: T.brass, onClick: this.opts.actions.connect, enabled: !s.busy }));
    this.column.add(button(this, x0 + 8 + half + 8, y, "Reference book", { width: half, onClick: this.opts.actions.reference }));
    y += 32;
    this.column.add(
      button(this, x0 + 8, y, s.scoutsBusy ? "Scouts out…" : "Send 200 scouts", {
        width: half,
        tone: T.peril,
        enabled: !s.scoutsBusy,
        onClick: () => {
          this.setState({ scoutsBusy: true });
          this.opts.actions.scouts();
        },
      }),
    );
    this.column.add(button(this, x0 + 8 + half + 8, y, "Survey plate", { width: half, onClick: this.opts.actions.plate }));
    y += 36;

    if (s.error) {
      const err = label(this, x0 + 8, y, s.error, { size: 10, color: T.perilBright, font: f.mono, wrap: cw - 16 });
      this.column.add(err);
      y += err.height + 8;
    }

    // Live feed.
    const feedH = 32 + s.feed.length * 19 + 6;
    this.column.add(nine(this, UI.console, x0, y, cw, feedH));
    this.column.add(label(this, x0 + pad, y + 11, "LIVE FEED", { size: 8, font: f.pixel, color: T.ley, crisp: true }));
    this.column.add(label(this, x0 + cw - pad, y + 11, s.label, { size: 9, color: T.inkDim, align: "right", font: f.mono }));
    let fy = y + 32;
    for (const row of s.feed) {
      const tone = row.tone === "peril" ? T.perilBright : row.tone === "ley" ? T.ley : T.ink;
      this.column.add(label(this, x0 + pad, fy, row.key, { size: 11.5, color: T.inkDim, font: f.serif }));
      this.column.add(label(this, x0 + cw - pad, fy, row.value, { size: 11, color: tone, align: "right", font: f.mono }));
      fy += 19;
    }
    y += feedH + 8;

    // The log: what happened on the ground, newest first, filling what remains of the column.
    const logH = Math.max(120, H - y - LAYOUT.frame);
    this.column.add(nine(this, UI.console, x0, y, cw, logH));
    this.column.add(label(this, x0 + pad, y + 11, "ON THE GROUND", { size: 8, font: f.pixel, color: T.ley, crisp: true }));
    if (this.log.length === 0) {
      this.column.add(label(this, x0 + pad, y + 32, "Nothing yet. Click the map and the surveyor walks there.", { size: 10.5, color: T.inkDim, font: f.serif, wrap: cw - pad * 2 }));
    }
    let ly = y + 32;
    for (const [i, line] of this.log.entries()) {
      if (ly > y + logH - 24) break;
      const t = label(this, x0 + pad, ly, line, { size: 10.5, color: i === 0 ? T.ink : T.inkDim, font: f.serif, wrap: cw - pad * 2 });
      this.column.add(t);
      ly += t.height + 8;
    }
  }

  /* ── pop-ups ──────────────────────────────────────────────────────── */

  /**
   * A pop-up on the parchment stock, sized to its text, scaled in from
   * nothing with a Back ease so it lands with a snap. `x, y` is where it
   * points at; the box is kept inside the map viewport.
   */
  private showPopup(title: string, body: string, x: number, y: number, tone: number, pinMs: number) {
    const v = mapViewport(this.scale.width, this.scale.height);
    const f = this.opts.fonts;
    const w = 268;
    const pad = 14;
    this.popupTween?.destroy();
    this.popupTimer?.remove(false);
    this.popup.removeAll(true);

    const t = label(this, 0, 0, title, { size: 8, font: f.pixel, color: tone, wrap: w - pad * 2, crisp: true });
    const b = label(this, 0, 0, body, { size: 11, font: f.serif, color: T.vellumInkDim, wrap: w - pad * 2 });
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
    const v = mapViewport(this.scale.width, this.scale.height);
    const threshold = w.liquidationPrice !== null ? ` It liquidates ${w.exposure === "SHORT" ? "above" : "below"} ${usd(w.liquidationPrice)}.` : "";
    const body = `${w.greeting} It rules ${(w.share * 100).toFixed(0)}% of the ground.${threshold}`;
    this.showPopup(`WELCOME TO THE SEAT OF ${w.deploymentId.toUpperCase()}`, body, v.x + v.w / 2 - 134 - 18, v.y + 96 - 18, T.brass, 7000);
    this.note(`Welcomed at the seat of ${w.deploymentId}.`);
  }

  /* ── hover box ────────────────────────────────────────────────────── */

  private showIdle() {
    this.showHover("THE GROUND", "Move over the map to read it. Click, and the surveyor walks there.");
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
