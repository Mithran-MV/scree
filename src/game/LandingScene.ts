import Phaser from "phaser";
import { Ground } from "./ground";
import { loadUiStock, loadWorldSheets } from "./assets";
import { UI, label, nine } from "./chrome";
import { WebFontFile } from "./fonts";
import { doorLayout } from "./layout";
import { logical, pinToScreen } from "./screen";
import { blip } from "./sfx";
import { T } from "./theme";
import type { TerrainGrid } from "./terrain";
import type { WorldData } from "./WorldScene";

export interface LandingData {
  /** The reference book's ground, for the teaser behind the title. */
  grid: TerrainGrid;
  fonts: { mono: string; serif: string; display: string; pixel: string };
  /** The world's data at the moment the survey begins. */
  worldData: () => WorldData;
  /** The page takes the address (or none) and starts loading its book. */
  onBegin: (address: string | null) => void;
  /** Ask the browser's wallet for an address: null when there is no provider, a rejection when it declines. */
  connect: () => Promise<string | null>;
  /**
   * The one real control is the page's: an HTML input laid over the console
   * at the spot `doorLayout` names, so paste, autofill, screen readers and
   * phone keyboards all work. The door reads and writes it through this.
   */
  field: { get: () => string; set: (value: string) => void; disable: () => void };
}

const DEPTH = { veil: 5, type: 10, console: 12 } as const;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The door to the survey.
 *
 * Behind the title, the same ground the survey draws, panned slowly by its
 * own camera under a dark veil. In front, a stone console with the page's
 * text input set into it and two brass buttons. Begin, and the door fades
 * into the world, carrying the address to the page and the world's data to
 * the scene.
 */
export class LandingScene extends Phaser.Scene {
  private opts!: LandingData;
  private ground!: Ground;
  /** The interface's camera. It is added second, so it renders last and over the drifting ground. */
  private lens!: Phaser.Cameras.Scene2D.Camera;
  private scenery: Phaser.GameObjects.GameObject[] = [];
  private hud!: Phaser.GameObjects.Container;
  private status: Phaser.GameObjects.Text | undefined;
  private leaving = false;

  constructor() {
    super({ key: "LandingScene" });
  }

  init(data: LandingData) {
    this.opts = data;
    this.leaving = false;
    this.scenery = [];
  }

  /** The sheets the ground needs, the console's stock, and the pixel face before any type is set. */
  preload() {
    loadWorldSheets(this);
    loadUiStock(this);
    this.load.addFile(new WebFontFile(this.load, this.opts.fonts.pixel, "64px"));
  }

  create() {
    // The teaser: the ground and its clutter, drawn by the main camera as it
    // drifts across the world. A second camera, rendered after it, holds the
    // interface still over the top; each ignores the other's objects.
    this.ground = new Ground(this, this.opts.grid, { water: 0, shallows: 0.5, terrain: 1 });
    this.ground.animate();
    this.scenery = [...this.ground.layers, ...this.ground.scatter(() => false, (y) => 2 + y / this.ground.worldH)];
    this.lens = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, "lens");
    this.lens.ignore(this.scenery);
    this.hud = this.add.container(0, 0).setDepth(DEPTH.type);
    this.cameras.main.ignore(this.hud);
    this.cinematicPan();

    this.layout();
    this.scale.on("resize", () => {
      this.lens.setSize(this.scale.width, this.scale.height);
      this.cinematicPan();
      this.layout();
    }, this);

    this.cameras.main.fadeIn(600, 8, 24, 32);
    this.lens.fadeIn(600, 8, 24, 32);
  }

  /** A slow, endless drift across the ground: the camera's scroll is tweened and reversed, never cut. */
  private cinematicPan() {
    const cam = this.cameras.main;
    cam.setZoom(0.5 * logical(this).D);
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const maxX = Math.max(0, this.ground.worldW - viewW);
    const maxY = Math.max(0, this.ground.worldH - viewH);
    this.tweens.killTweensOf(cam);
    cam.scrollX = maxX * 0.15;
    cam.scrollY = maxY * 0.55;
    this.tweens.add({ targets: cam, scrollX: maxX * 0.85, duration: 70000, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.tweens.add({ targets: cam, scrollY: maxY * 0.25, duration: 46000, yoyo: true, repeat: -1, ease: "Sine.InOut" });
  }

  /* ── the interface ───────────────────────────────────────────────── */

  private layout() {
    const { W, H, D } = logical(this);
    pinToScreen(this.lens, D);
    const d = doorLayout(W, H);
    const f = this.opts.fonts;
    const cx = Math.round(W / 2);
    this.hud.removeAll(true);
    this.status = undefined;

    // The veil: the ground shows through, the type does not compete with it.
    this.hud.add(this.add.rectangle(0, 0, W, H, 0x081820, 0.58).setOrigin(0, 0));

    // The title.
    const { y: titleY, size } = d.title;
    const kicker = W < 560 ? "HOW YOU GET LIQUIDATED, AS A MAP" : "A SURVEY MAP OF HOW YOU GET LIQUIDATED";
    this.hud.add(label(this, cx, titleY - 24, kicker, { size: 8, font: f.pixel, color: T.ley, align: "center", crisp: true, stroke: { color: T.shellEdge, thickness: 3 }, wrap: W - 24 }));
    const title = label(this, cx, titleY, "SCREE", { size, font: f.pixel, color: 0xe0b25a, align: "center", crisp: true, stroke: { color: T.shellEdge, thickness: Math.round(size / 6) }, shadow: true });
    this.hud.add(title);
    // The pixel face sets its line tall and the stroke adds to it, so the subtitle hangs from the title's measured height.
    this.hud.add(label(this, cx, titleY + Math.round(title.height * 0.92), "Survey Your Liquidation Topography.", { size: W < 560 ? 8 : 16, font: f.pixel, color: T.vellum, align: "center", crisp: true, stroke: { color: T.shellEdge, thickness: 4 }, wrap: W - 24 }));

    // The console. The page lays its input on it at d.input.
    const c = d.console;
    this.hud.add(nine(this, UI.frame, c.x, c.y, c.w, c.h, 20));
    this.hud.add(label(this, cx, c.y + 30, d.stacked ? "PASTE AN ADDRESS OR CONNECT" : "PASTE AN ADDRESS, OR CONNECT A WALLET", { size: 8, font: f.pixel, color: T.vellum, align: "center", crisp: true }));

    // Two brass buttons.
    this.hud.add(this.bigButton(d.buttons[0].x, d.buttons[0].y, "BEGIN SURVEY", () => this.beginFromField()));
    this.hud.add(this.bigButton(d.buttons[1].x, d.buttons[1].y, "CONNECT WALLET", () => void this.connectWallet()));

    this.status = label(this, cx, d.statusY, "The reference book opens first. Your own replaces it when it arrives.", { size: 11, font: f.mono, color: T.inkDim, align: "center", wrap: c.w - 40 });
    this.hud.add(this.status);
  }

  /**
   * A chunky button off the baked three-state sheet: rest, hover, pressed.
   * The states are texture frames, the label rides the press.
   */
  private bigButton(x: number, y: number, text: string, onClick: () => void): Phaser.GameObjects.Container {
    const face = this.add.sprite(0, 0, UI.bigButton, 0).setScale(1.5);
    const t = label(this, 0, -6, text, { size: 8, font: this.opts.fonts.pixel, color: T.shellEdge, align: "center", crisp: true });
    const box = this.add.container(x, y, [face, t]);
    box.setSize(180, 54);
    face.setInteractive({ useHandCursor: true });
    face.on("pointerover", () => {
      face.setFrame(1);
      blip("hover");
    });
    face.on("pointerout", () => {
      face.setFrame(0);
      t.setY(-6);
    });
    face.on("pointerdown", () => {
      face.setFrame(2);
      t.setY(-2);
      blip("press");
    });
    face.on("pointerup", () => {
      face.setFrame(1);
      t.setY(-6);
      onClick();
    });
    return box;
  }

  private setStatus(text: string, peril: boolean) {
    this.status?.setText(text).setColor(peril ? `#${T.perilBright.toString(16).padStart(6, "0")}` : `#${T.inkDim.toString(16).padStart(6, "0")}`);
  }

  /* ── leaving ─────────────────────────────────────────────────────── */

  /** Read the page's field and go: the page calls this on Enter, the button on press. */
  beginFromField() {
    const raw = this.opts.field.get().trim();
    if (raw && !ADDRESS.test(raw)) {
      this.setStatus("That is not an address. Paste 0x followed by forty hex characters, or leave it empty for the reference book.", true);
      return;
    }
    this.begin(raw || null);
  }

  private async connectWallet() {
    if (this.leaving) return;
    this.setStatus("Asking your wallet for an address…", false);
    try {
      const account = await this.opts.connect();
      if (!account) {
        this.setStatus("No wallet found in this browser. Paste an address instead.", true);
        return;
      }
      this.opts.field.set(account);
      this.begin(account);
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "The wallet declined the request.", true);
    }
  }

  /** Fade the door, then open the world with the page's data and hand the page the address. */
  private begin(address: string | null) {
    if (this.leaving) return;
    this.leaving = true;
    blip("begin");
    this.setStatus(address ? `Surveying ${short(address)}…` : "Opening the reference book…", false);
    this.opts.field.disable();
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.lens.fadeOut(500, 0, 0, 0);
    this.lens.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.opts.onBegin(address);
      this.scene.start("WorldScene", this.opts.worldData());
    });
  }
}
