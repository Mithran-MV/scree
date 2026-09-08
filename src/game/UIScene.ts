import Phaser from "phaser";
import { button, label, panel, vellumPanel } from "./chrome";
import { LAYOUT, mapViewport } from "./layout";
import { EV, type ArriveEvent, type CitadelHover, type GuardianEvent, type ScoutsEvent, type ZoneReading } from "./events";
import { T } from "./theme";
import type { WorldScene } from "./WorldScene";

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
  fonts: { mono: string; serif: string; display: string };
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

const usd = (x: number | null) =>
  x === null || !Number.isFinite(x) ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const days = (d: number) => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`);

/**
 * The instrument around the map.
 *
 * Launched over the world and pinned to the screen: the bezel, the title
 * plate, the live feed, the terrace chart and the hover box. It draws no
 * terrain and holds no arithmetic. It listens to the world and to the page,
 * and it calls the actions it was handed.
 */
export class UIScene extends Phaser.Scene {
  private opts!: UIData;
  private state!: UIState;
  private world!: WorldScene;

  private frame!: Phaser.GameObjects.Container;
  private column!: Phaser.GameObjects.Container;
  private hover!: Phaser.GameObjects.Container;
  private hoverTitle!: Phaser.GameObjects.Text;
  private hoverBody!: Phaser.GameObjects.Text;
  private log: string[] = [];

  constructor() {
    super({ key: "UIScene" });
  }

  init(data: UIData) {
    this.opts = data;
    this.state = { scoutsBusy: false, ...data.getState() };
  }

  create() {
    this.world = this.scene.get("WorldScene") as WorldScene;
    this.frame = this.add.container(0, 0);
    this.column = this.add.container(0, 0);
    this.hover = this.add.container(0, 0);

    this.layout();
    this.scale.on("resize", () => this.layout(), this);

    const ev = this.world.events;
    ev.on(EV.zoneHover, (r: ZoneReading) => this.showZone(r));
    ev.on(EV.citadelHover, (c: CitadelHover) => (c.entered ? this.showCitadel(c) : this.showIdle()));
    ev.on(EV.hoverEnd, () => this.showIdle());
    ev.on(EV.arrive, (r: ArriveEvent) =>
      this.note(
        r.drowned
          ? `Drowned at ${usd(r.price)}, held ${days(r.dwellDays)}. ${r.deploymentId ?? "The ground"} takes the book.`
          : `Stood at ${usd(r.price)}, held ${days(r.dwellDays)}: health ${r.hf.toFixed(3)}.`,
      ),
    );
    ev.on(EV.guardian, (g: GuardianEvent) =>
      this.note(
        g.kind === "serpent"
          ? `The serpent stirs: below ${usd(g.liquidationPrice)}, ${g.deploymentId ?? "the market"} liquidates you.`
          : `The drake stirs: above ${usd(g.liquidationPrice)}, ${g.deploymentId ?? "the market"} liquidates you.`,
      ),
    );
    ev.on(EV.scouts, (s: ScoutsEvent) => {
      this.state.scoutsBusy = false;
      this.note(`${s.survived} of ${s.total} scouts returned: ${((s.survived / s.total) * 100).toFixed(1)}% survive from here.`);
    });
  }

  /** Replace part of the state and redraw the instrument column. */
  setState(next: Partial<UIState>) {
    this.state = { ...this.state, ...next };
    if (this.column) this.drawColumn();
  }

  /* ── layout ───────────────────────────────────────────────────────── */

  private layout() {
    const W = this.scale.width;
    const H = this.scale.height;
    const v = mapViewport(W, H);
    const f = this.opts.fonts;
    this.frame.removeAll(true);
    this.hover.removeAll(true);

    // The bezel: four bars of housing around the screen, and the inset lines
    // that make the map read as glass set into an instrument.
    const housing = this.add.graphics();
    housing.fillStyle(T.shellDark, 1);
    housing.fillRect(0, 0, W, v.y);
    housing.fillRect(0, v.y + v.h, W, H - v.y - v.h);
    housing.fillRect(0, 0, v.x, H);
    housing.fillRect(v.x + v.w, 0, W - v.x - v.w, H);
    housing.lineStyle(2, T.shellLit, 0.7);
    housing.strokeRoundedRect(v.x - 6, v.y - 6, v.w + 12, v.h + 12, 6);
    housing.lineStyle(1, T.shellEdge, 1);
    housing.strokeRoundedRect(v.x - 2, v.y - 2, v.w + 4, v.h + 4, 3);
    this.frame.add(housing);

    // Title plate, pinned inside the north-west corner of the screen.
    const plateW = 262;
    this.frame.add(vellumPanel(this, v.x + 16, v.y + 16, plateW, 88));
    this.frame.add(label(this, v.x + 30, v.y + 25, "THE SCREE SURVEY", { size: 9, color: T.vellumInkDim, tracking: 1.6, font: f.mono }));
    this.frame.add(label(this, v.x + 30, v.y + 39, "Liquidation Topography", { size: 15, color: T.vellumInk, font: f.display }));
    const blurb = label(this, v.x + 30, v.y + 63, "Elevation is health. Sea level is liquidation. West to east is price; north is how long it held.", {
      size: 10,
      color: T.vellumInkDim,
      font: f.serif,
    });
    blurb.setWordWrapWidth(plateW - 28);
    this.frame.add(blurb);

    // Hover box, south-west corner of the screen.
    const hw = 330;
    const hh = 66;
    this.hover.setPosition(v.x + 16, v.y + v.h - hh - 16);
    this.hover.add(vellumPanel(this, 0, 0, hw, hh));
    this.hoverTitle = label(this, 14, 11, "", { size: 10.5, color: T.vellumInk, tracking: 1, font: f.mono });
    this.hoverBody = label(this, 14, 29, "", { size: 11, color: T.vellumInkDim, font: f.serif });
    this.hoverBody.setWordWrapWidth(hw - 28);
    this.hover.add([this.hoverTitle, this.hoverBody]);
    this.showIdle();

    this.drawColumn();
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
    this.column.add(panel(this, x0 + 8, LAYOUT.frame + 8, cw - 16 - 70, 30, { fill: T.screenVoid, edge: T.leyDim }));
    this.column.add(
      button(this, x0 + cw - 8 - 62, LAYOUT.frame + 10, s.busy ? "…" : "Survey", {
        width: 62,
        tone: T.peril,
        onClick: this.opts.actions.survey,
        enabled: !s.busy,
      }),
    );

    let y = LAYOUT.frame + 50;
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
      const err = label(this, x0 + 8, y, s.error, { size: 10, color: T.perilBright, font: f.mono });
      err.setWordWrapWidth(cw - 16);
      this.column.add(err);
      y += err.height + 8;
    }

    // Live feed.
    const feedH = 30 + s.feed.length * 19 + 4;
    this.column.add(panel(this, x0, y, cw, feedH, { housing: true }));
    this.column.add(label(this, x0 + pad, y + 10, "LIVE FEED", { size: 10, color: T.ley, tracking: 3, font: f.mono }));
    this.column.add(label(this, x0 + cw - pad, y + 11, s.label, { size: 9.5, color: T.inkDim, align: "right", font: f.mono }));
    let fy = y + 30;
    for (const row of s.feed) {
      const tone = row.tone === "peril" ? T.perilBright : row.tone === "ley" ? T.ley : T.ink;
      this.column.add(label(this, x0 + pad, fy, row.key, { size: 11.5, color: T.inkDim, font: f.serif }));
      this.column.add(label(this, x0 + cw - pad, fy, row.value, { size: 11, color: tone, align: "right", font: f.mono }));
      fy += 19;
    }
    y += feedH + 10;

    // The log: the last three things that happened on the ground.
    const logH = 30 + 3 * 30;
    this.column.add(panel(this, x0, y, cw, logH));
    this.column.add(label(this, x0 + pad, y + 10, "ON THE GROUND", { size: 10, color: T.ley, tracking: 3, font: f.mono }));
    if (this.log.length === 0) {
      this.column.add(label(this, x0 + pad, y + 30, "Nothing yet. Click the map and the surveyor walks there.", { size: 10.5, color: T.inkDim, font: f.serif }));
    }
    this.log.slice(0, 3).forEach((line, i) => {
      const t = label(this, x0 + pad, y + 30 + i * 30, line, { size: 10.5, color: i === 0 ? T.ink : T.inkDim, font: f.serif });
      t.setWordWrapWidth(cw - pad * 2);
      this.column.add(t);
    });
    y += logH + 10;

    // Terrace depth chart, filling what remains of the column.
    const chartH = Math.max(120, H - y - LAYOUT.frame);
    this.drawChart(x0, y, cw, chartH);
  }

  /**
   * Terrace depth: the crash liquidation price against dwell, with the
   * proposed terrace's dwell band shaded and its lifted curve drawn beneath.
   */
  private drawChart(x: number, y: number, w: number, h: number) {
    const f = this.opts.fonts;
    const { curve, lifted, band, note } = this.state.chart;
    this.column.add(vellumPanel(this, x, y, w, h));
    this.column.add(label(this, x + 14, y + 10, "TERRACE DEPTH", { size: 9.5, color: T.vellumInk, tracking: 1.6, font: f.mono }));
    if (curve.length < 2) {
      this.column.add(label(this, x + 14, y + 30, "No crash edge on this book.", { size: 10.5, color: T.vellumInkDim, font: f.serif }));
      return;
    }
    const px = x + 16;
    const py = y + 30;
    const pw = w - 32;
    const ph = h - 76;
    const all = [...curve, ...(lifted ?? [])].map((c) => c.price);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = Math.max(hi - lo, hi * 0.01);
    const tMax = curve[curve.length - 1]!.t;
    const X = (t: number) => px + (t / tMax) * pw;
    const Y = (p: number) => py + ph - ((p - (lo - span * 0.15)) / (span * 1.3)) * ph;

    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.3);
    g.fillRect(px, py, pw, ph);
    if (band) {
      g.fillStyle(T.ley, 0.2);
      g.fillRect(X(band.lo), py, X(band.hi) - X(band.lo), ph);
    }
    g.lineStyle(1, T.vellumEdge, 0.5);
    for (const q of [0, 0.5, 1]) {
      g.beginPath();
      g.moveTo(px, py + ph * q);
      g.lineTo(px + pw, py + ph * q);
      g.strokePath();
    }
    const stroke = (pts: { t: number; price: number }[], colour: number, width: number) => {
      g.lineStyle(width, colour, 0.95);
      g.beginPath();
      pts.forEach((c, i) => (i === 0 ? g.moveTo(X(c.t), Y(c.price)) : g.lineTo(X(c.t), Y(c.price))));
      g.strokePath();
    };
    stroke(curve, T.peril, 1.6);
    if (lifted) stroke(lifted, T.leyDim, 1.6);
    this.column.add(g);
    this.column.add(label(this, px, py + ph + 4, "0h", { size: 8.5, color: T.vellumInkDim, font: f.mono }));
    this.column.add(label(this, px + pw, py + ph + 4, `${Math.round(tMax)}d`, { size: 8.5, color: T.vellumInkDim, align: "right", font: f.mono }));
    this.column.add(label(this, px + pw / 2, py + ph + 4, "dwell", { size: 8.5, color: T.vellumInkDim, align: "center", font: f.mono }));
    const n = label(this, x + 14, y + h - 30, note, { size: 9.5, color: T.vellumInk, font: f.mono });
    n.setWordWrapWidth(w - 28);
    this.column.add(n);
  }

  /* ── hover box ────────────────────────────────────────────────────── */

  private showIdle() {
    this.hoverTitle.setText("THE GROUND");
    this.hoverBody.setText("Move over the map to read it. Click, and the surveyor walks there.");
  }

  private showZone(r: ZoneReading) {
    const who = r.deploymentId ? r.deploymentId.toUpperCase() : "OPEN WATER";
    this.hoverTitle.setText(`${who}${r.exposure ? ` · ${r.exposure}` : ""}${r.drowned ? " · DROWNED" : ""}`);
    const threshold =
      r.liquidationPrice !== null
        ? `Liquidates ${r.exposure === "SHORT" ? "above" : "below"} ${usd(r.liquidationPrice)} at this dwell.`
        : "Nothing binds here.";
    this.hoverBody.setText(`${usd(r.price)} · held ${days(r.dwellDays)} · health ${r.hf.toFixed(3)}. ${threshold}`);
  }

  private showCitadel(c: CitadelHover) {
    this.hoverTitle.setText(`SEAT OF ${c.deploymentId.toUpperCase()} · ${c.exposure}`);
    this.hoverBody.setText(
      `Rules ${(c.share * 100).toFixed(0)}% of the dry ground. Liquidation threshold ${c.exposure === "SHORT" ? "above" : "below"} ${usd(c.liquidationPrice)}.`,
    );
  }

  private note(line: string) {
    this.log = [line, ...this.log].slice(0, 6);
    this.drawColumn();
  }
}
