import type Phaser from "phaser";
import { MONSTERS, SHEET, SURVEYOR } from "./figures";
import { UI } from "./chrome";

/**
 * Every sheet the scenes stand on: two CC0 packs and the sheets baked from
 * them. Guarded, so a scene that starts after another has loaded them adds
 * nothing to the queue.
 */
export function loadWorldSheets(scene: Phaser.Scene): void {
  const f16 = { frameWidth: 16, frameHeight: 16 };
  const sheet = (key: string, url: string, frame: { frameWidth: number; frameHeight: number }) => {
    if (!scene.textures.exists(key)) scene.load.spritesheet(key, url, frame);
  };
  sheet(SHEET.town, "/assets/kenney/tiny-town/tilemap_packed.png", f16);
  sheet(SHEET.dungeon, "/assets/kenney/tiny-dungeon/tilemap_packed.png", f16);
  sheet(SHEET.surveyor, "/assets/scree/surveyor.png", { frameWidth: SURVEYOR.frameWidth, frameHeight: SURVEYOR.frameHeight });
  sheet(SHEET.monsters, "/assets/scree/monsters.png", { frameWidth: MONSTERS.frameWidth, frameHeight: MONSTERS.frameHeight });
  sheet(SHEET.clutter, "/assets/scree/clutter.png", f16);
  sheet(SHEET.peaks, "/assets/scree/peaks.png", { frameWidth: 16, frameHeight: 24 });
  sheet(SHEET.fx, "/assets/scree/fx.png", f16);
}

/** The interface's stock: nine-slice panels, buttons, the top bar, the landing's frame and big button. */
export function loadUiStock(scene: Phaser.Scene): void {
  const image = (key: string, url: string) => {
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  };
  image(UI.panel, "/assets/scree/ui-panel.png");
  image(UI.console, "/assets/scree/ui-console.png");
  image(UI.button, "/assets/scree/ui-button.png");
  image(UI.topbar, "/assets/scree/ui-topbar.png");
  image(UI.frame, "/assets/scree/ui-frame.png");
  if (!scene.textures.exists(UI.bigButton)) scene.load.spritesheet(UI.bigButton, "/assets/scree/ui-bigbutton.png", { frameWidth: 120, frameHeight: 36 });
}
