import Phaser from "phaser";
import { T, FONT_MONO } from "./theme";
import { bezel, button, hex, label, panel, plaque, runeStrip, vellumPanel } from "./chrome";
import type { BakedChart } from "./bakeChart";

export interface FeedRow {
  key: string;
  value: string;
  tone?: "normal" | "peril" | "ley";
  section?: string;
}

export interface ChamberData {
  chart: BakedChart;
  /** Axis extents, so the console can label what it is showing. */
  priceLow: number;
  priceHigh: number;
  dwellHigh: number;
  spotPrice: number;
  title: string;
  placeName: string;
  blurb: string;
  feed: FeedRow[];
  fluxCurve: { t: number; price: number }[];
  fluxNote: string;
  /** Liquidation density per price band, 0..1, west to east. */
  heat: number[];
  error?: string | null;
  onSurvey?: () => void;
  onReference?: () => void;
  onPlate?: () => void;
  onPointer?: (price: number, dwellDays: number) => void;
  onLeave?: () => void;
}

const TERRAIN_KEY = "scree-terrain";
const MOTE_KEY = "scree-mote";

/**
 * The whole console, as one scene.
 *
 * Everything a viewer sees is a game object here — housing, bezel, panels,
 * plaques, buttons, axes, the deck. Only the address field stays in the DOM,
 * because a real text input is the one control Phaser has no native equivalent
 * for and reimplementing one would cost accessibility for nothing.
 */
export class ChamberScene extends Phaser.Scene {
  private opts!: ChamberData;
  private layer!: Phaser.GameObjects.Container;
  private chartImage?: Phaser.GameObjects.Image;
  private screen = { x: 0, y: 0, w: 0, h: 0 };
  private chartScale = 1;
  private dragging = false;

  constructor() {
    super({ key: "chamber" });
  }

  init(data: ChamberData) {
    this.opts = data;
  }

  create() {
    this.makeMoteTexture();
    this.build();
    this.scale.on("resize", () => this.build(), this);
  }

  /** Tear the console down and lay it out again for the current size. */
  private build() {
    this.layer?.destroy(true);
    this.layer = this.add.container(0, 0);

    const W = this.scale.width;
    const H = this.scale.height;
    if (W < 40 || H < 40) return;

    this.drawHousing(W, H);

    const deckH = Math.min(150, Math.max(96, H * 0.17));
    const feedW = Math.min(258, Math.max(190, W * 0.19));
    const gutterL = 118;

    this.screen = {
      x: gutterL,
      y: 58,
      w: Math.max(120, W - gutterL - feedW - 54),
      h: Math.max(120, H - deckH - 124),
    };

    this.drawScreen();
    this.drawAxes();
    this.drawOverlays();
    this.drawFeed(W - feedW - 22, 58, feedW, this.screen.h);
    this.drawDeck(W, H, deckH);
  }

  /* ── housing ──────────────────────────────────────────────────────── */

  private drawHousing(W: number, H: number) {
    const g = this.add.graphics();
    g.fillStyle(T.shellDark, 1);
    g.fillRect(0, 0, W, H);

    // Panel seams, so the housing reads as machined plate rather than a wash.
    g.lineStyle(1, T.shellEdge, 0.8);
    for (let x = 0; x < W; x += 96) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.strokePath();
    }
    g.lineStyle(1, T.shell, 0.35);
    for (let y = 0; y < H; y += 96) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.strokePath();
    }
    this.layer.add(g);

    // Two indicator lamps, top left.
    for (let i = 0; i < 2; i++) {
      const p = panel(this, 16 + i * 40, 14, 32, 30, { housing: true });
      const lamp = this.add.circle(32 + i * 40, 29, 6, i === 0 ? T.ley : T.jade, 0.9);
      this.tweens.add({
        targets: lamp,
        alpha: { from: 0.35, to: 0.95 },
        duration: 1500 + i * 400,
        yoyo: true,
        repeat: -1,
      });
      this.layer.add([p, lamp]);
    }

    // The fault lamp, which lights only when a survey actually failed.
    const fault = panel(this, W - 52, 14, 34, 30, { housing: true });
    const bulb = this.add.circle(W - 35, 29, 6, this.opts.error ? T.peril : T.shellLit, 1);
    const faultText = label(this, W - 60, 20, this.opts.error ? "FAULT" : "", {
      size: 9,
      color: T.peril,
      align: "right",
    });
    if (this.opts.error) {
      this.tweens.add({ targets: bulb, alpha: { from: 1, to: 0.25 }, duration: 620, yoyo: true, repeat: -1 });
    }
    this.layer.add([fault, bulb, faultText]);

    this.layer.add(
      label(this, 62, 20, "SCREE · LIQUIDATION TOPOGRAPHY", {
        size: 10,
        color: T.inkDim,
        tracking: 2.4,
      }).setX(96),
    );
  }

  /* ── the screen ───────────────────────────────────────────────────── */

  private drawScreen() {
    const { x, y, w, h } = this.screen;
    const { chart } = this.opts;

    this.layer.add(bezel(this, x, y, w, h));

    if (this.textures.exists(TERRAIN_KEY)) this.textures.remove(TERRAIN_KEY);
    this.textures.addCanvas(TERRAIN_KEY, chart.canvas);

    // Cover the screen without distorting the art.
    this.chartScale = Math.max(w / chart.width, h / chart.height);

    this.chartImage = this.add
      .image(x + w / 2, y + h / 2, TERRAIN_KEY)
      .setScale(this.chartScale)
      .setDepth(1);
    this.chartImage.setCrop(
      Math.max(0, (chart.width - w / this.chartScale) / 2),
      Math.max(0, (chart.height - h / this.chartScale) / 2),
      Math.min(chart.width, w / this.chartScale),
      Math.min(chart.height, h / this.chartScale),
    );
    this.layer.add(this.chartImage);

    // Ley network, lit, with one real bloom pass rather than stacked alphas.
    const ley = this.add.graphics().setDepth(2);
    ley.lineStyle(Math.max(1, this.chartScale * 0.7), T.leyBright, 0.95);
    for (const line of chart.leyLines) {
      if (line.length < 2) continue;
      ley.beginPath();
      const p0 = this.chartToScreen(line[0]!.x, line[0]!.y);
      ley.moveTo(p0.x, p0.y);
      for (const p of line) {
        const s = this.chartToScreen(p.x, p.y);
        ley.lineTo(s.x, s.y);
      }
      ley.strokePath();
    }
    ley.enableFilters();
    ley.filters?.internal.addGlow(T.ley, 6, 0, 1);
    this.layer.add(ley);

    // Motes travelling the routes.
    for (const line of chart.leyLines) {
      if (line.length < 10) continue;
      const pts = line.map((p) => {
        const s = this.chartToScreen(p.x, p.y);
        return new Phaser.Math.Vector2(s.x, s.y);
      });
      const path = new Phaser.Curves.Path(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i += 3) path.lineTo(pts[i]!.x, pts[i]!.y);
      const emitter = this.add.particles(0, 0, MOTE_KEY, {
        lifespan: 4400,
        quantity: 1,
        frequency: 1100,
        scale: { start: 1.2, end: 0 },
        alpha: { start: 0.9, end: 0 },
        blendMode: "ADD",
        emitZone: { type: "edge", source: path, quantity: 48, total: 1 },
      });
      emitter.setDepth(3);
      this.layer.add(emitter);
    }

    // Beacons on each seat.
    for (const b of chart.beacons) {
      const s = this.chartToScreen(b.x, b.y);
      const arc = this.add.circle(s.x, s.y, 4, T.leyBright, 0.9).setDepth(4);
      this.tweens.add({
        targets: arc,
        scale: { from: 0.6, to: 2.1 },
        alpha: { from: 0.85, to: 0.1 },
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
      this.layer.add(arc);
    }

    // Where you stand.
    const live = this.chartToScreen(
      Math.round(((this.opts.spotPrice - this.opts.priceLow) /
        Math.max(1e-9, this.opts.priceHigh - this.opts.priceLow)) * (chart.width - 1)),
      chart.height - 8,
    );
    const ring = this.add.circle(live.x, live.y, 7, T.ley, 0).setStrokeStyle(1.5, T.ley, 0.85).setDepth(6);
    const core = this.add.circle(live.x, live.y, 2.4, T.leyBright, 1).setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: { from: 0.6, to: 2.6 },
      alpha: { from: 0.9, to: 0 },
      duration: 2200,
      repeat: -1,
      ease: "Quad.Out",
    });
    this.layer.add([ring, core]);

    // Pointer readout and screen-local hit area.
    const hit = this.add
      .rectangle(x, y, w, h, 0x000000, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: false })
      .setDepth(8);
    hit.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.dragging) return;
      const fx = (pointer.x - x) / w;
      const fy = 1 - (pointer.y - y) / h;
      const price = this.opts.priceLow * (this.opts.priceHigh / this.opts.priceLow) ** fx;
      this.opts.onPointer?.(price, fy * fy * this.opts.dwellHigh);
    });
    hit.on("pointerout", () => this.opts.onLeave?.());
    this.layer.add(hit);

    this.layer.add(runeStrip(this, x, y + h - 15, w).setDepth(9));
  }

  private chartToScreen(cx: number, cy: number): { x: number; y: number } {
    const { chart } = this.opts;
    const { x, y, w, h } = this.screen;
    return {
      x: x + w / 2 + (cx - chart.width / 2) * this.chartScale,
      y: y + h / 2 + (cy - chart.height / 2) * this.chartScale,
    };
  }

  /* ── axes ─────────────────────────────────────────────────────────── */

  /**
   * The axes, labelled with what they actually are.
   *
   * This is the single most useful thing on the console: without it the chart
   * is a pretty landscape, and with it the landscape is a reading. West to east
   * is the price of the collateral; south to north is how long price has stayed
   * at or below that level.
   */
  private drawAxes() {
    const { x, y, w, h } = this.screen;
    const { priceLow, priceHigh, dwellHigh } = this.opts;

    const g = this.add.graphics();
    g.lineStyle(1, T.leyDim, 0.5);

    // Price runs log-spaced, so the ticks do too.
    const decades: number[] = [];
    for (const step of [500, 1000, 2000, 5000, 10000]) {
      for (let v = Math.ceil(priceLow / step) * step; v <= priceHigh; v += step) {
        if (!decades.includes(v)) decades.push(v);
      }
      if (decades.length >= 4) break;
    }
    for (const v of decades.slice(0, 6)) {
      const fx = Math.log(v / priceLow) / Math.log(priceHigh / priceLow);
      const px = x + fx * w;
      g.beginPath();
      g.moveTo(px, y + h);
      g.lineTo(px, y + h + 6);
      g.strokePath();
      this.layer.add(
        label(this, px, y + h + 9, `$${v.toLocaleString("en-US")}`, {
          size: 10,
          color: T.inkDim,
          align: "center",
        }),
      );
    }

    // Dwell runs on a root scale, so the first hours stay legible.
    for (const days of [0, 1 / 24, 0.25, 1, 7, 30]) {
      if (days > dwellHigh) continue;
      const fy = Math.sqrt(days / dwellHigh);
      const py = y + h - fy * h;
      g.beginPath();
      g.moveTo(x - 6, py);
      g.lineTo(x, py);
      g.strokePath();
      const text = days === 0 ? "0h" : days < 1 ? `${Math.round(days * 24)}h` : `${days}d`;
      this.layer.add(
        label(this, x - 9, py - 6, text, { size: 10, color: T.inkDim, align: "right" }),
      );
    }
    this.layer.add(g);

    // Price runs west to east, so its name belongs under the ticks; dwell runs
    // south to north, so its name is the only one that turns on its side.
    const dwellAxis = label(this, 30, y + h / 2, "DWELL — HOW LONG IT HELD", {
      size: 10,
      color: T.ley,
      tracking: 2,
    });
    dwellAxis.setOrigin(0.5, 0.5).setAngle(-90);
    const priceAxis = label(this, x + w / 2, y + h + 26, "COLLATERAL PRICE", {
      size: 10,
      color: T.ley,
      tracking: 2,
      align: "center",
    });
    this.layer.add([dwellAxis, priceAxis]);
  }

  /* ── overlays on the screen ───────────────────────────────────────── */

  private drawOverlays() {
    const { x, y, w, h } = this.screen;
    const { chart } = this.opts;

    // Title card, pinned inside the screen's north-west corner, on vellum.
    const card = vellumPanel(this, x + 14, y + 14, 252, 88);
    const t0 = label(this, x + 28, y + 22, "PLACE NAME · DESCRIPTION", {
      size: 8,
      color: T.vellumInkDim,
      tracking: 1.4,
    });
    const t1 = label(this, x + 28, y + 34, this.opts.title, { size: 12, color: T.vellumInk });
    const t2 = label(this, x + 28, y + 52, this.opts.blurb, { size: 10, color: T.vellumInkDim });
    t2.setWordWrapWidth(222);
    const t3 = label(this, x + 28, y + 88, this.opts.placeName.toUpperCase(), {
      size: 9,
      color: T.vellumInk,
      tracking: 2,
    });
    this.layer.add([card, t0, t1, t2, t3]);

    // Actions, north-east.
    this.layer.add(
      button(this, x + w - 232, y + 16, "Survey", { tone: T.peril, onClick: this.opts.onSurvey }),
    );
    this.layer.add(
      button(this, x + w - 154, y + 16, "Connect wallet", { tone: T.ley, enabled: false }),
    );

    // Plaques for each seat and the pass.
    for (const seat of chart.seats) {
      const s = this.chartToScreen(seat.at.x, seat.at.y);
      this.layer.add(
        plaque(
          this,
          Phaser.Math.Clamp(s.x, x + 70, x + w - 70),
          Phaser.Math.Clamp(s.y - 42, y + 108, y + h - 60),
          seat.id,
          `${(seat.share * 100).toFixed(0)}% of the ground`,
        ).setDepth(7),
      );
    }
    if (chart.pass) {
      const s = this.chartToScreen(chart.pass.x, chart.pass.y);
      this.layer.add(
        plaque(
          this,
          Phaser.Math.Clamp(s.x, x + 70, x + w - 70),
          Phaser.Math.Clamp(s.y + 14, y + 108, y + h - 60),
          "THE PASS",
          this.opts.feed.find((f) => f.key === "pass price")?.value ?? "",
          T.peril,
        ).setDepth(7),
      );
    }

    this.drawFlux(x + 16, y + h - 148, 212, 112);
    this.drawHeat(x + w - 96, y + 116, 84, Math.max(80, h - 200));
  }

  /**
   * The liquidation ledger, banded by price.
   *
   * One cell per price band and dwell row: red where that point on the chart is
   * already underwater, cold where it is safe. It is the same field the terrain
   * is cut from, read as a table instead of as country — so a viewer who
   * distrusts the landscape can check it against squares.
   */
  private drawHeat(hx: number, hy: number, hw: number, hh: number) {
    const heat = this.opts.heat;
    if (heat.length === 0) return;

    const cols = 6;
    const rows = Math.min(heat.length, Math.floor(hh / 11));
    const cw = hw / cols;
    const ch = hh / rows;

    const g = this.add.graphics().setDepth(7);
    for (let r = 0; r < rows; r++) {
      const share = heat[Math.floor((r / rows) * heat.length)] ?? 0;
      for (let c = 0; c < cols; c++) {
        // Cells fill from the left as the band gets more dangerous, so the
        // block reads as a bar chart as well as a heat map.
        const lit = c / cols < share;
        const tone = !lit ? T.screenMid : share > 0.66 ? T.peril : share > 0.33 ? T.brass : T.ley;
        g.fillStyle(tone, lit ? 0.85 : 0.28);
        g.fillRect(hx + c * cw + 1, hy + r * ch + 1, cw - 2, ch - 2);
      }
    }
    g.lineStyle(1, T.leyDim, 0.5);
    g.strokeRect(hx, hy, hw, hh);
    this.layer.add(g);
    this.layer.add(
      label(this, hx, hy - 13, "DROWNED BY BAND", {
        size: 8,
        color: T.inkDim,
        tracking: 1.2,
      }).setDepth(7),
    );
  }

  /** The Aether-Flux Matrix: crash liquidation price against dwell. */
  private drawFlux(fx: number, fy: number, fw: number, fh: number) {
    const curve = this.opts.fluxCurve;
    this.layer.add(vellumPanel(this, fx, fy, fw, fh));
    this.layer.add(
      label(this, fx + 14, fy + 9, "AETHER-FLUX MATRIX", {
        size: 9,
        color: T.vellumInk,
        tracking: 1.4,
      }),
    );

    if (curve.length < 2) {
      this.layer.add(
        label(this, fx + 14, fy + 30, "no crash edge on this book", {
          size: 9.5,
          color: T.vellumInkDim,
        }),
      );
      return;
    }

    const prices = curve.map((c) => c.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const span = Math.max(hi - lo, hi * 0.004);
    const plotX = fx + 16;
    const plotY = fy + 26;
    const plotW = fw - 30;
    const plotH = fh - 56;

    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.35);
    g.fillRect(plotX, plotY, plotW, plotH);
    g.lineStyle(1, T.vellumEdge, 0.4);
    for (const f of [0, 0.5, 1]) {
      g.beginPath();
      g.moveTo(plotX, plotY + plotH * f);
      g.lineTo(plotX + plotW, plotY + plotH * f);
      g.strokePath();
    }
    g.lineStyle(1.6, T.vellumInk, 0.9);
    g.beginPath();
    curve.forEach((c, i) => {
      const px = plotX + (c.t / 30) * plotW;
      const py = plotY + plotH - ((c.price - (lo - span * 0.2)) / (span * 1.4)) * plotH;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.strokePath();
    this.layer.add(g);

    this.layer.add(label(this, plotX, plotY + plotH + 4, "0h", { size: 8, color: T.vellumInkDim }));
    this.layer.add(
      label(this, plotX + plotW, plotY + plotH + 4, "30d", {
        size: 8,
        color: T.vellumInkDim,
        align: "right",
      }),
    );
    this.layer.add(
      label(this, fx + 14, fy + fh - 15, this.opts.fluxNote, { size: 9, color: T.vellumInk }),
    );
  }

  /* ── the feed ─────────────────────────────────────────────────────── */

  private drawFeed(fx: number, fy: number, fw: number, fh: number) {
    this.layer.add(panel(this, fx, fy, fw, fh, { housing: true }));
    this.layer.add(label(this, fx + 14, fy + 14, "LIVE FEED", { size: 11, color: T.ley, tracking: 2.6 }));

    let cursor = fy + 38;
    for (const row of this.opts.feed) {
      if (row.section) {
        cursor += 8;
        this.layer.add(
          label(this, fx + 14, cursor, row.section.toUpperCase(), {
            size: 8.5,
            color: T.brass,
            tracking: 1.8,
          }),
        );
        cursor += 16;
      }
      const tone = row.tone === "peril" ? T.perilBright : row.tone === "ley" ? T.ley : T.ink;
      this.layer.add(label(this, fx + 14, cursor, row.key, { size: 10.5, color: T.inkDim }));
      this.layer.add(
        label(this, fx + fw - 14, cursor, row.value, { size: 10.5, color: tone, align: "right" }),
      );
      cursor += 19;
      if (cursor > fy + fh - 20) break;
    }
  }

  /* ── the deck ─────────────────────────────────────────────────────── */

  private drawDeck(W: number, H: number, deckH: number) {
    const top = H - deckH;
    const g = this.add.graphics();
    g.fillStyle(T.shell, 1);
    g.fillRect(0, top, W, deckH);
    g.lineStyle(2, T.shellLit, 0.55);
    g.beginPath();
    g.moveTo(0, top + 1);
    g.lineTo(W, top + 1);
    g.strokePath();
    // A raked surface, so the deck reads as something you lean over.
    g.fillStyle(T.shellDark, 0.55);
    g.fillRect(0, top + deckH * 0.62, W, deckH * 0.38);
    this.layer.add(g);

    // A keyboard, drawn as keys rather than pictured.
    const kbW = Math.min(300, W * 0.26);
    const kbX = (W - kbW) / 2;
    const kbY = top + deckH * 0.26;
    this.layer.add(panel(this, kbX, kbY, kbW, deckH * 0.34, { housing: true, fill: T.shellDark }));
    const keys = this.add.graphics();
    const cols = 18;
    const rows = 3;
    const kw = (kbW - 20) / cols;
    const kh = (deckH * 0.34 - 16) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        keys.fillStyle(T.shellLit, 0.55);
        keys.fillRoundedRect(kbX + 10 + c * kw, kbY + 8 + r * kh, kw - 2, kh - 2, 1);
      }
    }
    this.layer.add(keys);

    const controlY = top + deckH * 0.5 - 13;
    this.layer.add(
      button(this, 22, controlY, "Reference book", { onClick: this.opts.onReference }),
    );
    this.layer.add(
      button(this, 150, controlY, "Survey plate", { tone: T.brass, onClick: this.opts.onPlate }),
    );

    // A coolant canister on the right of the deck.
    const canX = W - 84;
    const canY = top + deckH * 0.2;
    const can = this.add.graphics();
    can.fillStyle(T.shellLit, 1);
    can.fillRoundedRect(canX, canY, 34, deckH * 0.58, 6);
    can.lineStyle(1, T.shellEdge, 1);
    can.strokeRoundedRect(canX, canY, 34, deckH * 0.58, 6);
    can.fillStyle(T.ley, 0.5);
    can.fillRoundedRect(canX + 7, canY + 10, 20, deckH * 0.34, 3);
    this.layer.add(can);

    this.layer.add(
      label(this, W / 2, H - 14, "PUBLIC POSITIONS ONLY · NO SIGNATURE · NO APPROVAL", {
        size: 9,
        color: T.inkDim,
        alpha: 0.6,
        tracking: 1.4,
        align: "center",
      }),
    );
  }

  private makeMoteTexture() {
    if (this.textures.exists(MOTE_KEY)) return;
    const size = 8;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, hex(T.leyBright));
    grad.addColorStop(0.4, "rgba(53,224,232,0.7)");
    grad.addColorStop(1, "rgba(53,224,232,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    this.textures.addCanvas(MOTE_KEY, canvas);
  }
}

export { FONT_MONO };
