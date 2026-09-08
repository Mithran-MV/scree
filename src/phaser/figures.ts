import type { Sprite } from "../arcane/figures";

/**
 * The scouts, authored as art maps.
 *
 * The mage and the guardians come from Kenney's Tiny Dungeon sheet now; only
 * the scouts are still drawn by hand, because two hundred three-pixel marks
 * are cheaper than two hundred sixteen-pixel sprites and read just as well.
 */

/** A scout: three pixels of cloak, so two hundred of them stay cheap. */
export const SCOUT: Sprite = {
  palette: { c: "#8ef0f7", d: "#2b7f8e" },
  art: [".c.", "ccc", "d.d"],
};

/** A drowned scout, which is the only mark that stays behind. */
export const SCOUT_LOST: Sprite = {
  palette: { r: "#ff8a5a" },
  art: ["r.r", ".r.", "r.r"],
};
