import Phaser from "phaser";

/**
 * A loader file for a web font the page has already declared (through
 * next/font, which serves the face and names it by a CSS variable). Phaser's
 * own font loader wants a URL; this one just waits for the browser to have
 * the face ready, so text drawn in create() never falls back to a system font.
 */
export class WebFontFile extends Phaser.Loader.File {
  constructor(
    loader: Phaser.Loader.LoaderPlugin,
    private readonly family: string,
    private readonly sample = "16px",
  ) {
    super(loader, { type: "webfont", key: `webfont:${family}`, url: "" } as Phaser.Types.Loader.FileConfig);
  }

  override load(): void {
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts) {
      this.loader.nextFile(this, true);
      return;
    }
    // The family may be a comma-separated stack; the first entry is the face.
    const face = this.family.split(",")[0]!.trim();
    fonts
      .load(`${this.sample} ${face}`)
      .then(() => this.loader.nextFile(this, true))
      .catch(() => this.loader.nextFile(this, true));
  }
}
