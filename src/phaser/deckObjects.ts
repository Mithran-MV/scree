import Phaser from "phaser";
import type { Sprite } from "../arcane/figures";

/**
 * The clutter on the deck.
 *
 * Authored as pixel art and baked into textures once, because a working desk
 * with tools left on it reads as a place someone uses, and a bare one reads as
 * a mockup. None of it carries a reading; it is the only part of the console
 * that is purely furniture, and it is kept to the deck for exactly that reason.
 */

export const FLOPPY: Sprite = {
  palette: { k: "#1b2228", s: "#39474f", l: "#5d7078", m: "#c9cfd2", w: "#e6ebed", a: "#8a3f2a" },
  art: [
    "ssssssssssss",
    "sllllwwwllls",
    "sllllwwwllls",
    "sllllwwwllls",
    "slllllllllls",
    "ssssssssssss",
    "smmmmmmmmmms",
    "smwwwwwwwwms",
    "smwwwwwwwwms",
    "smmmmmmmmmms",
    "kkkkkkkkkkkk",
  ],
};

export const CIRCUIT: Sprite = {
  palette: { g: "#1f6b3f", d: "#14472a", G: "#2f8f56", y: "#c9a052", k: "#101a14", s: "#8fa8b2" },
  art: [
    "ggggggggggggggg",
    "gdyyddgggyyddGg",
    "gdyyddgssgddddg",
    "gggggggssggyyGg",
    "gGyyggggggyyddg",
    "gdddggsssggddgg",
    "ggggyyssyygggGg",
    "gdyyggggggggddg",
    "ggggggggggggggg",
    "kkkkkkkkkkkkkkk",
  ],
};

export const SCREWDRIVER: Sprite = {
  palette: { h: "#a8452c", H: "#c8613f", m: "#8fa0a8", l: "#c6d3d8", k: "#1b2228" },
  art: [
    "................mll",
    "hHHHHHHHHHHk.mmlllm",
    "hHHHHHHHHHHkmlllmm.",
    "hHHHHHHHHHHk.mmm...",
    "................k..",
  ],
};

export const CABLE_COIL: Sprite = {
  palette: { c: "#2a5a6b", C: "#3d8399", k: "#122730" },
  art: [
    "..CCCC..",
    ".CccccC.",
    "Ccc..ccC",
    "Cc....cC",
    "Ccc..ccC",
    ".CccccC.",
    "..kkkk..",
  ],
};

const KEYS = ["scree-floppy", "scree-circuit", "scree-driver", "scree-coil"] as const;
const SPRITES: Record<(typeof KEYS)[number], Sprite> = {
  "scree-floppy": FLOPPY,
  "scree-circuit": CIRCUIT,
  "scree-driver": SCREWDRIVER,
  "scree-coil": CABLE_COIL,
};

/** Bake each art map into a texture, once per scene. */
export function ensureDeckTextures(scene: Phaser.Scene): void {
  for (const key of KEYS) {
    if (scene.textures.exists(key)) continue;
    const sprite = SPRITES[key];
    const w = sprite.art[0]?.length ?? 0;
    const h = sprite.art.length;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    for (let row = 0; row < h; row++) {
      const line = sprite.art[row]!;
      for (let col = 0; col < line.length; col++) {
        const ch = line[col]!;
        if (ch === ".") continue;
        const colour = sprite.palette[ch];
        if (!colour) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(col, row, 1, 1);
      }
    }
    scene.textures.addCanvas(key, canvas);
  }
}

export const DECK_KEYS = KEYS;
