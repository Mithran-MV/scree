import Phaser from "phaser";
import { button, hex, label, panel, vellumPanel } from "./chrome";
import { T } from "./theme";

export const PANEL_W = 340;
const PAD = 22;

export interface HudFeedRow {
  key: string;
  value: string;
  tone?: "peril" | "ley";
}

export interface HudEntry {
  id: number;
  kind: "reading" | "seat" | "guardian" | "scouts" | "drowned" | "note";
  title: string;
  body: string;
}

export interface HudState {
  label: string;
  busy: boolean;
  error: string | null;
  wallet: string | null;
  scoutsBusy: boolean;
  feed: HudFeedRow[];
  entries: HudEntry[];
}

export interface HudData {
  fonts: { mono: string; serif: string; display: string };
  onSurvey: () => void;
  onConnect: () => void;
  onReference: () => void;
  onScouts: () => void;
  onPlate: () => void;
}

/**
 * The dashboard, drawn.
 *
 * A second scene layered over the world, pinned to the screen. Everything in
 * the panel is a game object — header, buttons, feed, the journal's vellum
 * cards — drawn from the same chrome as the world, so the console and the
 * country it shows are one object. The journal scrolls through its own camera
 * rather than a mask, which is the cheap and reliable way to clip in v4.
 *
 * The one thing not here is the address field: a real text input is the one
 * control a canvas cannot honestly replace, so it stays in the DOM, overlaid on
 * the slot this scene leaves for it.
 */
export class HudScene extends Phaser.Scene {
  private opts!: HudData;
  private state: HudState = {
    label: "",
    busy: false,
    error: null,
    wallet: null,
    scoutsBusy: false,
    feed: [],
    entries: [],
  };

  private chrome!: Phaser.GameObjects.Container;
  private dynamic!: Phaser.GameObjects.Container;
  private journal!: Phaser.GameObjects.Container;
  private journalCam!: Phaser.Cameras.Scene2D.Camera;
  private journalTop = 0;
  private journalHeight = 0;
  private journalContentHeight = 0;

  constructor() {
    super({ key: "hud" });
  }

  init(data: HudData) {
    this.opts = data;
  }

  create() {
    this.chrome = this.add.container(0, 0);
    this.dynamic = this.add.container(0, 0);
    this.journal = this.add.container(PAD, 0);

    this.journalCam = this.cameras.add(0, 0, PANEL_W, 100, false, "journal");
    this.cameras.main.ignore(this.journal);
    this.journalCam.ignore([this.chrome, this.dynamic]);

    this.layout();
    this.scale.on("resize", () => this.layout(), this);

    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (pointer.x > PANEL_W) return;
      this.scrollJournal(dy);
    });
  }

  /** Replace the dynamic state and redraw what depends on it. */
  setState(next: Partial<HudState>) {
    this.state = { ...this.state, ...next };
    if (this.dynamic) this.drawDynamic();
  }

  /* ── layout ───────────────────────────────────────────────────────── */

  private layout() {
    const H = this.scale.height;
    this.chrome.removeAll(true);

    // Panel body: a recessed housing down the west side.
    const g = this.add.graphics();
    g.fillStyle(T.shellDark, 1);
    g.fillRect(0, 0, PANEL_W, H);
    g.fillStyle(T.shell, 1);
    g.fillRect(0, 0, PANEL_W - 1, H);
    g.lineStyle(1, T.bevel, 0.9);
    g.beginPath();
    g.moveTo(PANEL_W - 1, 0);
    g.lineTo(PANEL_W - 1, H);
    g.strokePath();
    this.chrome.add(g);

    const f = this.opts.fonts;
    this.chrome.add(
      label(this, PAD, 20, "SCREE", { size: 20, color: T.ley, tracking: 7, font: f.display }),
    );
    this.chrome.add(
      label(this, PAD, 48, "a survey map of how you get liquidated", {
        size: 12.5,
        color: T.inkDim,
        font: f.serif,
      }),
    );
    this.chrome.add(this.rule(76));

    // The slot the DOM address field sits in, drawn so the field looks recessed.
    this.chrome.add(panel(this, PAD, 90, PANEL_W - PAD * 2 - 70, 30, { fill: T.screenVoid, edge: T.leyDim }));

    this.chrome.add(
      button(this, PANEL_W - PAD - 62, 92, "Survey", { width: 62, tone: T.peril, onClick: this.opts.onSurvey }),
    );

    this.journalTop = 500;
    this.journalHeight = Math.max(80, H - this.journalTop - 40);
    // The journal renders through its own camera whose viewport starts at
    // journalTop, so the container sits at y = 0 in that camera's world.
    this.journalCam.setViewport(0, this.journalTop, PANEL_W, this.journalHeight);
    this.journal.setY(0);

    this.chrome.add(
      label(this, PAD + 44, H - 26, "PUBLIC POSITIONS ONLY · NO SIGNATURE · NO APPROVAL", {
        size: 8.5,
        color: T.inkDim,
        alpha: 0.6,
        tracking: 1.2,
        font: f.mono,
      }),
    );

    this.drawDynamic();
  }

  private drawDynamic() {
    const f = this.opts.fonts;
    const s = this.state;
    this.dynamic.removeAll(true);

    // Actions, two rows.
    const walletText = s.wallet ? `${s.wallet.slice(0, 6)}…${s.wallet.slice(-4)}` : "Connect wallet";
    this.dynamic.add(button(this, PAD, 132, walletText, { width: 138, tone: T.brass, onClick: this.opts.onConnect, enabled: !s.busy }));
    this.dynamic.add(button(this, PAD + 148, 132, "Reference book", { width: 148, onClick: this.opts.onReference }));
    this.dynamic.add(
      button(this, PAD, 166, s.scoutsBusy ? "Scouts out…" : "Send 200 scouts", {
        width: 138,
        tone: T.peril,
        onClick: this.opts.onScouts,
        enabled: !s.scoutsBusy,
      }),
    );
    this.dynamic.add(button(this, PAD + 148, 166, "Survey plate", { width: 148, onClick: this.opts.onPlate }));

    if (s.error) {
      const err = label(this, PAD, 202, s.error, { size: 10, color: T.perilBright, font: f.mono });
      err.setWordWrapWidth(PANEL_W - PAD * 2);
      this.dynamic.add(err);
    }

    // Live feed.
    let y = 232;
    this.dynamic.add(this.rule(y - 12));
    this.dynamic.add(label(this, PAD, y, "LIVE FEED", { size: 10, color: T.ley, tracking: 3, font: f.mono }));
    this.dynamic.add(
      label(this, PANEL_W - PAD, y + 1, s.label, { size: 10, color: T.inkDim, align: "right", font: f.mono }),
    );
    y += 22;
    for (const row of s.feed) {
      const tone = row.tone === "peril" ? T.perilBright : row.tone === "ley" ? T.ley : T.ink;
      this.dynamic.add(label(this, PAD, y, row.key, { size: 11.5, color: T.inkDim, font: f.serif }));
      this.dynamic.add(label(this, PANEL_W - PAD, y, row.value, { size: 11, color: tone, align: "right", font: f.mono }));
      y += 19;
    }

    this.dynamic.add(this.rule(this.journalTop - 22));
    this.dynamic.add(
      label(this, PAD, this.journalTop - 14, "JOURNAL", { size: 10, color: T.ley, tracking: 3, font: f.mono }),
    );

    this.drawJournal();
  }

  private drawJournal() {
    const f = this.opts.fonts;
    const s = this.state;
    this.journal.removeAll(true);
    const width = PANEL_W - PAD * 2;
    let y = 0;

    if (s.entries.length === 0) {
      const hint = label(
        this,
        0,
        0,
        "Click anywhere on the ground and the mage walks there. Where he stands is a question: what if price goes here, and stays this long?",
        { size: 12, color: T.inkDim, font: f.serif },
      );
      hint.setWordWrapWidth(width);
      this.journal.add(hint);
      this.journalContentHeight = hint.height;
      this.journalCam.setScroll(0, 0);
      return;
    }

    for (const e of s.entries) {
      const tone =
        e.kind === "drowned" || e.kind === "guardian" ? T.peril
        : e.kind === "seat" ? T.ley
        : e.kind === "scouts" ? T.leyDim
        : T.brass;
      const onVellum = e.kind !== "note";
      const title = label(this, 12, 8, e.title, {
        size: 10.5,
        color: onVellum ? T.vellumInk : T.ink,
        font: f.mono,
      });
      const body = label(this, 12, 8 + title.height + 3, e.body, {
        size: 11.5,
        color: onVellum ? T.vellumInkDim : T.inkDim,
        font: f.serif,
      });
      body.setWordWrapWidth(width - 24);
      const h = 8 + title.height + 3 + body.height + 10;

      const card = e.kind === "note" ? this.notePanel(width, h) : vellumPanel(this, 0, 0, width, h);
      const bar = this.add.graphics();
      bar.fillStyle(tone, 1);
      bar.fillRect(0, 0, 3, h);

      const group = this.add.container(0, y, [card, bar, title, body]);
      this.journal.add(group);
      y += h + 8;
    }
    this.journalContentHeight = y;
    this.journalCam.setScroll(0, 0);
  }

  private scrollJournal(dy: number) {
    const max = Math.max(0, this.journalContentHeight - this.journalHeight + 12);
    const next = Phaser.Math.Clamp(this.journalCam.scrollY + Math.sign(dy) * 42, 0, max);
    this.journalCam.setScroll(0, next);
  }

  private rule(y: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.lineStyle(1, T.bevel, 0.7);
    g.beginPath();
    g.moveTo(PAD, y);
    g.lineTo(PANEL_W - PAD, y);
    g.strokePath();
    return g;
  }

  private notePanel(w: number, h: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(T.shellDark, 1);
    g.fillRoundedRect(0, 0, w, h, 3);
    g.lineStyle(1, T.bevel, 0.8);
    g.strokeRoundedRect(0, 0, w, h, 3);
    return g;
  }
}

export { hex };
