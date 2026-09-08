/**
 * The seats of the protocols, as blueprints over Kenney's Tiny Town sheet.
 *
 * Pure data: which frames make up each holdfast, how many tiles it stands on,
 * and where its living parts go (windows that glow, a gear that turns, an orb
 * that floats, a chimney that smokes). The terrain parser reads the footprint
 * to find each seat a place; the world scene builds the sprites.
 */

export type Family = "aave" | "spark" | "compound" | "keep" | "tower";

export interface Blueprint {
  family: Family;
  /** Rows top to bottom of Tiny Town frame indices; -1 is an empty cell. */
  rows: readonly (readonly number[])[];
  /** Cells whose window glows at night, as [col, row]. */
  windows: readonly (readonly [number, number])[];
  /** Cell that carries a turning gear. */
  gear?: readonly [number, number];
  /** Cell above which an orb floats. */
  orb?: readonly [number, number];
  /** Cell whose top vents smoke. */
  chimney?: readonly [number, number];
  /** Flag poles, as [col, row] of the cell they rise from. */
  flags: readonly (readonly [number, number])[];
}

const AAVE: Blueprint = {
  family: "aave",
  rows: [
    [96, 97, 97, 97, 97, 98],
    [108, 126, 109, 109, 126, 110],
    [108, 109, 112, 113, 109, 110],
    [120, 121, 123, 123, 121, 122],
  ],
  windows: [[1, 1], [4, 1]],
  flags: [[0, 0], [5, 0]],
};

const SPARK: Blueprint = {
  family: "spark",
  rows: [
    [48, 49, 50],
    [60, 61, 62],
    [108, 126, 110],
    [108, 109, 110],
    [108, 111, 110],
    [120, 123, 122],
  ],
  windows: [[1, 2]],
  gear: [1, 3],
  chimney: [2, 0],
  flags: [[0, 0]],
};

const COMPOUND: Blueprint = {
  family: "compound",
  rows: [
    [-1, 52, 53, 54, -1],
    [52, 64, 65, 66, 54],
    [76, 89, 77, 90, 78],
    [76, 77, 88, 77, 78],
  ],
  windows: [[1, 2], [3, 2]],
  flags: [[4, 0]],
};

const KEEP: Blueprint = {
  family: "keep",
  rows: [
    [96, 97, 97, 98],
    [108, 126, 126, 110],
    [108, 109, 114, 110],
    [120, 121, 123, 122],
  ],
  windows: [[1, 1], [2, 1]],
  orb: [1, 0],
  flags: [[3, 0]],
};

const TOWER: Blueprint = {
  family: "tower",
  rows: [
    [48, 50],
    [60, 62],
    [108, 110],
    [126, 110],
    [120, 122],
  ],
  windows: [[0, 3]],
  orb: [0, 0],
  flags: [[1, 0]],
};

export function familyOf(deploymentId: string, share: number): Family {
  const id = deploymentId.toLowerCase();
  if (id.startsWith("aave")) return "aave";
  if (id.startsWith("spark")) return "spark";
  if (id.startsWith("compound")) return "compound";
  return share > 0.2 ? "keep" : "tower";
}

export function blueprintFor(deploymentId: string, share: number): Blueprint {
  switch (familyOf(deploymentId, share)) {
    case "aave": return AAVE;
    case "spark": return SPARK;
    case "compound": return COMPOUND;
    case "keep": return KEEP;
    default: return TOWER;
  }
}

export interface Footprint {
  /** Tiles wide. */
  w: number;
  /** Rows that touch the ground. */
  h: number;
  /** Rows the structure occupies in all, ground and what rises above it. */
  rise: number;
}

/** Tiles a holdfast stands on, and how far it rises above them. */
export function footprintFor(deploymentId: string, share: number): Footprint {
  const b = blueprintFor(deploymentId, share);
  return { w: b.rows[0]!.length, h: Math.min(2, b.rows.length), rise: b.rows.length };
}

/** What each seat says when the surveyor walks up to it. */
export function greetingFor(deploymentId: string, share: number): string {
  switch (familyOf(deploymentId, share)) {
    case "aave": return "The stone halls of the oldest lender. Its threshold is patient, and it never forgets a debt.";
    case "spark": return "Gears turn over the deep here. Rates are set by the wheel, and the wheel keeps its own time.";
    case "compound": return "A manor of ledgers. Every window is a market, and each one closes on its own hour.";
    case "keep": return "A keep on the high ground. It rules by being the first to say no.";
    default: return "A watchtower. Small, but it binds the ground beneath it.";
  }
}
